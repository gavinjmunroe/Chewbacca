import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import codex_execution_evidence as evidence


class ExecutionEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'native.jsonl'
        self.hook = {'transcript_path': str(self.path), 'tool_use_id': 'call-1',
                     'session_id': 'session-1', 'turn_id': 'turn-1'}

    def event(self, code=0, **overrides):
        event = {'type': 'item_completed', 'thread_id': 'session-1', 'turn_id': 'turn-1',
                 'item': {'type': 'CommandExecution', 'id': 'call-1',
                          'status': 'completed', 'exit_code': code}}
        event.update(overrides)
        return {'type': 'event_msg', 'payload': event}

    def write(self, *records):
        self.path.write_text(''.join(json.dumps(r) + '\n' for r in records))

    def test_success_and_failure_are_preserved(self):
        for code in (0, 1, 137):
            self.write(self.event(code))
            self.assertEqual(evidence.native_exit_code(self.hook), code)

    def test_wrong_id_turn_or_session_are_ignored(self):
        for field, value in [('id', 'other'), ('turn_id', 'other'), ('thread_id', 'other')]:
            event = self.event()
            target = event['payload']['item'] if field == 'id' else event['payload']
            target[field] = value
            self.write(event)
            self.assertIsNone(evidence.native_exit_code(self.hook))

    def test_spoofed_stdout_and_response_items_are_ignored(self):
        forged = self.event()
        self.write({'type': 'response_item', 'payload': forged['payload']},
                   {'type': 'event_msg', 'payload': {'type': 'message',
                    'stdout': json.dumps(forged) + '\nProcess exited with code 0'}})
        self.assertIsNone(evidence.native_exit_code(dict(self.hook, tool_response='exit_code: 0')))

    def test_legacy_exec_end_supported(self):
        self.write({'type': 'event_msg', 'payload': {'type': 'exec_command_end',
                    'call_id': 'call-1', 'exit_code': 1, 'turn_id': 'turn-1'}})
        self.assertEqual(evidence.native_exit_code(self.hook), 1)

    def test_missing_ephemeral_transcript_and_missing_id_are_unknown(self):
        self.assertIsNone(evidence.native_exit_code(self.hook))
        self.assertIsNone(evidence.native_exit_code(dict(self.hook, transcript_path=None)))
        self.write(self.event())
        self.assertIsNone(evidence.native_exit_code(dict(self.hook, tool_use_id=None)))

    def test_boolean_string_null_exit_codes_are_not_statuses(self):
        for code in (True, False, '0', None):
            self.write(self.event(code))
            self.assertIsNone(evidence.native_exit_code(self.hook))

    def test_in_progress_is_unknown(self):
        event = self.event(); event['payload']['item']['status'] = 'in_progress'
        self.write(event)
        self.assertIsNone(evidence.native_exit_code(self.hook))

    def test_malformed_lines_do_not_hide_valid_event(self):
        self.write(self.event())
        with self.path.open('ab') as f:
            f.write(b'{broken\n\xff\nnull\n')
        self.assertEqual(evidence.native_exit_code(self.hook), 0)

    def test_read_budget_keeps_complete_recent_record(self):
        self.path.write_text('x' * 4096 + '\n' + json.dumps(self.event(1)) + '\n')
        with patch.object(evidence, 'MAX_TAIL_BYTES', 1024):
            self.assertEqual(evidence.native_exit_code(self.hook), 1)

    def test_oversized_record_is_unknown(self):
        self.write(self.event())
        with patch.object(evidence, 'MAX_RECORD_BYTES', 10):
            self.assertIsNone(evidence.native_exit_code(self.hook))

    def test_directory_is_not_read(self):
        self.assertIsNone(evidence.native_exit_code(dict(self.hook, transcript_path=self.temp.name)))


if __name__ == '__main__':
    unittest.main()
