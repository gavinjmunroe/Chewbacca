import os
import tempfile
import unittest
from pathlib import Path

from perplexity_code.cli import apply_patch_edit, detect_hallucination_in_answer, extract_json
from perplexity_code.hooks import Hooks
from perplexity_code.logging_hook import log_tool_activity


class HooksTests(unittest.TestCase):
    def test_registry_trigger(self):
        hooks = Hooks()
        calls = []

        def handler(**kwargs):
            calls.append(kwargs["hook_name"])

        hooks.on("pre_tool", handler)
        hooks.trigger("pre_tool", action_type="read_file")
        self.assertEqual(calls, ["pre_tool"])


class CliHelpersTests(unittest.TestCase):
    def test_extract_json(self):
        obj = extract_json('{"type":"answer","message":"ok"}')
        self.assertEqual(obj["type"], "answer")
        self.assertEqual(obj["message"], "ok")

    def test_hallucination_detector(self):
        bad, reason = detect_hallucination_in_answer("This is from docs [1]")
        self.assertTrue(bad)
        self.assertTrue(reason)

    def test_apply_patch_edit(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = os.getcwd()
            os.chdir(tmp)
            try:
                Path("demo.txt").write_text("hello world")
                new_content, diff, error = apply_patch_edit("demo.txt", "world", "there")
                self.assertIsNone(error)
                self.assertIn("hello there", new_content)
                self.assertIn("demo.txt", diff)
            finally:
                os.chdir(old)


class LoggingHookTests(unittest.TestCase):
    def test_logging_hook_writes_jsonl(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = os.getcwd()
            os.chdir(tmp)
            try:
                log_tool_activity(hook_name="pre_tool", action_type="list_dir", path=".")
                log_tool_activity(hook_name="on_error", action_type="unknown", error_type="RuntimeError", error_message="boom")
                log_path = Path("tool_activity.log")
                self.assertTrue(log_path.exists())
                content = log_path.read_text()
                self.assertIn('"hook": "pre_tool"', content)
                self.assertIn('"hook": "on_error"', content)
            finally:
                os.chdir(old)


if __name__ == "__main__":
    unittest.main()
