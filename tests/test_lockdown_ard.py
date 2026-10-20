import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import subprocess
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/lockdown_ard'))
from switch import Switch


class SwitchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.enabled = Path(self.tmp.name) / 'enabled'
        self.pending = Path(self.tmp.name) / 'pending'
        self.calls = []
        self.running = False
        self.state = {'screenCapture': 1, 'postEvent': 1}
        self.switch = Switch(self.pending, self.enabled, self.command,
                             lambda: self.state, lambda: self.running)

    def command(self, *args):
        self.calls.append(args)
        if '-deactivate' in args:
            self.assertTrue(self.pending.exists())
            self.enabled.unlink()
        else:
            self.enabled.touch()

    def test_roundtrip_and_no_repeated_commands(self):
        self.enabled.touch()
        self.running = True
        self.switch.step()
        self.switch.step()
        self.assertEqual(len(self.calls), 1)
        self.running = False
        self.switch.step()
        self.switch.step()
        self.assertEqual(len(self.calls), 2)
        self.assertFalse(self.pending.exists())
        self.assertTrue(self.enabled.exists())

    def test_originally_off_stays_off(self):
        self.running = True
        self.switch.step()
        self.running = False
        self.switch.step()
        self.assertEqual(self.calls, [])

    def test_crash_recovery(self):
        self.pending.write_text(json.dumps(self.state))
        self.switch.step()
        self.assertTrue(self.enabled.exists())
        self.assertFalse(self.pending.exists())

    def test_missing_permissions_prevents_pause(self):
        self.enabled.touch()
        self.running = True
        self.state['postEvent'] = 0
        with self.assertRaises(RuntimeError):
            self.switch.step()
        self.assertEqual(self.calls, [])
        self.assertFalse(self.pending.exists())

    def test_failed_restore_retains_recovery_record(self):
        self.pending.write_text(json.dumps(self.state))
        self.state = {'screenCapture': 0, 'postEvent': 1}
        with self.assertRaises(RuntimeError):
            self.switch.step()
        self.assertTrue(self.pending.exists())

    def test_prepared_launch_pauses_before_browser_starts(self):
        self.enabled.touch()
        with patch('switch.subprocess.run', return_value=subprocess.CompletedProcess([], 1)):
            self.switch.prepare()
        self.assertFalse(self.enabled.exists())
        self.assertTrue(self.pending.exists())
        self.switch.step()
        self.assertFalse(self.enabled.exists())
        self.switch.prepare_until = 0
        self.switch.step()
        self.assertTrue(self.enabled.exists())

    def test_refuses_launch_if_agent_is_still_running(self):
        self.enabled.touch()
        with patch('switch.subprocess.run', return_value=subprocess.CompletedProcess([], 0)):
            with self.assertRaises(RuntimeError):
                self.switch.prepare()
        self.assertEqual(self.switch.prepare_until, 0)
        self.switch.step()
        self.assertTrue(self.enabled.exists())


class LauncherTests(unittest.TestCase):
    # The helper holds Full Disk Access, so a user who could run it with their
    # own PYTHONPATH would run code under that grant.
    def test_launcher_refuses_non_root(self):
        source = Path(__file__).resolve().parents[1] / 'tools/lockdown_ard/launcher.c'
        with tempfile.TemporaryDirectory() as tmp:
            binary = Path(tmp) / 'launcher'
            subprocess.run(['/usr/bin/cc', '-o', str(binary), str(source)], check=True)
            result = subprocess.run([str(binary)], capture_output=True, text=True,
                                    env={'PYTHONPATH': tmp})
        self.assertEqual(result.returncode, 1)
        self.assertIn('root only', result.stderr)
        self.assertIn('execve(child[0], child, envp)', source.read_text())

if __name__ == '__main__':
    unittest.main()
