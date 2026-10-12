#!/usr/bin/env python3
"""chewbacca-bashparse and the three guards that read it.

The parser (crates/bashparse, tree-sitter-bash) only ever blanks text the
shell provably never runs, or adds a refusal its own parse finds. So every
guard case here runs twice, with the binary and without it:

  - every refusal the guards' own suites assert holds both ways (the 23
    destructive-guard bypasses from the 2026-10-11 reviews among them);
  - each false positive below, taken from 7 days of real refusals
    (2026-10-12), is refused without the parser and passes with it;
  - each new find is missed without the parser and refused with it.

Builds the binary with cargo when CHEWBACCA_BASHPARSE doesn't name one, and
skips (exit 0, says so) only when cargo is missing or can't fetch the two
pinned crates; a compile error fails.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOOKS = ROOT / '.claude/hooks'
CRATE = ROOT / 'crates/bashparse'


def build():
    named = os.environ.get('CHEWBACCA_BASHPARSE')
    if named:
        return named
    if not shutil.which('cargo'):
        return None
    target = Path(tempfile.gettempdir()) / 'chewbacca-bashparse-test-target'
    env = dict(os.environ, CARGO_TARGET_DIR=str(target))
    base = ['cargo', 'build', '--quiet', '--release', '--locked', '--manifest-path', str(CRATE / 'Cargo.toml')]
    r = subprocess.run(base + ['--offline'], env=env, capture_output=True, text=True, timeout=900)
    if r.returncode != 0:
        r = subprocess.run(base, env=env, capture_output=True, text=True, timeout=900)
    if r.returncode != 0 and any(w in r.stderr for w in ('failed to download', 'Could not resolve', 'network', 'failed to get')):
        return None
    if r.returncode != 0:
        raise SystemExit(f'chewbacca-bashparse did not build:\n{r.stderr[-2000:]}')
    return str(target / 'release/chewbacca-bashparse')


BIN = build()
if BIN is None:
    print('SKIP test_bashparse: no cargo, or its crates could not be fetched, so no parser; the guards run their old reading')
    raise SystemExit(0)
NONE = '/nonexistent/chewbacca-bashparse'


def facts(cmd):
    r = subprocess.run([BIN], input=cmd, capture_output=True, text=True, timeout=10)
    return json.loads(r.stdout)


def mask(cmd, profile):
    r = subprocess.run([BIN, '--mask', profile], input=cmd, capture_output=True, text=True, timeout=10)
    return r.returncode, r.stdout


def kept(cmd, profile, word='reset'):
    """The word survives the mask, or the parser gave up (exit 3) and the guard
    reads the raw command."""
    rc, out = mask(cmd, profile)
    return rc == 3 or word in out


def guard(name, cmd, parser, cwd=None, **env):
    payload = {'tool_name': 'Bash', 'session_id': '11111111-1111-1111-1111-111111111111',
               'cwd': cwd or str(Path.home()), 'tool_input': {'command': cmd}}
    e = dict(os.environ, HOOKD_INNER='1', CHEWBACCA_BASHPARSE=BIN if parser else NONE,
             CHEWBACCA_LOG_DIR=tempfile.mkdtemp(prefix='bp-logs-'), ZSH_GUARD_SHELL='zsh', **env)
    r = subprocess.run(['bash', str(HOOKS / name)], input=json.dumps(payload), capture_output=True,
                       text=True, env=e, timeout=60)
    return r.returncode


class Facts(unittest.TestCase):
    def test_probe(self):
        self.assertEqual(subprocess.run([BIN, '--probe'], capture_output=True, text=True).stdout.strip(),
                         'chewbacca-bashparse 1')

    def test_commands_at_every_depth(self):
        f = facts("x=$(bash -c 'ffmpeg -i a b') && cat <<EOF | sh\ngit reset --hard\nEOF\n")
        self.assertTrue(f['ok'])
        names = [(c['name'], c['via']) for c in f['commands']]
        self.assertIn(('ffmpeg', 'bash -c'), names)
        self.assertIn(('git', 'heredoc'), names)

    def test_assignments_and_loops(self):
        f = facts('export path=x; for path in a b; do :; done; head --match path=/x')
        self.assertEqual([a['name'] for a in f['assigns']], ['path'])
        self.assertEqual([v['name'] for v in f['for_vars']], ['path'])

    def test_dynamic(self):
        for cmd in ('eval "$x"', 'x=git; $x reset --hard', 'source ./a.sh', '$(which git) status'):
            self.assertTrue(facts(cmd)['dynamic'], cmd)
        self.assertFalse(facts('git status')['dynamic'])

    def test_parse_error_is_reported(self):
        self.assertFalse(facts('echo "unterminated')['ok'])


class Mask(unittest.TestCase):
    def test_data_blanks_only_words_that_stay_on_screen(self):
        rc, out = mask('echo "git reset --hard"', 'data')
        self.assertEqual(rc, 0)
        self.assertNotIn('reset', out)
        self.assertEqual(len(out), len('echo "git reset --hard"'))
        # Piped on, captured, written to a file, or behind fd 3: kept.
        for cmd in ('echo "git reset --hard" | sh', 'x=$(echo "git reset --hard")',
                    'echo "git reset --hard" > run.sh', 'echo "git reset --hard" >&3',
                    'echo "$(git reset --hard)"'):
            self.assertIn('reset', mask(cmd, 'data')[1], cmd)

    def test_commit_message_only(self):
        out = mask('git commit -m "drop the reset --hard bug" -- a.py', 'data')[1]
        self.assertNotIn('reset', out)
        self.assertIn('a.py', out)
        self.assertIn('reset', mask('git reset --hard', 'data')[1])
        self.assertNotIn('reset', mask('git -C x commit -m "reset --hard"', 'data')[1])
        # A -c can define an alias that runs its arguments; an unknown verb
        # with commit later isn't a commit.
        for cmd in ("git -c alias.x='!sh -c \"$1\"' x -m 'git reset --hard' commit",
                    "git log -m 'reset --hard' commit",
                    # -e hands the message to $GIT_EDITOR, which can be sh.
                    "GIT_EDITOR=sh git commit -e -m 'git reset --hard'",
                    "git commit -e -m 'git reset --hard'", "git commit --template=t -m 'git reset --hard'"):
            self.assertTrue(kept(cmd, 'data'), cmd)

    def test_redirects_that_write(self):
        for cmd in ('echo "git reset --hard" 1<>run.sh', 'echo "git reset --hard" 1<&3',
                    'echo "git reset --hard" &>1', 'echo "git reset --hard" &>>2',
                    'echo "git reset --hard" >&3', 'echo "git reset --hard" &>run.sh'):
            self.assertTrue(kept(cmd, 'data'), cmd)
        for cmd in ('echo "git reset --hard" 2>&1', 'echo "git reset --hard" >/dev/null', 'echo "git reset --hard" <in.txt'):
            self.assertNotIn('reset', mask(cmd, 'data')[1], cmd)

    def test_rg_pre_runs_a_program(self):
        self.assertIn('ffmpeg', mask('rg --pre ffmpeg x', 'load')[1])
        self.assertIn('ffmpeg', mask('rg --hostname-bin ffmpeg x', 'load')[1])
        self.assertIn('reset', mask("printf -v X 'git reset --hard'", 'data')[1])
        self.assertNotIn('whisper', mask("rg -n 'whisper' notes", 'load')[1])

    def test_dynamic_or_broken_gives_up(self):
        self.assertEqual(mask('eval "echo hi"', 'data')[0], 3)
        self.assertEqual(mask('echo "open', 'data')[0], 3)
        # zsh runs a glob qualifier's e:...: as code; bash's grammar can't
        # read one, so the raw command is judged.
        for cmd in ("echo *(e:'git reset --hard':)", 'echo *(e{git reset --hard})', 'ls *(+fn)',
                    "echo =(git reset --hard)", "echo ~[x] 'git reset --hard'",
                    "echo f(e:'git reset --hard':)", "echo *(N) 'git reset --hard'", "echo @(a|b) 'git reset --hard'"):
            self.assertTrue(kept(cmd, 'data'), cmd)

    def test_parens_inside_quotes_still_mask(self):
        # python -c 'print(x)' is the common case; quotes make its parens text.
        self.assertFalse(kept("echo 'print(git reset --hard)'", 'data'))

    def test_zsh_profiles(self):
        cmd = "api-anything add x y --match path=/graphql; zsh -c 'for path in a; do :; done'"
        out = mask(cmd, 'zsh-assign')[1]
        self.assertNotIn('path=', out)
        self.assertIn('for path in', out)  # zsh -c runs its string in zsh: kept


class Guards(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix='bp-guards-')
        cls.dirty = os.path.join(cls.tmp, 'dirty')
        git = ['git', '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false']
        subprocess.run(['git', 'init', '-q', cls.dirty], check=True)
        Path(cls.dirty, 'f').write_text('a\n')
        subprocess.run(git + ['-C', cls.dirty, 'add', 'f'], check=True)
        subprocess.run(git + ['-C', cls.dirty, 'commit', '-qm', 'f'], check=True)
        Path(cls.dirty, 'f').write_text('b\n')

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def pair(self, name, cmd, cwd=None, **env):
        return guard(name, cmd, False, cwd, **env), guard(name, cmd, True, cwd, **env)

    # Real refusals from 2026-10-05..12, trimmed and with private paths
    # replaced: refused without the parser, let through with it.
    def test_false_positives_dropped(self):
        cases = [
            ('zsh-guard.sh', 'api-anything add x getTweets --match path=/graphql/*/UserTimeline --public authorization', {}),
            ('zsh-guard.sh', "python3 -I -c '\nimport os\nfor path in [\"a\"]:\n    print(path)\n'", {}),
            ('load-guard.sh', "which whisper mlx_whisper ffmpeg 2>/dev/null; ls bin | grep -i -E 'transcri|whisper|hear|audio'", {'LOAD_GUARD_LOAD': '12'}),
            ('load-guard.sh', 'ls -la ~/.claude/hooks/load-guard.sh $(command -v yt-transcript); git ls-tree -r --name-only origin/main | grep -E "load-guard|yt-transcript|graph-engineering"', {'LOAD_GUARD_LOAD': '12'}),
            ('load-guard.sh', 'gemini --version 2>&1; ollama --version; ollama run --help 2>&1', {'LOAD_GUARD_LOAD': '12'}),
            ('load-guard.sh', '/Applications/Nalana.app/Contents/MacOS/Nalana -b --version 2>&1 | head -3', {'LOAD_GUARD_LOAD': '12'}),
            ('destructive-guard.sh', 'work-ledger add --title "Sync the checkout" --next-action "back it up, then reset --hard origin/main"', {'cwd': True}),
            ('destructive-guard.sh', 'git commit -m "fix: the reset --hard bug; it is gone" --allow-empty --dry-run', {'cwd': True}),
            ('destructive-guard.sh', 'echo "never run git checkout -- . in a shared checkout"', {'cwd': True}),
        ]
        for name, cmd, env in cases:
            cwd = self.dirty if env.pop('cwd', False) else None
            with self.subTest(guard=name, cmd=cmd[:60]):
                self.assertEqual(self.pair(name, cmd, cwd, **env), (2, 0))

    # The parse sees what the regex couldn't: refused only with it.
    def test_new_finds(self):
        cases = [
            ('zsh-guard.sh', "eval 'for path in a b; do echo $path; done'", {}),
            ('zsh-guard.sh', 'zsh -c "path=/tmp/x; ls"', {}),
            ('load-guard.sh', "bash -c 'ffmpeg -i a.mov b.mp4'", {'LOAD_GUARD_LOAD': '12'}),
            ('load-guard.sh', 'cat ids.txt | xargs -n1 yt-transcript', {'LOAD_GUARD_LOAD': '12'}),
            ('load-guard.sh', '(yt-transcript "abc" > a.txt 2>&1; echo $?) ; (yt-transcript "def" > b.txt)', {'LOAD_GUARD_LOAD': '12'}),
        ]
        for name, cmd, env in cases:
            with self.subTest(guard=name, cmd=cmd[:60]):
                self.assertEqual(self.pair(name, cmd, **env), (0, 2))

    # Shapes the data mask must never hide: each is refused both ways.
    def test_data_that_runs_is_still_judged(self):
        for cmd in ('echo "git reset --hard" | sh', 'echo "git reset --hard" > /tmp/x.sh; bash /tmp/x.sh',
                    'bash -c "$(echo git reset --hard)"', 'printf "git checkout -- f" | bash',
                    "rg --pre 'git reset --hard' x",
                    # Found by the 1,500-call replay on 2026-10-12: the redirect
                    # hangs on a statement around `cd x && echo y`, not on echo.
                    "cd . && echo 'git reset --hard' >> run.sh && bash run.sh",
                    '{ echo "git reset --hard"; } | sh', '( echo "git reset --hard" ) | bash',
                    'for i in 1; do echo "git reset --hard"; done | sh',
                    'f(){ echo "git reset --hard"; }; f | sh',
                    'exec > run.sh; echo "git reset --hard"; bash run.sh',
                    'echo "git reset --hard" <<EOF | sh\nx\nEOF',
                    'echo(){ eval "$*"; }; echo git reset --hard',
                    "hash -p /bin/sh grep; grep -c 'git reset --hard'"):
            with self.subTest(cmd=cmd):
                self.assertEqual(self.pair('destructive-guard.sh', cmd, self.dirty), (2, 2))

    def test_zsh_words_piped_to_zsh_still_judged(self):
        self.assertEqual(self.pair('zsh-guard.sh', 'echo for path in a b | zsh'), (2, 2))
        self.assertEqual(self.pair('zsh-guard.sh', 'echo path=/x > f.zsh; zsh f.zsh'), (2, 2))
        # Into an ordinary program the words are still only words.
        self.assertEqual(self.pair('zsh-guard.sh', 'api-anything add x y --match path=/v3/x 2>&1 | tail -5'), (2, 0))

    def test_light_calls_of_heavy_tools_pass(self):
        for cmd in ('ollama list', 'codex login status; ollama list | awk \'NR>1{print $1}\''):
            with self.subTest(cmd=cmd):
                self.assertEqual(self.pair('load-guard.sh', cmd, LOAD_GUARD_LOAD='99'), (0, 0))

    def test_real_heavy_runs_still_refused(self):
        for cmd in ('ffmpeg -hide_banner -i a.mov b.mp4', 'yt-transcript abc --timestamps 2>&1 | head -c 600',
                    'ollama run llama3 "hi"', '/Applications/Nalana.app/Contents/MacOS/Nalana -b x.blend -P r.py',
                    'ffmpeg --help; ffmpeg -i a.mov b.mp4'):
            with self.subTest(cmd=cmd):
                self.assertEqual(self.pair('load-guard.sh', cmd, LOAD_GUARD_LOAD='12'), (2, 2))

    # Each guard's own suite, every case, with the parser in place. The 23
    # bypasses three reviews found in destructive-guard on 2026-10-11 live in
    # tests/destructive_guard.sh.
    def test_suites_hold_with_the_parser(self):
        env = dict(os.environ, HOOKD_INNER='1', CHEWBACCA_BASHPARSE=BIN)
        for script in ('tests/destructive_guard.sh', 'tests/zsh_guard.sh', 'tests/load-guard-test.sh'):
            with self.subTest(script=script):
                r = subprocess.run(['bash', str(ROOT / script)], cwd=ROOT, env=env, capture_output=True,
                                   text=True, timeout=600)
                self.assertEqual(r.returncode, 0, r.stdout[-1500:] + r.stderr[-500:])


if __name__ == '__main__':
    unittest.main()
