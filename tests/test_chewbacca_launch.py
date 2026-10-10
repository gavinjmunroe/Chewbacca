"""chewbacca launch, with claude stubbed: seeds with a fixed id, marks the
prompt as launched, hands the same id to the desktop, and fails loudly when
the desktop doesn't open it."""

import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(ROOT, "bin", "chewbacca-launch")

STUB = """#!/bin/bash
echo "$@" >> "$STUB_LOG"
echo "launched_by=$CHEWBACCA_LAUNCHED_BY" >> "$STUB_LOG"
if [ "$1" = "-p" ]; then echo "ready: I own core"; exit 0; fi
if [ "$1" = "--desktop" ]; then
  [ -n "$STUB_DESKTOP_FAIL" ] && { echo "That session is running in the background"; exit 1; }
  echo "Opening session $3 in Claude Desktop"; exit 0
fi
exit 2
"""


class LaunchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.stub = os.path.join(self.tmp, "claude")
        with open(self.stub, "w") as f:
            f.write(STUB)
        os.chmod(self.stub, os.stat(self.stub).st_mode | stat.S_IEXEC)
        self.log = os.path.join(self.tmp, "log")
        self.env = dict(os.environ, CHEWBACCA_CLAUDE_BIN=self.stub, STUB_LOG=self.log,
                        CLAUDE_SESSION_ID="parent-123")

    def launch(self, *extra, env=None):
        return subprocess.run(
            [sys.executable, TOOL, "--name", "Kit core", "--cwd", self.tmp, *extra],
            env=env or self.env, capture_output=True, text=True, timeout=60)

    def test_seeds_and_opens_the_same_session(self):
        r = self.launch("--prompt", "You're the core lane.")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        sid = out["session_id"]
        self.assertEqual(out["desktop_id"], "local_" + sid)
        log = open(self.log).read()
        self.assertIn(f"-p --session-id {sid} --name Kit core", log)
        self.assertIn(f"--desktop --resume {sid}", log)
        self.assertIn("You're the core lane.", log)

    def test_every_call_is_marked_launched(self):
        self.launch("--prompt", "brief")
        marks = [l for l in open(self.log) if l.startswith("launched_by=")]
        self.assertTrue(marks)
        self.assertTrue(all(l.strip() == "launched_by=parent-123" for l in marks))

    def test_desktop_refusal_fails_loudly(self):
        env = dict(self.env, STUB_DESKTOP_FAIL="1")
        r = self.launch("--prompt", "brief", env=env)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("didn't take", r.stderr)

    def test_empty_brief_refused(self):
        r = self.launch("--prompt", "   ")
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(os.path.exists(self.log))


if __name__ == "__main__":
    unittest.main()
