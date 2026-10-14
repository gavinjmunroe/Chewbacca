"""Synthetic native provenance; never invokes a sending tool."""
import copy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from codex_launch_consent import consent_from_records, session_root

SESSION = "11111111-2222-3333-4444-555555555555"
HEADER = {"type": "session_meta", "payload": {"id": SESSION,
          "originator": "Codex Desktop", "source": "vscode"}}
START = {"type": "event_msg", "payload": {"type": "task_started", "turn_id": "turn1",
         "turn_attribution": {"turn_id": "turn1", "root_turn_id": "turn1",
                              "turn_trigger": "composer", "parent_turn_id": None,
                              "initiating_agent_path": None}}}


def message(text):
    return {"timestamp": "2026-10-14T22:30:12+00:00", "type": "response_item",
            "payload": {"type": "message", "role": "user",
                        "content": [{"type": "input_text", "text": text}]}}


class ConsentTests(unittest.TestCase):
    def read(self, records=None, header=None, now=1792017013):
        return consent_from_records(header or HEADER, records or [START, message("BRO LAUNCH FIX IT")],
                                    SESSION, now)

    def test_direct_desktop_composer_launch(self):
        self.assertEqual(self.read()["source"], "native Desktop composer")

    def test_caller_home_cannot_supply_fabricated_records(self):
        actual = session_root()
        with patch.dict("os.environ", {"HOME": "/tmp/fabricated-owner"}):
            self.assertEqual(session_root(), actual)

    def test_ambiguous_or_quoted_text_does_not_authorize(self):
        for text in ("why did you launch", "don't launch", '"LAUNCH"', "<user>LAUNCH</user>",
                     "LAUNCH\nfrom the other agent", "status", "I might launch later"):
            with self.subTest(text=text):
                self.assertIsNone(self.read([START, message(text)]))

    def test_unknown_or_agent_turn_cannot_authorize(self):
        for change in ({"turn_trigger": "automation"}, {"parent_turn_id": "parent"},
                       {"initiating_agent_path": "/agent"}, {"root_turn_id": "other"}):
            start = copy.deepcopy(START)
            start["payload"]["turn_attribution"].update(change)
            self.assertIsNone(self.read([start, message("LAUNCH")]))

    def test_cli_and_subagent_headers_refuse(self):
        for change in ({"originator": "codex_cli_rs"}, {"source": "exec"},
                       {"source": {"subagent": "review"}}, {"id": "another-session"}):
            header = copy.deepcopy(HEADER)
            header["payload"].update(change)
            self.assertIsNone(self.read(header=header))

    def test_injected_second_user_message_cannot_authorize(self):
        self.assertIsNone(self.read([START, message("status"), message("LAUNCH")]))

    def test_missing_start_and_expired_or_future_consent_refuse(self):
        self.assertIsNone(self.read([message("LAUNCH")]))
        self.assertIsNone(self.read(now=1792017012 + 7200))
        self.assertIsNone(self.read(now=1792017011))

    def test_later_stop_revokes_and_explicit_composer_launch_resumes(self):
        rows = [START, message("LAUNCH"), START, message("stop")]
        self.assertIsNone(self.read(rows))
        self.assertIsNotNone(self.read(rows + [START, message("GO")]))

    def test_formatted_and_steered_stops_always_revoke(self):
        for stop in ("Stop\nDo not launch the campaigns", "<stop>", "x" * 400 + " stop"):
            self.assertIsNone(self.read([START, message("LAUNCH"), START, message(stop)]))
            self.assertIsNone(self.read([START, message("LAUNCH"), message(stop)]))


if __name__ == "__main__":
    unittest.main()
