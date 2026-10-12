"""hookd dispatch: every gated guard of one hook event answered by one process.

2026-10-12: twenty gated guards each cost the host a shell, a bash start and a
hookd start (~6 ms of CPU apiece) before every Bash call, only to say "skip".
setup.sh now registers one dispatch entry per event. These pin what the host
used to do with separate entries: a block still blocks, each guard runs only
on its own matcher, a hung guard is cut off without blocking, two guards'
JSON answers both arrive, the no-binary fallback answers the same way, and
setup folds exactly the gated guards, idempotently, never past the skip list
and never for a hookd that can't dispatch.

    python3 tests/test_hookd_dispatch.py
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
CRATE = ROOT / 'crates/hookd'
HOOKS = ROOT / '.claude/hooks'
FALLBACK = HOOKS / 'hookd-fallback.sh'
# One build dir per checkout. Shared, a test in another worktree (or
# another tab on main) relinked release/hookd from its own source, and
# this checkout's tests ran that binary (2026-10-12).
TARGET = Path(tempfile.gettempdir()) / ('chewbacca-hookd-dispatch-target-' + hashlib.sha1(str(ROOT).encode()).hexdigest()[:10])


def build():
    if not shutil.which('cargo'):
        return None
    subprocess.run(['cargo', 'build', '--quiet', '--release', '--manifest-path', str(CRATE / 'Cargo.toml')],
                   env=dict(os.environ, CARGO_TARGET_DIR=str(TARGET)), check=True, timeout=600)
    return TARGET / 'release/hookd'


HOOKD = build()


def payload(command, tool='Bash', session='s', cwd='/'):
    data = {'command': command} if tool == 'Bash' else {'file_path': '/x/a.md', 'content': command}
    return json.dumps({'session_id': session, 'hook_event_name': 'PreToolUse', 'tool_name': tool,
                       'cwd': cwd, 'tool_input': data})


# Each fixture checks its own word too, as the kit's guards do, so the
# ungated fallback answers the same as the gated dispatch.
def needs(word):
    return 'case "$(cat)" in *%s*) ;; *) exit 0 ;; esac\n' % word


GUARDS = {
    # name: (matcher, timeout, body)
    'block.sh': ('Bash', 5, '# gate: vercel\n' + needs('vercel') + 'touch "$MARKS/block"\n'
                 'echo "refused by block" >&2\nexit 2\n'),
    'ctx1.sh': ('Bash', 5, '# gate: ctx\n' + needs('ctx') + 'touch "$MARKS/ctx1"\n'
                'echo \'{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"one"}}\'\n'),
    'ctx2.sh': ('Bash|Edit', 5, '# gate: ctx\n' + needs('ctx') + 'touch "$MARKS/ctx2"\n'
                'echo \'{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"two"}}\'\n'),
    'edit-only.sh': ('Edit', 5, '# gate: vercel\n' + needs('vercel') + 'touch "$MARKS/edit-only"\n'
                     'echo "edit-only refused" >&2\nexit 2\n'),
    # A grandchild keeps the pipes open after the guard itself is killed.
    'slow.sh': ('Bash', 1, '# gate: slow\n' + needs('slow') + 'sleep 8\nexit 2\n'),
    'broken.sh': ('Bash', 5, '# gate: broken\n' + needs('broken') + 'echo "it broke" >&2\nexit 1\n'),
    # Refuses, but leaves a child holding its pipes open for 8 s.
    'leaky.sh': ('Bash', 1, '# gate: leaky\n' + needs('leaky') + 'sleep 8 &\necho "leaky refused" >&2\nexit 2\n'),
}


def write_guards(where):
    where.mkdir(parents=True, exist_ok=True)
    for name, (_, _, body) in GUARDS.items():
        path = where / name
        path.write_text('#!/bin/bash\n' + body)
        path.chmod(0o755)
    argv = []
    for name, (matcher, timeout, _) in GUARDS.items():
        argv += ['--guard', matcher, str(timeout), str(where / name)]
    return argv


@unittest.skipIf(HOOKD is None, 'no cargo on this machine')
class DispatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.temp, True)
        self.marks = self.temp / 'marks'
        self.marks.mkdir()
        self.argv = write_guards(self.temp / 'guards')
        self.env = dict(os.environ, MARKS=str(self.marks), HOOKD_LOG=str(self.temp / 'trace.tsv'))

    def dispatch(self, body, via='hookd'):
        command = [str(HOOKD), 'dispatch'] if via == 'hookd' else ['/bin/bash', str(FALLBACK)]
        started = time.monotonic()
        result = subprocess.run(command + self.argv, input=body, text=True, capture_output=True,
                                env=self.env, timeout=60)
        return result, time.monotonic() - started

    def ran(self):
        return sorted(p.name for p in self.marks.iterdir())

    def both(self):
        return ('hookd', 'fallback')

    def test_the_probe_names_the_dispatch_version(self):
        out = subprocess.run([str(HOOKD), 'dispatch', '--probe'], capture_output=True, text=True)
        self.assertEqual((out.returncode, out.stdout.strip()), (0, 'hookd dispatch 1'))

    def test_an_unrelated_call_starts_nothing(self):
        result, _ = self.dispatch(payload('ls -la'))
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, '', ''))
        self.assertEqual(self.ran(), [])
        rows = [r.split('\t') for r in (self.temp / 'trace.tsv').read_text().splitlines()]
        self.assertEqual(len(rows), len(GUARDS))
        self.assertTrue(all(r[2] == 'skip' for r in rows), rows)

    def test_a_block_still_blocks_through_either_door(self):
        for via in self.both():
            result, _ = self.dispatch(payload('npx vercel --prod'), via)
            self.assertEqual(result.returncode, 2, via)
            self.assertIn('refused by block', result.stderr, via)
            # The Edit-only guard was never the host's to run on Bash.
            self.assertNotIn('edit-only', result.stderr, via)

    def test_each_guard_runs_only_on_its_matcher(self):
        result, _ = self.dispatch(payload('vercel', tool='Edit'))
        self.assertEqual(result.returncode, 2)
        self.assertIn('edit-only refused', result.stderr)
        self.assertNotIn('refused by block', result.stderr)
        self.assertIn('edit-only', self.ran())
        self.assertNotIn('block', self.ran())

    def test_two_answers_both_reach_the_host(self):
        for via in self.both():
            result, _ = self.dispatch(payload('echo ctx'), via)
            self.assertEqual(result.returncode, 0, via)
            ctx = json.loads(result.stdout)['hookSpecificOutput']['additionalContext']
            self.assertEqual(ctx, 'one\n\ntwo', via)

    def test_a_hung_guard_is_cut_off_without_blocking(self):
        for via in self.both():
            result, took = self.dispatch(payload('slow'), via)
            self.assertEqual(result.returncode, 1, via)
            self.assertIn('timed out', result.stderr, via)
            # 1 s timeout plus 1 s grace, never the guard's 8 s.
            self.assertLess(took, 5, via)

    def test_a_child_holding_the_pipes_cannot_hold_the_answer(self):
        # A blocking join on the pipes waited out the child (8 s), past the
        # host's timeout, and a killed hook lets the call through.
        for via in self.both():
            result, took = self.dispatch(payload('leaky ctx'), via)
            self.assertEqual(result.returncode, 2, via)
            self.assertLess(took, 5, via)

    def test_a_broken_guard_is_a_non_blocking_error(self):
        for via in self.both():
            result, _ = self.dispatch(payload('broken'), via)
            self.assertEqual((result.returncode, result.stderr.strip()), (1, 'it broke'), via)

    def test_a_block_wins_over_an_answer_and_an_error(self):
        result, _ = self.dispatch(payload('vercel ctx broken'))
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, '')
        self.assertIn('refused by block', result.stderr)

    def test_an_absurd_timeout_still_blocks(self):
        # Instant + u64::MAX seconds panicked, and a panic is exit 101: a
        # non-blocking error that would have let the call past every guard.
        argv = ['--guard', 'Bash', str(2 ** 64 - 1), str(self.temp / 'guards/block.sh')]
        result = subprocess.run([str(HOOKD), 'dispatch'] + argv, input=payload('vercel'), text=True,
                                capture_output=True, env=self.env, timeout=60)
        self.assertEqual(result.returncode, 2, result.stderr)

    def test_a_malformed_entry_is_not_a_refusal(self):
        result = subprocess.run([str(HOOKD), 'dispatch', '--guard', 'Bash'], input=payload('vercel'),
                                text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 1)

    def test_the_real_guards_refuse_through_dispatch(self):
        # The kit's own guards, as setup registers them: a Vercel deploy and a
        # hard reset in a dirty repo still refuse; ls stays silent.
        repo = self.temp / 'repo'
        repo.mkdir()
        git = ['git', '-C', str(repo), '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false']
        subprocess.run(git[:3] + ['init', '-q'], check=True)
        (repo / 'a').write_text('a')
        subprocess.run(git + ['add', 'a'], check=True)
        subprocess.run(git + ['commit', '-qm', 'a'], check=True)
        (repo / 'a').write_text('b')
        argv = []
        for name in ('vercel-guard.sh', 'destructive-guard.sh', 'zsh-guard.sh', 'skill-gate.sh'):
            argv += ['--guard', 'Bash', '5', str(HOOKS / name)]
        env = dict(os.environ, CHEWBACCA_HOME=str(self.temp / 'ch'), CHEWBACCA_LOG_DIR=str(self.temp / 'logs'),
                   HOOKD_LOG='off', ZSH_GUARD_SHELL='zsh')
        run = lambda c: subprocess.run([str(HOOKD), 'dispatch'] + argv, input=payload(c, cwd=str(repo)),  # noqa: E731
                                       text=True, capture_output=True, env=env, timeout=60)
        self.assertEqual(run('npx vercel --prod').returncode, 2)
        self.assertEqual(run('git reset --hard').returncode, 2)
        quiet = run('ls -la')
        self.assertEqual((quiet.returncode, quiet.stdout, quiet.stderr), (0, '', ''))
        # skill-gate acts on Bash only through its marker, and still does.
        state = self.temp / 'ch/state'
        state.mkdir(parents=True)
        (state / 'skill-required-s').write_text('graph-engineering\n')
        nudged = run('ls -la')
        self.assertEqual(nudged.returncode, 0)
        self.assertIn('graph-engineering', json.loads(nudged.stdout)['hookSpecificOutput']['additionalContext'])


SETUP = ROOT / 'setup.sh'


def settings_block():
    lines = SETUP.read_text().splitlines()
    start = lines.index("python3 << 'PYEOF'") + 1
    end = start + lines[start:].index('PYEOF')
    return '\n'.join(lines[start:end]) + '\n'


@unittest.skipIf(HOOKD is None, 'no cargo on this machine')
class SetupFoldTests(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.home, True)
        hooks = self.home / '.claude/hooks'
        hooks.mkdir(parents=True)
        for script in HOOKS.glob('*.sh'):
            shutil.copy(script, hooks / script.name)
        self.bin = self.home / '.local/bin'
        self.bin.mkdir(parents=True)
        shutil.copy(HOOKD, self.bin / 'hookd')

    def run_setup(self, **extra):
        env = {'HOME': str(self.home), 'PATH': os.environ.get('PATH', ''),
               'D1_HOOKS': str(self.home / '.claude/hooks'), 'D1_SESSION_OPENER': 'none', **extra}
        result = subprocess.run(['python3', '-c', settings_block()], env=env, capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads((self.home / '.claude/settings.json').read_text())

    @staticmethod
    def commands(settings, event):
        return [h['command'] for e in settings['hooks'].get(event, []) for h in e['hooks']]

    @staticmethod
    def folded(settings, event):
        found = [(e, h) for e in settings['hooks'].get(event, []) for h in e['hooks']
                 if '"$H" dispatch ' in h['command']]
        return found

    def gated_names(self):
        return {p.name for p in HOOKS.glob('*.sh')
                if re.search(r'^# gate(?:-file)?:', p.read_text(errors='replace'), re.M)}

    @staticmethod
    def guards_of(hook):
        words = shlex.split(hook['command'].split('; exec /bin/bash')[0].split(' dispatch ', 1)[1])
        return [(words[i + 1], int(words[i + 2]), Path(words[i + 3]).name) for i in range(0, len(words), 4)]

    def test_gated_guards_on_one_matcher_fold_into_one_entry(self):
        settings = self.run_setup()
        gated = self.gated_names()
        for event in ('PreToolUse', 'PostToolUse'):
            entries = self.folded(settings, event)
            self.assertTrue(entries, event)
            seen = []
            for entry, hook in entries:
                guards = self.guards_of(hook)
                self.assertGreaterEqual(len(guards), 2, event)
                # The host matches the entry; inside, every guard is '*'.
                self.assertEqual({m for m, _, _ in guards}, {'*'}, event)
                self.assertEqual(hook['timeout'], max(t for _, t, _ in guards) + 3)
                self.assertIn('hookd-fallback.sh', hook['command'])
                seen += [name for _, _, name in guards]
            self.assertEqual(len(seen), len(set(seen)), event)
            self.assertTrue(set(seen) <= gated, event)
            # Nothing folded is also registered on its own.
            alone = {Path(shlex.split(c)[-1]).name for c in self.commands(settings, event) if ' dispatch ' not in c}
            self.assertFalse(alone & set(seen), event)
        pre = [self.guards_of(h) for e, h in self.folded(settings, 'PreToolUse') if e.get('matcher') == 'Bash']
        self.assertGreaterEqual(len(pre[0]), 10)
        self.assertTrue(any(c.endswith('write-log.sh') for c in self.commands(settings, 'PreToolUse')))

    def test_folding_keeps_each_guards_matcher(self):
        # The same setup without hookd registers every guard alone; folded,
        # each must sit in an entry whose matcher is the one it had.
        folded = self.run_setup()
        (self.bin / 'hookd').unlink()
        alone = self.run_setup()
        for event in ('PreToolUse', 'PostToolUse'):
            had = {}
            for e in alone['hooks'][event]:
                for h in e['hooks']:
                    had[Path(shlex.split(h['command'])[-1]).name] = e.get('matcher')
            for e, h in self.folded(folded, event):
                for _, _, name in self.guards_of(h):
                    self.assertEqual(e.get('matcher'), had[name], name)

    def test_a_rerun_writes_the_same_settings(self):
        first = self.run_setup()
        second = self.run_setup()
        self.assertEqual(first['hooks'], second['hooks'])

    def test_the_skip_list_still_wins(self):
        settings = self.run_setup(D1_SKIP_HOOKS='vercel-guard.sh destructive-guard.sh')
        pre = ' '.join(h['command'] for _, h in self.folded(settings, 'PreToolUse'))
        self.assertNotIn('vercel-guard.sh', pre)
        self.assertNotIn('destructive-guard.sh', pre)
        self.assertIn('focus-guard.sh', pre)

    def test_no_dispatch_from_a_hookd_that_cannot(self):
        (self.bin / 'hookd').write_text('#!/bin/sh\necho "usage: hookd gate" >&2\nexit 0\n')
        settings = self.run_setup()
        self.assertEqual(self.folded(settings, 'PreToolUse'), [])
        self.assertTrue(any('exec "$H" gate ' in c and c.endswith('vercel-guard.sh')
                            for c in self.commands(settings, 'PreToolUse')))

    def test_the_folded_entry_runs_without_the_binary(self):
        settings = self.run_setup()
        command = [h['command'] for e, h in self.folded(settings, 'PreToolUse') if e.get('matcher') == 'Bash'][0]
        (self.bin / 'hookd').unlink()
        env = {'HOME': str(self.home), 'PATH': os.environ.get('PATH', ''),
               'CHEWBACCA_HOME': str(self.home / '.chewbacca'), 'CHEWBACCA_LOG_DIR': str(self.home / 'logs')}
        result = subprocess.run(['/bin/sh', '-c', command], input=payload('npx vercel --prod'),
                                text=True, capture_output=True, env=env, timeout=120)
        self.assertEqual(result.returncode, 2, result.stderr[-2000:])
        self.assertIn('vercel-guard', result.stderr)


if __name__ == '__main__':
    unittest.main()
