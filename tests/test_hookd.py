"""hookd: the front door that skips a guard only when the guard could not act.

2026-10-11: twenty guards ran before every Bash call at ~70 ms of CPU each,
most exiting 0 because the command had nothing to do with them. These pin the
one-sided rule (a doubt always runs the guard), the fallback when the binary
is missing, and that every gated guard in the kit declares usable words."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
CRATE = ROOT / 'crates/hookd'
HOOKS = ROOT / '.claude/hooks'
# Built here, never into the user's ~/.local/bin.
# One build dir per checkout. Shared, a test in another worktree (or
# another tab on main) relinked release/hookd from its own source, and
# this checkout's tests ran that binary (2026-10-12).
TARGET = Path(tempfile.gettempdir()) / ('chewbacca-hookd-test-target-' + hashlib.sha1(str(ROOT).encode()).hexdigest()[:10])


def build():
    if not shutil.which('cargo'):
        return None
    subprocess.run(['cargo', 'build', '--quiet', '--release', '--manifest-path', str(CRATE / 'Cargo.toml')],
                   env=dict(os.environ, CARGO_TARGET_DIR=str(TARGET)), check=True, timeout=600)
    return TARGET / 'release/hookd'


HOOKD = build()


def payload(command, tool='Bash'):
    data = {'command': command} if tool == 'Bash' else {'file_path': '/x/a.md', 'content': command}
    return json.dumps({'session_id': 's', 'hook_event_name': 'PreToolUse', 'tool_name': tool,
                       'cwd': '/', 'tool_input': data})


def setup_gated():
    """setup.sh's own gated(), so the test checks the registration that ships."""
    source = (ROOT / 'setup.sh').read_text()
    match = re.search(r'^def gated\(command\):\n(?:(?: {4}.*|)\n)+', source, re.M)
    if not match:
        raise AssertionError('setup.sh has no gated(): guards are not routed through hookd')
    scope = {'shlex': __import__('shlex')}
    exec(match.group(0), scope)
    return scope['gated']


@unittest.skipIf(HOOKD is None, 'no cargo on this machine')
class HookdTests(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.temp, True)
        self.marker = self.temp / 'ran'
        self.guard = self.temp / 'guard.sh'
        self.guard.write_text('#!/bin/bash\n# gate: vercel\ntouch %s\necho refused >&2\nexit 2\n' % self.marker)
        self.guard.chmod(0o755)
        self.env = dict(os.environ, HOOKD_LOG=str(self.temp / 'trace.tsv'))

    def gate(self, body, command=None):
        return subprocess.run(command or [str(HOOKD), 'gate', str(self.guard)], input=body,
                              text=True, capture_output=True, env=self.env, timeout=30)

    def test_rust_unit_tests_pass(self):
        result = subprocess.run(['cargo', 'test', '--quiet', '--release', '--manifest-path', str(CRATE / 'Cargo.toml')],
                                env=dict(os.environ, CARGO_TARGET_DIR=str(TARGET)),
                                capture_output=True, text=True, timeout=600)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_an_unrelated_call_never_starts_the_guard(self):
        result = self.gate(payload('ls -la'))
        self.assertEqual((result.returncode, result.stderr), (0, ''))
        self.assertFalse(self.marker.exists())

    def test_a_matching_call_runs_the_guard_and_keeps_its_refusal(self):
        result = self.gate(payload('npx vercel --prod'))
        self.assertEqual(result.returncode, 2)
        self.assertIn('refused', result.stderr)
        self.assertTrue(self.marker.exists())

    def test_non_bash_tools_always_run(self):
        self.assertEqual(self.gate(payload('nothing here', tool='Write')).returncode, 2)

    def test_every_event_is_traced(self):
        self.gate(payload('ls'))
        self.gate(payload('vercel'))
        rows = [line.split('\t') for line in (self.temp / 'trace.tsv').read_text().splitlines()]
        self.assertEqual([(r[1], r[2], r[3]) for r in rows], [('guard.sh', 'skip', '0'), ('guard.sh', 'run', '2')])

    def test_registered_command_falls_back_to_the_guard_without_hookd(self):
        command = setup_gated()(str(self.guard))
        self.assertIn('hookd', command)
        self.assertTrue(command.endswith(str(self.guard)))
        empty_home = self.temp / 'home'
        empty_home.mkdir()
        result = subprocess.run(['/bin/sh', '-c', command], input=payload('ls'), text=True,
                                capture_output=True, env=dict(self.env, HOME=str(empty_home)), timeout=30)
        self.assertEqual(result.returncode, 2, 'without hookd the guard must still run')

    def test_registered_command_uses_hookd_when_installed(self):
        command = setup_gated()(str(self.guard))
        home = self.temp / 'home2'
        (home / '.local/bin').mkdir(parents=True)
        shutil.copy(HOOKD, home / '.local/bin/hookd')
        result = subprocess.run(['/bin/sh', '-c', command], input=payload('ls'), text=True,
                                capture_output=True, env=dict(self.env, HOME=str(home)), timeout=30)
        self.assertEqual(result.returncode, 0)
        self.assertFalse(self.marker.exists())

    def test_a_gated_kit_guard_hands_itself_to_hookd(self):
        # Live settings run ~/.claude/hooks/<guard>.sh directly, so the guard's
        # own first line is the front door; no settings change is needed.
        guard = HOOKS / 'vercel-guard.sh'
        home = self.temp / 'home3'
        (home / '.local/bin').mkdir(parents=True)
        shutil.copy(HOOKD, home / '.local/bin/hookd')
        env = dict(self.env, HOME=str(home), CHEWBACCA_LOG_DIR=str(self.temp / 'logs'))
        run = lambda c, e: subprocess.run(['bash', str(guard)], input=payload(c), text=True,  # noqa: E731
                                          capture_output=True, env=e, timeout=30).returncode
        self.assertEqual(run('ls -la', env), 0)
        self.assertEqual(run('npx vercel --prod', env), 2)
        trace = (self.temp / 'trace.tsv').read_text()
        self.assertIn('vercel-guard.sh\tskip\t0', trace)
        self.assertIn('vercel-guard.sh\trun\t2', trace)
        bare = dict(env, HOME=str(self.temp))  # no hookd: the guard runs itself
        self.assertEqual(run('npx vercel --prod', bare), 2)

    def test_the_replay_runs_guard_bodies(self):
        # Without HOOKD_INNER a gated guard hands the replay's call back to
        # hookd, and a parity replay of skip cases passes by construction.
        self.assertIn("HOOKD_INNER='1'", (ROOT / 'tools/hookd_replay.py').read_text())

    def test_ungated_scripts_register_unchanged(self):
        plain = self.temp / 'plain.sh'
        plain.write_text('#!/bin/bash\nexit 0\n')
        self.assertEqual(setup_gated()(str(plain)), str(plain))

    def test_every_gated_kit_guard_declares_usable_words(self):
        gated = [p for p in HOOKS.glob('*.sh') if re.search(r'^# gate:', p.read_text(errors='replace'), re.M)]
        self.assertGreaterEqual(len(gated), 10)
        for script in gated:
            words = [w for line in re.findall(r'^# gate:(.*)$', script.read_text(), re.M) for w in line.split()]
            for word in words:
                # A word the guard needs must make the gate say run.
                verdict = subprocess.run([str(HOOKD), 'decide', str(script)], input=payload('x ' + word + ' y'),
                                         text=True, capture_output=True).stdout.strip()
                self.assertEqual(verdict, 'run', f'{script.name}: {word}')
            plain = subprocess.run([str(HOOKD), 'decide', str(script)], input=payload('true'),
                                   text=True, capture_output=True).stdout.strip()
            self.assertEqual(plain, 'skip', script.name)

    def test_no_gated_guard_runs_on_a_plain_call(self):
        # Every key the host sends, and a plain command. A gate word that
        # hides in a key (path in "transcript_path", 2026-10-12) runs its
        # guard on every call and the gate saves nothing.
        plain = json.dumps({
            'session_id': '6164d1fb-a8f1-4dd6-9649-9b63eb2df9d0',
            'transcript_path': str(Path.home() / '.claude/projects/-Users-x-code-y/6164d1fb.jsonl'),
            'cwd': str(Path.home() / 'code/y'), 'permission_mode': 'bypassPermissions',
            'hook_event_name': 'PreToolUse', 'tool_name': 'Bash',
            'tool_input': {'command': 'ls -la', 'description': 'List files', 'timeout': 120000,
                           'run_in_background': False, 'dangerouslyDisableSandbox': False},
            'tool_use_id': 'toolu_01ABCDEFGHIJKLMNOPQRSTUV'})
        env = dict(os.environ, CHEWBACCA_HOME=str(self.temp))
        gated = {p.name for p in HOOKS.glob('*.sh')
                 if re.search(r'^# gate(?:-file)?:', p.read_text(errors='replace'), re.M)}
        # The nine that ran on every Bash call until 2026-10-12, 0.75 s of CPU
        # between them (tools/hook_bench.py).
        self.assertTrue({'destructive-guard.sh', 'zsh-guard.sh', 'load-guard.sh', 'use-the-kit-guard.sh',
                         'client-ask-guard.sh', 'launch-guard.sh', 'clay-reply-guard.sh', 'skill-gate.sh',
                         'untrusted-screen.sh'} <= gated, gated)
        for name in sorted(gated):
            with self.subTest(name):
                verdict = subprocess.run([str(HOOKD), 'decide', str(HOOKS / name)], input=plain, env=env,
                                         text=True, capture_output=True).stdout.strip()
                self.assertEqual(verdict, 'skip')

    def test_a_case_fold_outside_ascii_still_reaches_the_guard(self):
        # macOS tr and zsh's ${(L)x} fold U+0130 to i, so these run osascript
        # and whisper with neither word in the text. A review of the first
        # gate (2026-10-12) found both skipped while the guard body refused.
        home = self.temp / 'home5'
        (home / '.local/bin').mkdir(parents=True)
        shutil.copy(HOOKD, home / '.local/bin/hookd')
        env = dict(os.environ, HOME=str(home), HOOKD_LOG='off', CHEWBACCA_HOME=str(self.temp),
                   CHEWBACCA_LOG_DIR=str(self.temp / 'logs'), LOAD_GUARD_LOAD='0')
        cases = [('launch-guard.sh',
                  "X=OSASCRİPT; ${(L)X} -e 'tell application \"System Events\" to click button \"Launch\"'"),
                 ('load-guard.sh', 'W=WHİSPER; for f in a b c d; do ${(L)W} $f & done')]
        for name, command in cases:
            with self.subTest(name):
                body = subprocess.run(['bash', str(HOOKS / name)], input=payload(command), text=True,
                                      capture_output=True, env=dict(env, HOOKD_INNER='1'), timeout=60)
                gated = subprocess.run(['bash', str(HOOKS / name)], input=payload(command), text=True,
                                       capture_output=True, env=env, timeout=60)
                self.assertEqual(body.returncode, 2, body.stderr)
                self.assertEqual(gated.returncode, 2, gated.stderr)

    def test_skill_gate_still_runs_once_its_marker_is_there(self):
        state = self.temp / 'state'
        state.mkdir()
        env = dict(os.environ, CHEWBACCA_HOME=str(self.temp))
        decide = lambda: subprocess.run([str(HOOKD), 'decide', str(HOOKS / 'skill-gate.sh')],  # noqa: E731
                                        input=payload('ls'), env=env, text=True, capture_output=True).stdout.strip()
        self.assertEqual(decide(), 'skip')
        (state / 'skill-required-s').write_text('graph-engineering\n')
        self.assertEqual(decide(), 'run')
        # And the guard, run through its own front door, still nudges.
        home = self.temp / 'home4'
        (home / '.local/bin').mkdir(parents=True)
        shutil.copy(HOOKD, home / '.local/bin/hookd')
        out = subprocess.run(['bash', str(HOOKS / 'skill-gate.sh')], input=payload('ls'), text=True,
                             capture_output=True, env=dict(env, HOME=str(home), HOOKD_LOG='off',
                                                           CHEWBACCA_LOG_DIR=str(self.temp / 'logs')))
        self.assertIn('graph-engineering', out.stdout)


if __name__ == '__main__':
    unittest.main()
