"""Every verdict logged: hooks, routers and sends each write one row, and
`chewbacca why --refused` answers "why was this refused" in one command.

2026-10-12, before this: hooks.log kept name, ms and exit code, cut to 3,000
lines (about three hours). It held 394 refusals that night and not one said
why or in which session. These pin the rows, that writing them changes no
hook's output or exit code, and the reader.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
HOOKS = ROOT / '.claude/hooks'
sys.path.insert(0, str(ROOT / 'tools'))
import verdicts  # noqa: E402

COLUMNS = verdicts.COLUMNS


def read_rows(path):
    if not Path(path).exists():
        return []
    out = []
    for line in Path(path).read_text().splitlines():
        cells = line.split('\t')
        assert len(cells) == len(COLUMNS), 'a row with %d columns: %r' % (len(cells), line)
        out.append(dict(zip(COLUMNS, cells)))
    return out


class Base(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.temp, True)
        self.log = self.temp / 'logs' / 'verdicts.tsv'
        self.env = dict(os.environ, CHEWBACCA_LOG_DIR=str(self.temp / 'logs'),
                        CHEWBACCA_VERDICT_LOG=str(self.log), CLAUDE_CODE_SESSION_ID='sess-test',
                        TMPDIR=str(self.temp), HOME=os.environ.get('HOME', ''))
        self.env.pop('HOOKD_VERDICTS', None)
        self.env.pop('HOOKD_INNER', None)
        self.env.pop('CHEWBACCA_VERDICTS', None)

    def hook(self, body, name='probe.sh'):
        path = self.temp / name
        path.write_text('#!/bin/bash\nsource "%s/lib.sh" 2>/dev/null || true\n'
                        'type hook_init >/dev/null 2>&1 && hook_init %s 5\n%s\n' % (HOOKS, name, body))
        return path

    def run_hook(self, path, stdin='{}', env=None):
        return subprocess.run(['/bin/bash', str(path)], input=stdin, capture_output=True, text=True,
                              env=env or self.env, timeout=30)


class LibRows(Base):
    def test_a_refusal_is_one_row_with_its_reason_and_session(self):
        p = self.hook('echo "probe: refusing. rm -rf on a dirty tree" >&2\necho "  commit first" >&2\nexit 2')
        r = self.run_hook(p)
        self.assertEqual(r.returncode, 2)
        rows = read_rows(self.log)
        self.assertEqual(len(rows), 1, rows)
        row = rows[0]
        self.assertEqual((row['kind'], row['name'], row['decision'], row['session']),
                         ('hook', 'probe.sh', 'refuse', 'sess-test'))
        self.assertIn('rm -rf on a dirty tree', row['reason'])
        self.assertIn('commit first', row['reason'])

    def test_output_and_exit_code_reach_the_host_unchanged(self):
        p = self.hook('echo out1\necho "err: one" >&2\necho out2\nprintf "tab\\there\\n" >&2\nexit 2')
        r = self.run_hook(p)
        self.assertEqual((r.returncode, r.stdout, r.stderr), (2, 'out1\nout2\n', 'err: one\ntab\there\n'))
        allow = self.hook('echo "a note" >&2\nexit 0', 'allow.sh')
        r = self.run_hook(allow)
        self.assertEqual((r.returncode, r.stderr), (0, 'a note\n'))
        self.assertEqual([x['decision'] for x in read_rows(self.log)], ['refuse', 'allow'])
        self.assertEqual(read_rows(self.log)[1]['reason'], '', 'an allow row carries no stderr')
        left = [f for f in os.listdir(self.temp) if f.startswith('chewbacca-hook-err')]
        self.assertEqual(left, [], 'the held stderr file is removed')

    def test_a_json_block_names_itself(self):
        p = self.hook('hook_verdict refuse "load the skill first"\n'
                      'echo \'{"decision":"block","reason":"x"}\'\nexit 0')
        r = self.run_hook(p)
        self.assertEqual(r.returncode, 0)
        row = read_rows(self.log)[0]
        self.assertEqual((row['decision'], row['reason']), ('refuse', 'load the skill first'))

    def test_a_hook_that_execs_still_hands_on_its_stderr(self):
        p = self.hook('echo "before" >&2\nhook_unbuffer\nexec /bin/sh -c \'echo "after exec" >&2; exit 2\'')
        r = self.run_hook(p)
        self.assertEqual((r.returncode, r.stderr), (2, 'before\nafter exec\n'))

    def test_hookd_owned_runs_write_no_row_of_their_own(self):
        p = self.hook('echo "x: refusing" >&2\nexit 2')
        # HOOKD_VERDICTS is hookd's pid; here the hook's parent is this test.
        r = self.run_hook(p, env=dict(self.env, HOOKD_VERDICTS=str(os.getpid())))
        self.assertEqual((r.returncode, r.stderr), (2, 'x: refusing\n'))
        self.assertEqual(read_rows(self.log), [])
        # Inherited further down (a hook in a session hookd's guard started),
        # it no longer matches the parent, and the row is written.
        r = self.run_hook(p, env=dict(self.env, HOOKD_VERDICTS='1'))
        self.assertEqual([x['decision'] for x in read_rows(self.log)], ['refuse'])

    def test_the_host_sees_stderr_close_when_the_hook_exits(self):
        """2026-10-12 review: fd 8 (the host's stderr, held aside) leaked into
        the watchdog's sleep and kept the host's pipe open for the hook's
        whole timeout, 5 s here. A host that waits for EOF waited that long."""
        p = self.hook('echo "probe: refusing" >&2\nexit 2')
        started = time.time()
        proc = subprocess.Popen(['/bin/bash', str(p)], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, env=self.env)
        err = proc.stderr.read()
        took = time.time() - started
        proc.wait()
        proc.stdout.close()
        proc.stderr.close()
        self.assertEqual((proc.returncode, err), (2, b'probe: refusing\n'))
        self.assertLess(took, 2.0, 'stderr stayed open %.1fs after the hook exited' % took)

    def test_a_set_e_hook_still_refuses(self):
        """wait on the killed watchdog returns 137; under set -e that ended the
        EXIT trap early and a refusal became exit 137 with no text."""
        p = self.hook('set -euo pipefail\necho "probe: refusing" >&2\nexit 2')
        r = self.run_hook(p)
        self.assertEqual((r.returncode, r.stderr), (2, 'probe: refusing\n'))

    def test_background_spawns_close_the_held_stderr(self):
        """Every `... &` in a hook that holds its stderr closes fd 8, or the
        spawn keeps the host's pipe open as long as it runs."""
        bad = []
        bg = re.compile(r'(?<![&>|<])&\s*(?:#.*)?$')
        for path in sorted(HOOKS.glob('*.sh')):
            text = path.read_text()
            if 'hook_init' not in text or path.name == 'lib.sh':
                continue
            for n, line in enumerate(text.splitlines(), 1):
                code = re.sub(r"'[^']*'|\"[^\"]*\"", '', line)
                if bg.search(code) and '8>&-' not in line:
                    bad.append('%s:%d: %s' % (path.name, n, line.strip()[:70]))
        self.assertEqual(bad, [])

    def test_the_log_is_owner_only(self):
        """A subject is a command, and a command can carry a token."""
        self.run_hook(self.hook('exit 2'))
        self.assertEqual(self.log.stat().st_mode & 0o777, 0o600)

    def test_off_switch(self):
        p = self.hook('exit 2')
        self.run_hook(p, env=dict(self.env, CHEWBACCA_VERDICTS='0'))
        self.assertEqual(read_rows(self.log), [])

    def test_every_hook_that_execs_or_retraps_unbuffers_first(self):
        """A hook that execs a program, or replaces the EXIT trap, after
        hook_init would leave its stderr in the held file forever."""
        bad = []
        for path in sorted(HOOKS.glob('*.sh')):
            if path.name == 'lib.sh':
                continue
            lines = path.read_text().splitlines()
            init = next((i for i, l in enumerate(lines) if re.search(r'\bhook_init\b', l)), None)
            if init is None:
                continue
            unbuffered = False
            for line in lines[init + 1:]:
                if 'hook_unbuffer' in line:
                    unbuffered = True
                stripped = line.strip()
                # Top level only: indented lines live in functions, heredocs or
                # subshells, which a test can't place; the four seen all sit at
                # column 0.
                if line[:1] in (' ', '\t'):
                    continue
                execs = re.match(r'exec\s+(?![0-9]*[<>])\S', stripped)
                retrap = re.match(r'trap\s+.*\bEXIT\b', stripped)
                if (execs or retrap) and not unbuffered:
                    bad.append('%s: %s' % (path.name, stripped[:60]))
                    break
        self.assertEqual(bad, [])


class HookdRows(Base):
    """A guard hookd runs gets exactly one row, written by hookd, carrying the
    event, the session and the command it judged."""

    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(ROOT / 'tests'))
        import test_hookd
        cls.hookd = test_hookd.HOOKD
        if cls.hookd is None:
            raise unittest.SkipTest('no cargo on this machine')

    def guard(self):
        path = self.temp / 'probe-guard.sh'
        path.write_text('#!/bin/bash\n# gate: zzqword\n'
                        '[ -z "${HOOKD_INNER:-}" ] && exit 0\n'
                        'source "%s/lib.sh" 2>/dev/null || true\n'
                        'type hook_init >/dev/null 2>&1 && hook_init probe-guard.sh 5\n'
                        'cat >/dev/null\necho "probe-guard: refusing. zzqword is banned" >&2\nexit 2\n' % HOOKS)
        return path

    def call(self, *argv, command='echo zzqword'):
        payload = json.dumps({'session_id': 'sess-p', 'hook_event_name': 'PreToolUse', 'tool_name': 'Bash',
                              'cwd': '/', 'tool_input': {'command': command}})
        return subprocess.run([str(self.hookd), *argv], input=payload, capture_output=True, text=True,
                              env=dict(self.env, HOOKD_LOG='off'), timeout=60)

    def test_gate_and_dispatch_each_write_one_row(self):
        g = self.guard()
        r = self.call('gate', str(g))
        self.assertEqual((r.returncode, r.stderr), (2, 'probe-guard: refusing. zzqword is banned\n'))
        r = self.call('dispatch', '--guard', '*', '5', str(g))
        self.assertEqual((r.returncode, r.stderr), (2, 'probe-guard: refusing. zzqword is banned\n'))
        rows = read_rows(self.log)
        self.assertEqual(self.log.stat().st_mode & 0o777, 0o600)
        self.assertEqual(len(rows), 2, rows)
        for row in rows:
            self.assertEqual((row['kind'], row['name'], row['event'], row['decision'], row['session'], row['subject']),
                             ('hook', 'probe-guard.sh', 'PreToolUse', 'refuse', 'sess-p', 'Bash: echo zzqword'))
            self.assertEqual(row['reason'], 'probe-guard: refusing. zzqword is banned')

    def test_a_skipped_guard_writes_no_row(self):
        self.assertEqual(self.call('gate', str(self.guard()), command='ls').returncode, 0)
        self.assertEqual(read_rows(self.log), [])


class Reader(Base):
    def write(self, *rows):
        self.log.parent.mkdir(parents=True, exist_ok=True)
        now = int(time.time() * 1000)
        with open(self.log, 'a') as fh:
            for i, (name, decision, session, reason) in enumerate(rows):
                fh.write('\t'.join([str(now + i), 'hook', name, 'PreToolUse', decision, '12', session,
                                    'Bash: git reset --hard', reason]) + '\n')

    def test_why_refused_is_one_command(self):
        self.write(('zsh-guard.sh', 'allow', 'sess-test', ''),
                   ('destructive-guard.sh', 'refuse', 'sess-test', 'destructive-guard: the tree is dirty'),
                   ('load-guard.sh', 'refuse', 'other', 'load-guard: load 40'))
        r = subprocess.run(['bash', str(ROOT / 'bin/lib/why.sh'), '--refused'], capture_output=True,
                           text=True, env=self.env, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('destructive-guard.sh', r.stdout)
        self.assertIn('the tree is dirty', r.stdout)
        self.assertIn('git reset --hard', r.stdout)
        self.assertNotIn('load-guard', r.stdout, 'this session only, by default')
        r = subprocess.run(['bash', str(ROOT / 'bin/lib/why.sh'), '--refused', '--all', '--json'],
                           capture_output=True, text=True, env=self.env, timeout=30)
        self.assertEqual([x['name'] for x in json.loads(r.stdout)], ['load-guard.sh', 'destructive-guard.sh'])

    def test_stats_rank_by_refusals(self):
        self.write(('a.sh', 'refuse', 's', 'r'), ('a.sh', 'refuse', 's', 'r'), ('b.sh', 'allow', 's', ''))
        with mock.patch.dict(os.environ, {'CHEWBACCA_VERDICT_LOG': str(self.log)}):
            out = verdicts.stats(1)
        self.assertEqual([(r['name'], r['refuse'], r['rows']) for r in out], [('a.sh', 2, 2), ('b.sh', 0, 1)])

    def test_rotated_parts_are_read_and_bad_lines_skipped(self):
        self.write(('a.sh', 'refuse', 'sess-test', 'old'))
        os.rename(self.log, str(self.log)[:-4] + '-1.tsv')
        self.write(('b.sh', 'refuse', 'sess-test', 'new'))
        with open(self.log, 'a') as fh:
            fh.write('not a row\n')
        with mock.patch.dict(os.environ, {'CHEWBACCA_VERDICT_LOG': str(self.log)}):
            self.assertEqual([r['reason'] for r in verdicts.rows()], ['old', 'new'])


class RouterRows(Base):
    def test_skill_route_and_kit_route_write_a_router_row(self):
        prompt = json.dumps({'prompt': 'record a product demo video of the app', 'session_id': 'sess-r',
                             'cwd': str(self.temp), 'hook_event_name': 'UserPromptSubmit'})
        env = dict(self.env, ROUTE_SHADOW_LOG=str(self.temp / 'shadow.jsonl'))
        for hook in ('skill-route.sh', 'kit-route.sh'):
            r = subprocess.run(['bash', str(HOOKS / hook)], input=prompt, capture_output=True, text=True,
                               env=env, timeout=60)
            self.assertEqual(r.returncode, 0, r.stderr)
        rows = read_rows(self.log)
        self.assertEqual(sorted(r['name'] for r in rows), ['kit-route.sh', 'skill-route.sh'])
        for row in rows:
            self.assertEqual((row['kind'], row['session'], row['event']), ('router', 'sess-r', 'UserPromptSubmit'))
            self.assertIn(row['decision'], ('route', 'require', 'skip'))
            self.assertNotIn('product demo', row['reason'] + row['subject'], 'the prompt stays out of the log')


class SendRows(Base):
    """Every send is held here: CHEWBACCA_NO_SEND=1, and the runners are mocks
    that fail the test if anything reaches them."""

    def setUp(self):
        super().setUp()
        patcher = mock.patch.dict(os.environ, {'CHEWBACCA_NO_SEND': '1', 'CHEWBACCA_VERDICT_LOG': str(self.log),
                                               'CLAUDE_CODE_SESSION_ID': 'sess-test'})
        patcher.start()
        self.addCleanup(patcher.stop)
        sys.path.insert(0, str(ROOT / 'mac/lib'))

    def test_python_sends_write_a_held_row(self):
        import email_reader
        import gmail
        import run_plan
        code, _ = email_reader.send('a@b.co', 's', 'body', runner=mock.Mock(side_effect=AssertionError('sent')))
        self.assertEqual(code, 3)
        with mock.patch.object(gmail, 'gws', side_effect=AssertionError('sent')):
            self.assertFalse(gmail.send('a@b.co', 's', 'body')['ok'])
        with mock.patch.object(run_plan, '_applescript', side_effect=AssertionError('sent')):
            with self.assertRaises(run_plan.PlanError):
                run_plan.run_action({'name': 'send_text', 'to': '+15550100', 'body': 'hi'}, approved=True)
        rows = read_rows(self.log)
        self.assertEqual([(r['kind'], r['name'], r['decision']) for r in rows],
                         [('send', 'mail send', 'held'), ('send', 'gmail send', 'held'),
                          ('send', 'plan send_text', 'held')])
        self.assertEqual(rows[0]['subject'], 'to ...@b.co')
        for row in rows:
            self.assertNotIn('body', row['reason'] + row['subject'], 'what it said never lands in the log')
            self.assertNotIn(' hi', row['reason'] + row['subject'])

    def test_a_dry_run_and_a_send_are_told_apart(self):
        import email_reader
        email_reader.send('a@b.co', 's', 'body', dry_run=True)
        with mock.patch.dict(os.environ, {'CHEWBACCA_NO_SEND': ''}):
            ok = mock.Mock(return_value=subprocess.CompletedProcess([], 0, '{"success": true}', ''))
            email_reader.send('a@b.co', 's', 'body', runner=ok)
            ok.assert_called_once()
        self.assertEqual([r['decision'] for r in read_rows(self.log)], ['dry-run', 'sent'])

    def test_node_send_paths_write_a_held_row(self):
        script = ('const v = require(%s); v.sendRow("people send imessage", "held", "+15550100", '
                  '"sending is disabled (CHEWBACCA_NO_SEND)");') % json.dumps(str(ROOT / 'bin/lib/verdicts.js'))
        r = subprocess.run(['node', '-e', script], capture_output=True, text=True,
                           env=dict(self.env, CHEWBACCA_NO_SEND='1'), timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        row = read_rows(self.log)[0]
        self.assertEqual((row['kind'], row['decision'], row['subject'], row['session']),
                         ('send', 'held', 'to ...0100', 'sess-test'))

    def test_a_timeout_never_logs_the_message(self):
        """A TimeoutExpired's text is the whole argv: subject and body."""
        import gmail
        boom = subprocess.TimeoutExpired(['gws', '+send', '--subject', 'Quarterly plan', '--body', 'secret words'], 60)
        with mock.patch.dict(os.environ, {'CHEWBACCA_NO_SEND': ''}), \
                mock.patch.object(gmail, 'gws', side_effect=boom), \
                mock.patch.object(gmail, 'sending_account', return_value={}):
            gmail.send('a@b.co', 'Quarterly plan', 'secret words')
        row = read_rows(self.log)[-1]
        self.assertEqual(row['decision'], 'failed')
        self.assertNotIn('secret words', row['reason'])
        self.assertNotIn('Quarterly', row['reason'])

    def test_a_handed_on_send_is_one_row(self):
        with mock.patch.dict(os.environ, {'CHEWBACCA_SEND_LOGGED': '1'}):
            verdicts.send_row('gmail send', 'sent', 'a@b.co')
        self.assertEqual(read_rows(self.log), [])

    def test_secrets_and_paths(self):
        self.assertEqual(verdicts.redact('curl -H Authorization: Bearer abc123 https://x.io'),
                         'curl -H Authorization: Bearer [redacted] https://x.io')
        self.assertEqual(verdicts.redact('API_KEY=hunter2 GITHUB_TOKEN=x run'),
                         'API_KEY=[redacted] GITHUB_TOKEN=[redacted] run')
        self.assertEqual(verdicts.redact('echo ghp_1234567890abcdefghijklmnopqrstuvwxyz'), 'echo [redacted]')
        path = 'cat /Users/joelnewton/code/chewbacca/tools/hookd_replay2.py'
        self.assertEqual(verdicts.redact(path), path)

    def test_every_gated_send_path_writes_a_row(self):
        """The send inventory (tests/test_send_paths.py) as code: each path
        gated on CHEWBACCA_NO_SEND also writes its verdict."""
        sys.path.insert(0, str(ROOT / 'tests'))
        import test_send_paths
        missing = [rel for rel, gate in test_send_paths.KNOWN.items()
                   if gate == 'CHEWBACCA_NO_SEND' and 'verdict' not in (ROOT / rel).read_text().lower()]
        self.assertEqual(missing, [])


if __name__ == '__main__':
    unittest.main()
