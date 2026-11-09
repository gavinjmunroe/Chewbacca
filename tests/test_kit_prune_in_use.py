"""A kit snapshot a live process runs from is never pruned.

2026-10-11: hud-speak ran from snapshot 9528874d and room-capture from
4ee62036 after both had been pruned. Python had closed its script, so lsof
saw nothing; the snapshot path was still in each process's argv. And when
lsof failed, in_use() said nothing was busy, so a slow lsof pruned
everything."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import kit_runtime  # noqa: E402


def fake_run(lsof_out=None, ps_out=None):
    def run(argv, **kwargs):
        if argv[0] == 'lsof':
            if lsof_out is None:
                raise subprocess.TimeoutExpired(argv, 60)
            return subprocess.CompletedProcess(argv, 0, lsof_out, '')
        if argv[0] == 'ps':
            if ps_out is None:
                raise OSError('no ps')
            return subprocess.CompletedProcess(argv, 0, ps_out, '')
        raise AssertionError(argv)
    return run


class InUseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.snaps = Path(self.temp.name).resolve() / 'snapshots'
        self.snaps.mkdir()
        # Never read the live daemon's state: its generations would join every answer.
        env = mock.patch.dict(os.environ, {'CHEWBACCA_DAEMON_DIR': str(Path(self.temp.name) / 'no-daemon')})
        env.start()
        self.addCleanup(env.stop)

    def test_a_snapshot_named_only_in_argv_is_busy(self):
        ps = ('/usr/bin/python3 /x/other\n'
              f'uv run --script {self.snaps}/9528874d/bin/hud-speak --voice af\n'
              f'{self.snaps}/4ee62036/mac/room-capture --watch-mic\n')
        with mock.patch.object(kit_runtime.subprocess, 'run', side_effect=fake_run('', ps)):
            self.assertEqual(kit_runtime.in_use(self.snaps), {'9528874d', '4ee62036'})

    def test_lsof_alone_still_counts(self):
        lsof = f'p1\nn{self.snaps}/aaaa/bin/x\nn/tmp/other\n'
        with mock.patch.object(kit_runtime.subprocess, 'run', side_effect=fake_run(lsof, '')):
            self.assertEqual(kit_runtime.in_use(self.snaps), {'aaaa'})

    def test_when_nothing_can_look_nothing_is_free(self):
        with mock.patch.object(kit_runtime.subprocess, 'run', side_effect=fake_run(None, None)):
            self.assertIsNone(kit_runtime.in_use(self.snaps))

    def test_a_generation_the_daemon_records_for_a_live_pid_is_busy(self):
        # Reengineer step 9: a service run as `bash -lc "$HOME/.local/bin/x"`
        # names no snapshot in argv, and only the daemon's state knows it.
        d = Path(self.temp.name) / 'daemon'
        d.mkdir()
        (d / 'state.json').write_text(json.dumps({
            'svc': {'pid': os.getpid(), 'gen': 'cafe1234'},
            'dead': {'pid': 2 ** 22 + 7, 'gen': 'dead5678'},
            'bad': {'pid': 'x', 'gen': 'bad'}}))
        with mock.patch.dict(os.environ, {'CHEWBACCA_DAEMON_DIR': str(d)}), \
                mock.patch.object(kit_runtime.subprocess, 'run', side_effect=fake_run('', '')):
            self.assertEqual(kit_runtime.in_use(self.snaps), {'cafe1234'})

    def test_prune_removes_nothing_when_it_could_not_look(self):
        for name in ('a1', 'b2', 'c3', 'd4'):
            (self.snaps / name).mkdir()
        removed = []
        with mock.patch.object(kit_runtime, 'in_use', return_value=None), \
                mock.patch.object(kit_runtime, 'remove_snapshot', side_effect=lambda s, d: removed.append(d.name)):
            kit_runtime.prune(Path('/nonexistent'), self.snaps.parent, 'a1')
        self.assertEqual(removed, [])


if __name__ == '__main__':
    unittest.main()
