import os
import tempfile
import unittest
from pathlib import Path

from perplexity_code.session_store import load_session, save_current, save_snapshot, list_sessions


class SessionStoreTests(unittest.TestCase):
    def test_save_and_load_current(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            save_current(root, [{"role": "user", "content": "hi"}], "ask", ["a.py"], ["summary"])
            state = load_session(root, "current")
            self.assertEqual(state["mode"], "ask")
            self.assertEqual(state["recent_files"], ["a.py"])
            self.assertEqual(state["summary"], ["summary"])
            self.assertEqual(state["history"][0]["content"], "hi")

    def test_save_snapshot_and_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            save_snapshot(root, [], "ask", [], [])
            sessions = list_sessions(root)
            self.assertEqual(len(sessions), 1)
            self.assertTrue(sessions[0].startswith("session-"))


if __name__ == "__main__":
    unittest.main()
