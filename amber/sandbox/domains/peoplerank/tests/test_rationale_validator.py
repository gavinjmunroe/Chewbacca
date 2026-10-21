"""Rationale validator + scrubber tests.

Cover the voice rules the validator enforces (no em dash, length, sentence
count, banned phrases, name detection) and the strictness toggle, plus the
scrubber that strips AI tells before validation. No network calls.

Run: python -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from api.rationale import scrub_ai_tells, validate_rationale  # noqa: E402


class ValidatorTest(unittest.TestCase):
    def test_accepts_clean_rationale(self):
        text = "You moved here last summer. She has been here six years. Ask her where to eat."
        ok, reason = validate_rationale(text)
        self.assertTrue(ok, reason)

    def test_rejects_empty(self):
        ok, reason = validate_rationale("")
        self.assertFalse(ok)
        self.assertEqual(reason, "empty")

    def test_rejects_em_dash(self):
        text = "You both moved here recently — within a year of each other. Ask her about it."
        ok, reason = validate_rationale(text)
        self.assertFalse(ok)
        self.assertEqual(reason, "em_dash")

    def test_rejects_too_long(self):
        text = ("Word " * 200).strip() + "."
        ok, reason = validate_rationale(text)
        self.assertFalse(ok)
        self.assertTrue(reason.startswith("too_long"))

    def test_rejects_single_sentence(self):
        ok, reason = validate_rationale("You should meet her soon.")
        self.assertFalse(ok)
        self.assertTrue(reason.startswith("sentence_count"))

    def test_rejects_banned_substring_in_strict(self):
        text = "You both want the same thing. This is a perfect match. Ask her to coffee."
        ok, reason = validate_rationale(text, strictness="strict")
        self.assertFalse(ok)
        self.assertTrue(reason.startswith("banned_sub"))

    def test_relaxed_mode_passes_soft_violation(self):
        text = "You both want the same thing. This is a perfect match. Ask her to coffee."
        ok, reason = validate_rationale(text, strictness="relaxed")
        self.assertTrue(ok, reason)

    def test_relaxed_mode_still_rejects_hard_rule(self):
        text = "You both moved here — recently. Ask her about it."
        ok, reason = validate_rationale(text, strictness="relaxed")
        self.assertFalse(ok)
        self.assertEqual(reason, "em_dash")

    def test_rejects_detected_first_name(self):
        text = "You moved here last summer. Sarah has been here six years. Ask her where to eat."
        ok, reason = validate_rationale(text, strictness="strict")
        self.assertFalse(ok)
        self.assertEqual(reason, "person_name_detected")

    def test_place_names_allowed(self):
        text = "You know Austin well. She just landed on the East Side. Show her Rainey Street."
        ok, reason = validate_rationale(text, strictness="strict")
        self.assertTrue(ok, reason)


class ScrubberTest(unittest.TestCase):
    def test_strips_em_dash(self):
        out = scrub_ai_tells("You moved here — last summer.")
        self.assertNotIn("—", out)

    def test_strips_smart_quotes(self):
        out = scrub_ai_tells("She said “hello” to everyone.")
        self.assertNotIn("“", out)
        self.assertNotIn("”", out)

    def test_strips_leading_ai_phrase_and_recapitalizes(self):
        out = scrub_ai_tells("That said, you should meet her.")
        self.assertFalse(out.lower().startswith("that said"))
        self.assertTrue(out[0].isupper())

    def test_double_hyphen_becomes_comma(self):
        out = scrub_ai_tells("You moved here -- last summer.")
        self.assertNotIn("--", out)


if __name__ == "__main__":
    unittest.main()
