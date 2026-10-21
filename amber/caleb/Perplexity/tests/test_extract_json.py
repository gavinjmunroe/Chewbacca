import unittest

from perplexity_code.cli import extract_json


class ExtractJsonTests(unittest.TestCase):
    def test_valid_json(self):
        result = extract_json('{"type":"answer","message":"ok"}')
        self.assertEqual(result["type"], "answer")
        self.assertEqual(result["message"], "ok")

    def test_json_in_markdown_fence(self):
        result = extract_json('```json\n{"type":"plan","message":"step 1"}\n```')
        self.assertEqual(result["type"], "plan")

    def test_json_embedded_in_text(self):
        result = extract_json('Here is the result: {"type":"answer","message":"done"} end')
        self.assertEqual(result["type"], "answer")

    def test_empty_string_returns_answer(self):
        result = extract_json("")
        self.assertEqual(result["type"], "answer")

    def test_whitespace_only_returns_answer(self):
        result = extract_json("   \n  ")
        self.assertEqual(result["type"], "answer")

    def test_plain_text_becomes_answer(self):
        result = extract_json("just some plain text with no json")
        self.assertEqual(result["type"], "answer")

    def test_all_action_types(self):
        for action in ["answer", "plan", "list_dir", "read_file", "run_shell", "write_file", "write_patch"]:
            result = extract_json(f'{{"type":"{action}","message":"test"}}')
            self.assertEqual(result["type"], action)


if __name__ == "__main__":
    unittest.main()
