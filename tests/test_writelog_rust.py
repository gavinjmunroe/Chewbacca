"""chewbacca-writelog: write-log in Rust, reading the brain from FSEvents.

2026-10-11: write-log cost 0.56 s of CPU before and 0.52 s after every Bash,
Write and Edit call (tools/hook_bench.py), most of it a `git status` of the
brain. These check three things:

- every behavior test of the Python hook (tests/test_write_log.py) passes
  with the binary answering;
- with a live watcher, Python and the binary log the same rows for the same
  calls, scenario by scenario, run side by side on one repository;
- a Bash call next to a brain of 6,000 dirty files costs the hook under
  0.05 s of CPU, Pre and Post together. The Python hook fails that line.
"""
import json
import os
from pathlib import Path
import resource
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
import test_write_log  # noqa: E402

CRATE = ROOT / 'crates/writelog'
HOOK = ROOT / '.claude/hooks/write-log.sh'
# Built here, never into the user's ~/.local/bin.
TARGET = Path(tempfile.gettempdir()) / 'chewbacca-writelog-test-target'


def build():
    if not shutil.which('cargo'):
        return None
    subprocess.run(['cargo', 'build', '--quiet', '--release', '--manifest-path', str(CRATE / 'Cargo.toml')],
                   env=dict(os.environ, CARGO_TARGET_DIR=str(TARGET)), check=True, timeout=600)
    return TARGET / 'release/chewbacca-writelog'


BIN = build()


@unittest.skipIf(BIN is None, 'no cargo on this machine')
class RustAnswersEveryWriteLogTest(test_write_log.WriteLogTests):
    """The whole Python behavior suite, with the binary in front."""

    def setUp(self):
        super().setUp()
        self.env['CHEWBACCA_WRITELOG_BIN'] = str(BIN)
        self.env['CHEWBACCA_WRITELOG_MODE'] = 'rust'

    def test_a_native_call_is_answered_by_the_binary(self):
        # Without this, every test above could pass with the binary handing
        # each payload straight back to Python.
        state = Path(self.env['CHEWBACCA_SESSION_STATE'])
        self.hook('PreToolUse', call='native-1')
        self.assertEqual([p.name.endswith('.rw.json') for p in state.glob('*.json')], [True])
        self.policy.write_text('through the binary')
        self.hook('PostToolUse', call='native-1')
        self.assertEqual(len(self.records()), 1)
        self.assertEqual(list(state.glob('*.json')), [])


class Watcher:
    def __init__(self, env, root):
        self.proc = subprocess.Popen([str(BIN), 'serve', '--root', str(root)], env=env,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        status = None
        for _ in range(200):
            status = subprocess.run([str(BIN), 'status'], env=env, capture_output=True, text=True)
            if status.returncode == 0:
                return
            time.sleep(0.02)
        self.stop()
        raise AssertionError('watcher never came up: %s %s' % (status.stdout, self.proc.stderr.read()))

    def stop(self):
        if self.proc.poll() is None:
            self.proc.send_signal(signal.SIGTERM)
            self.proc.wait(5)


@unittest.skipIf(BIN is None, 'no cargo on this machine')
class JournalParity(unittest.TestCase):
    """Python and the binary, side by side on one brain, the binary's window
    enclosing Python's the way shadow mode runs them."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name).resolve()
        self.brain = self.folder / 'brain'
        self.brain.mkdir()
        self.outside = self.folder / 'outside'
        self.outside.mkdir()
        self.base = dict(os.environ, HOME=str(self.folder / 'home'), CHEWBACCA_HOME=str(self.folder / 'shared'),
                         PERSONAL_CONTEXT_DIR=str(self.brain), CHEWBACCA_WATCH_DIR=str(self.folder / 'watch'),
                         TMPDIR=str(self.folder))
        self.base.pop('PUBLIC_CONTEXT_DIR', None)
        self.git('init', '-q')
        (self.brain / '.gitignore').write_text('ignored/\n')
        for name in ('notes/a.md', 'notes/b.md', 'memory/c.md'):
            (self.brain / name).parent.mkdir(exist_ok=True)
            (self.brain / name).write_text(name)
        self.git('add', '.')
        self.commit('seed')
        self.watcher = Watcher(self.base, self.brain)
        # Late-bound: a test that restarts the watcher replaces self.watcher,
        # and the replacement must be the one stopped.
        self.addCleanup(lambda: self.watcher.stop())
        self.calls = 0

    def git(self, *args):
        subprocess.run(['git', *args], cwd=self.brain, env=self.base, capture_output=True, check=True)

    def commit(self, message):
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=f@example.invalid', 'commit', '-q', '-m', message)

    def env_for(self, who):
        env = dict(self.base, CHEWBACCA_WRITE_LOG=str(self.folder / f'{who}.tsv'),
                   CHEWBACCA_SESSION_STATE=str(self.folder / f'{who}-state'))
        if who == 'rust':
            env.update(CHEWBACCA_WRITELOG_BIN=str(BIN), CHEWBACCA_WRITELOG_MODE='rust')
        else:
            env['CHEWBACCA_WRITELOG_MODE'] = 'python'
        return env

    def hook(self, who, event, data, tool, cwd, call):
        payload = {'hook_event_name': event, 'session_id': 'parity', 'tool_name': tool,
                   'tool_use_id': call, 'cwd': str(cwd), 'tool_input': data}
        result = subprocess.run(['bash', str(HOOK)], input=json.dumps(payload), text=True,
                                capture_output=True, cwd=str(cwd), env=self.env_for(who), timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('unavailable', result.stderr)
        self.assertNotIn('incomplete', result.stderr)

    def rows(self, who):
        path = self.folder / f'{who}.tsv'
        lines = path.read_text().splitlines() if path.exists() else []
        return sorted(tuple(line.split('\t')[1:]) for line in lines)

    def call(self, action, data=None, tool='Bash', cwd=None):
        self.calls += 1
        call = f'call-{self.calls}'
        data = {'command': 'ls'} if data is None else data
        cwd = cwd or self.outside
        self.hook('rust', 'PreToolUse', data, tool, cwd, call)
        self.hook('python', 'PreToolUse', data, tool, cwd, call)
        if self.watcher.proc.poll() is None:
            # The binary read the brain from the journal, not from a status.
            snaps = list((self.folder / 'rust-state').glob('*.rw.json'))
            self.assertTrue(snaps)
            modes = [json.loads(p.read_text())['mode'] for p in snaps]
            self.assertEqual(set(modes), {'journal'})
        action()
        self.hook('python', 'PostToolUse', data, tool, cwd, call)
        self.hook('rust', 'PostToolUse', data, tool, cwd, call)
        self.assertEqual(self.rows('rust'), self.rows('python'))

    def write(self, name, text):
        path = self.brain / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def test_scenarios_log_the_same_rows(self):
        b = self.brain
        self.call(lambda: None)
        self.call(lambda: self.write('notes/a.md', 'edited'))
        self.call(lambda: self.write('raw/new.md', 'new'))
        self.call(lambda: (b / 'notes/b.md').unlink())
        self.call(lambda: None)  # a.md and new.md stay dirty, nothing new
        self.call(lambda: self.write('notes/a.md', 'edited again'))
        self.call(lambda: self.write('notes/a.md', 'notes/a.md'))  # back to committed: dirty to clean
        self.call(lambda: self.write('ignored/x.md', 'git never reports this'))
        self.call(lambda: (b / 'raw').rename(b / 'raw2'))
        self.call(lambda: os.symlink('notes', str(b / 'link')))
        self.call(lambda: (self.git('add', '.'), self.commit('another session')))
        for n in range(30):
            self.write(f'bulk/{n}.md', str(n))
        self.call(lambda: [self.write(f'bulk/{n}.md', 'x' * n) for n in range(0, 30, 3)])
        edit = b / 'memory/c.md'
        self.call(lambda: edit.write_text('exact'), {'file_path': str(edit), 'content': 'exact'}, tool='Write')
        self.call(lambda: (self.write('memory/d.md', 'committed here'), self.git('add', '.'), self.commit('mine')),
                  {'command': f'cd {b} && git commit'}, cwd=self.outside)
        self.assertGreater(len(self.rows('python')), 10)

    def test_review_shapes_log_the_same_rows(self):
        # Review, 2026-10-11: a .gitignore edit changes what status reports
        # with no event on the files it covers, and git reports precomposed
        # names while FSEvents reports what is on disk.
        self.call(lambda: self.write('notes/tmp.md', 'untracked and dirty'))
        self.call(lambda: self.write('.gitignore', 'ignored/\nnotes/tmp.md\n'))
        self.call(lambda: self.write('notes/tmp.md', 'ignored now'))
        decomposed = 'cafe\u0301.md'
        self.call(lambda: self.write(f'raw/{decomposed}', 'accented'))
        self.call(lambda: (self.brain / 'raw' / decomposed).unlink())

    def test_watcher_restart_mid_call_keeps_the_call(self):
        # Review, 2026-10-11: a restart reseeded the state and dropped every
        # brain row of the calls in flight.
        def restart_and_write():
            self.write('notes/a.md', 'before the restart')
            subprocess.run([str(BIN), 'status'], env=self.base, capture_output=True)
            self.hook('rust', 'PostToolUse', {'command': 'ls'}, 'Bash', self.outside, 'other-tab')
            self.watcher.stop()
            self.watcher = Watcher(self.base, self.brain)
            self.write('raw/after.md', 'after the restart')
        self.call(lambda: self.write('raw/one.md', 'first'))
        self.call(restart_and_write)
        self.call(lambda: self.write('raw/two.md', 'next generation'))
        self.assertEqual(len(self.rows('python')), 4)

    def test_shadow_mode_writes_beside_the_log_and_matches_it(self):
        # The shadow run never touches the real log, and a command quoting
        # the Pre event name still runs the binary in the right order.
        env = dict(self.base, CHEWBACCA_WRITELOG_BIN=str(BIN), CHEWBACCA_WRITELOG_MODE='shadow',
                   CHEWBACCA_WRITE_LOG=str(self.folder / 'real.tsv'),
                   CHEWBACCA_SESSION_STATE=str(self.folder / 'real-state'))
        data = {'command': 'grep \'"hook_event_name": "PreToolUse"\' notes'}
        for n in range(3):
            for event in ('PreToolUse', 'PostToolUse'):
                if event == 'PostToolUse':
                    self.write(f'raw/shadow-{n}.md', 'x')
                payload = {'hook_event_name': event, 'session_id': 'shadow', 'tool_name': 'Bash',
                           'tool_use_id': f'shadow-{n}', 'cwd': str(self.outside), 'tool_input': data}
                result = subprocess.run(['bash', str(HOOK)], input=json.dumps(payload), text=True,
                                        capture_output=True, cwd=str(self.outside), env=env, timeout=20)
                self.assertEqual(result.returncode, 0, result.stderr)
        real = (self.folder / 'real.tsv').read_text().splitlines()
        shadow = (self.folder / 'real.shadow.tsv').read_text().splitlines()
        self.assertEqual(len(real), 3)
        self.assertEqual(sorted(r.split('\t', 1)[1] for r in real), sorted(r.split('\t', 1)[1] for r in shadow))
        parity = subprocess.run([sys.executable, str(ROOT / 'tools/writelog_parity.py'),
                                 '--log', str(self.folder / 'real.tsv'), '--shadow', str(self.folder / 'real.shadow.tsv')],
                                capture_output=True, text=True)
        self.assertEqual(parity.returncode, 0, parity.stdout)

    def test_watcher_dying_mid_call_falls_back_to_a_real_status(self):
        def kill_and_write():
            self.watcher.stop()
            self.write('notes/a.md', 'written after the watcher died')
        self.call(lambda: self.write('raw/one.md', 'first'))
        self.call(kill_and_write)
        self.call(lambda: self.write('raw/two.md', 'no watcher at all'))
        self.assertEqual(len(self.rows('python')), 3)


@unittest.skipIf(BIN is None, 'no cargo on this machine')
class CrateTests(unittest.TestCase):
    def test_the_crate_unit_tests_pass(self):
        # The ports of pathlib, the cd regex, JSON and SHA-256 each carry
        # cases checked against Python itself.
        result = subprocess.run(['cargo', 'test', '--quiet', '--release', '--manifest-path', str(CRATE / 'Cargo.toml')],
                                env=dict(os.environ, CARGO_TARGET_DIR=str(TARGET)), capture_output=True, text=True,
                                timeout=600)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


@unittest.skipIf(BIN is None, 'no cargo on this machine')
class WatcherLifetime(unittest.TestCase):
    def test_the_watcher_exits_when_its_root_is_gone(self):
        # 2026-10-11: six test and scratch watchers outlived their temp
        # brains, each holding an FSEvents stream on a directory that no
        # longer existed.
        folder = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(shutil.rmtree, folder, True)
        brain = folder / 'brain'
        brain.mkdir()
        subprocess.run(['git', 'init', '-q'], cwd=brain, check=True)
        env = dict(os.environ, CHEWBACCA_WATCH_DIR=str(folder / 'watch'))
        watcher = Watcher(env, brain)
        self.addCleanup(watcher.stop)
        shutil.rmtree(brain)
        for _ in range(100):
            if watcher.proc.poll() is not None:
                break
            time.sleep(0.05)
        self.assertIsNotNone(watcher.proc.poll(), 'the watcher kept running on a deleted root')


def hook_cpu(env, cwd, runs=3):
    """Best-of-N CPU of the hook, Pre plus Post, children included."""
    best = None
    for n in range(runs):
        before = resource.getrusage(resource.RUSAGE_CHILDREN)
        for event in ('PreToolUse', 'PostToolUse'):
            payload = {'hook_event_name': event, 'session_id': 'cpu', 'tool_name': 'Bash',
                       'tool_use_id': f'cpu-{n}', 'cwd': str(cwd), 'tool_input': {'command': 'ls'}}
            subprocess.run(['bash', str(HOOK)], input=json.dumps(payload), text=True,
                           capture_output=True, cwd=str(cwd), env=env, timeout=30, check=True)
        after = resource.getrusage(resource.RUSAGE_CHILDREN)
        spent = (after.ru_utime - before.ru_utime) + (after.ru_stime - before.ru_stime)
        best = spent if best is None else min(best, spent)
    return best


@unittest.skipIf(BIN is None, 'no cargo on this machine')
class HookCost(unittest.TestCase):
    def test_a_bash_call_beside_a_big_brain_costs_under_50_ms(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp).resolve()
            brain = folder / 'brain'
            brain.mkdir()
            subprocess.run(['git', 'init', '-q'], cwd=brain, check=True)
            # 6,000 untracked files, half the brain's 12,119 dirty on 2026-10-11.
            for d in range(60):
                target = brain / f'raw/creator-{d}'
                target.mkdir(parents=True)
                for i in range(100):
                    (target / f'{i}.md').write_text('x')
            env = dict(os.environ, HOME=str(folder / 'home'), CHEWBACCA_HOME=str(folder / 'shared'),
                       PERSONAL_CONTEXT_DIR=str(brain), CHEWBACCA_WATCH_DIR=str(folder / 'watch'),
                       CHEWBACCA_WRITELOG_BIN=str(BIN), CHEWBACCA_WRITELOG_MODE='rust', TMPDIR=str(folder))
            env.pop('PUBLIC_CONTEXT_DIR', None)
            outside = folder / 'outside'
            outside.mkdir()
            watcher = Watcher(env, brain)
            try:
                hook_cpu(env, outside, runs=1)  # first sight: one full status seeds the state
                spent = hook_cpu(env, outside)
            finally:
                watcher.stop()
            # 2026-10-11, load 6: 0.017 to 0.020 s here, against 0.61 s for
            # write_log.py on the same brain, and 0.74 s on main's hook in
            # this test. 0.05 s is the reengineer plan's line.
            self.assertLess(spent, 0.05, f'write-log cost {spent:.3f} s of CPU for one Bash call')


if __name__ == '__main__':
    unittest.main()
