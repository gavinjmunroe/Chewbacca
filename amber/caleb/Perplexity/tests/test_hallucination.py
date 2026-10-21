import unittest

from perplexity_code.cli import detect_hallucination_in_answer


class HallucinationDetectionTests(unittest.TestCase):
    def test_citation_brackets(self):
        bad, reason = detect_hallucination_in_answer("According to source [1], this works.")
        self.assertTrue(bad)
        self.assertIn("citation", reason.lower())

    def test_multiple_citations(self):
        bad, _ = detect_hallucination_in_answer("See [1][2][3] for details.")
        self.assertTrue(bad)

    def test_docs_reference(self):
        bad, _ = detect_hallucination_in_answer("According to the documentation, this is correct.")
        self.assertTrue(bad)

    def test_claude_reference(self):
        bad, _ = detect_hallucination_in_answer("You can configure this in ~/.claude/settings.json")
        self.assertTrue(bad)

    def test_claude_code_reference(self):
        bad, _ = detect_hallucination_in_answer("Claude Code handles this differently.")
        self.assertTrue(bad)

    def test_clean_answer(self):
        bad, reason = detect_hallucination_in_answer("The function returns a list of integers.")
        self.assertFalse(bad)
        self.assertEqual(reason, "")

    def test_empty_answer(self):
        bad, reason = detect_hallucination_in_answer("")
        self.assertFalse(bad)

    def test_bracket_in_code_context(self):
        bad, _ = detect_hallucination_in_answer("Use array[1] to access the second element.")
        self.assertTrue(bad)  # current behavior: any [digit] triggers it


if __name__ == "__main__":
    unittest.main()
