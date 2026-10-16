"""Synthetic native provenance; never invokes a sending tool."""
import copy
import json
from pathlib import Path
import subprocess
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

    def test_repair_then_launch_does_not_revoke_on_unrelated_never(self):
        text = "Fix them so they can be relaunched!!!!!!!!!! Then launch them!!!!!!! Then fix the tools to never make that mistake again!!!!!!!!!"
        self.assertIsNotNone(self.read([START, message(text)]))
        self.assertNotIn("repair_scope", self.read([START, message(text)]))

    def test_unrelated_go_cannot_authorize_launch_or_suppression(self):
        for text in ('Go read the campaign results', 'Go fix the tools',
                     'Go go go make the operation low maintenance'):
            self.assertIsNone(self.read([START, message(text)]))

    def test_launch_does_not_grant_suppression_authority(self):
        self.assertNotIn("repair_scope", self.read())

    def test_repair_does_not_override_a_real_stop_or_quoted_instruction(self):
        for text in ('Fix them. Then launch them. Do not send',
                     'Fix them. Then launch them?',
                     'Fix them. He said "Then launch them"'):
            self.assertIsNone(self.read([START, message(text)]))

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
        self.assertIsNone(self.read([START, message("status"), message("Fix them. Then launch them")]))

    def test_missing_start_and_expired_or_future_consent_refuse(self):
        self.assertIsNone(self.read([message("LAUNCH")]))
        self.assertIsNone(self.read(now=1792017012 + 7200))
        self.assertIsNone(self.read(now=1792017011))

    def test_later_stop_revokes_and_explicit_composer_launch_resumes(self):
        rows = [START, message("LAUNCH"), START, message("stop")]
        self.assertIsNone(self.read(rows))
        self.assertIsNotNone(self.read(rows + [START, message("GO")]))

    def test_formatted_and_steered_stops_always_revoke(self):
        for stop in ("Stop\nDo not launch the campaigns", "<stop>", "x" * 400 + " stop",
                     "Don't do it", "Do not proceed", "Don’t do that", "Don't go ahead",
                     "Don't", "Don’t!", "Don't do anything", "Do not do anything", "No.",
                     "Don't do this", "Don't run it.", "Never do this", "Nope"):
            self.assertIsNone(self.read([START, message("LAUNCH"), START, message(stop)]))
            self.assertIsNone(self.read([START, message("LAUNCH"), message(stop)]))


class NativeFallbackTests(unittest.TestCase):
    """Evaluate only the approval selector with mocked I/O, never a sender."""

    def select(self, names=None, missing=False, op="campaign-status", status="active", rec=None):
        source = (Path(__file__).resolve().parents[1] / "bin/chewbacca-clay").read_text()
        selector = source[source.index("function chatApproval("):source.index("function noteChatApproval(")]
        record = rec or {"v": 3, "at": 1792017012, "interactive": True,
                         "source": "native Desktop composer", "session_id": SESSION}
        setup = """
const vm = require('node:vm');
const opts = JSON.parse(process.argv[1]);
let spawned = 0;
const sandbox = {
 FIXTURES: false, CHAT_APPROVAL_MS: 7200000, ROOT: '/unused',
 process: {env: {CODEX_THREAD_ID: '11111111-2222-3333-4444-555555555555'}},
 os: {userInfo: () => ({homedir: '/unused'})}, path: require('node:path'),
 Date: {now: () => 1792017013000},
 fs: {readdirSync: () => {if(opts.missing) throw Error('ENOENT'); return opts.names;},
      readFileSync: () => {throw Error('not a legacy record');}},
 spawnSync: () => {spawned++; return {status: 0, stdout: JSON.stringify(opts.rec)};}
};
vm.runInNewContext(opts.selector, sandbox);
const result = sandbox.chatApproval(opts.op, {body: {status: opts.status}});
process.stdout.write(JSON.stringify({result, spawned}));
"""
        options = {"names": names or [], "missing": missing, "op": op, "status": status,
                   "rec": record, "selector": selector}
        result = subprocess.run(["node", "-e", setup, json.dumps(options)],
                                check=True, capture_output=True, text=True)
        return json.loads(result.stdout)

    def test_missing_legacy_directory_still_reaches_native_launch_reader(self):
        result = self.select(missing=True)
        self.assertEqual(result["result"]["v"], 3)
        self.assertEqual(result["spawned"], 1)

    def test_stop_marker_takes_precedence_over_newer_native_consent(self):
        result = self.select(names=["STOPPED"])
        self.assertIsNone(result["result"])
        self.assertEqual(result["spawned"], 0)

    def test_native_launch_does_not_approve_protective_or_unrelated_writes(self):
        for op in ("blocklist-add", "blocklist-add-bulk", "campaign-update"):
            result = self.select(op=op)
            self.assertIsNone(result["result"])
            self.assertEqual(result["spawned"], 0)

    def test_native_record_must_be_current_and_have_expected_schema(self):
        for change in ({"v": 2}, {"interactive": False}, {"source": "automation"},
                       {"at": 1792000000}, {"at": 1792017020}, {"session_id": "other"}):
            record = {"v": 3, "at": 1792017012, "interactive": True,
                      "source": "native Desktop composer", "session_id": SESSION}
            record.update(change)
            self.assertIsNone(self.select(rec=record)["result"])


if __name__ == "__main__":
    unittest.main()
