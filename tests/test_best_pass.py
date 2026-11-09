#!/usr/bin/env python3
"""best-pass fails weak drafts, says so when it couldn't run, and never calls a read a pass."""
import importlib.machinery
import importlib.util
import unittest
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "bin" / "best-pass"
loader = importlib.machinery.SourceFileLoader("best_pass", str(PATH))
spec = importlib.util.spec_from_loader("best_pass", loader)
bp = importlib.util.module_from_spec(spec)
loader.exec_module(bp)


def answering(score):
    return lambda state, qs: ({k: {"noul": score} for k in qs}, lambda v: v)


class BestPass(unittest.TestCase):
    def test_a_strong_draft_passes(self):
        self.assertEqual(bp.review("email", "hi", "a founder", ask=answering(0.95)), [])

    def test_a_weak_draft_names_what_to_fix(self):
        out = bp.review("linkedin", "hi", "an owner", ask=answering(0.1))
        self.assertTrue(any("note has no pitch" in w for w in out), out)

    def test_a_read_that_cant_run_is_not_a_pass(self):
        self.assertIsNone(bp.review("email", "hi", "a founder", ask=lambda s, q: (None, None)))

    def test_a_missing_answer_is_not_a_pass(self):
        out = bp.review("text", "hi", "a friend", ask=lambda s, q: ({"other": {"noul": 1.0}}, lambda v: v))
        self.assertTrue(out)
        self.assertTrue(all("no answer" in w for w in out))

    def test_a_real_longer_email_clears_the_length_rule_and_a_padded_one_doesnt(self):
        # Real scores: Caleb's sent Travis email 0.34, the padded Reed draft 0.19. At one flat bar of
        # 0.8 every email Caleb really sent failed.
        def scoring(needs):
            return lambda s, qs: ({k: {"noul": needs if k == "only says what it needs" else 0.7} for k in qs}, lambda v: v)

        self.assertEqual(bp.review("email", "hi", "a partner", ask=scoring(0.34)), [])
        out = bp.review("email", "hi", "a founder", ask=scoring(0.19))
        self.assertEqual(out, ["only says what it needs (0.19)"])

    def test_every_other_rule_still_fails_below_the_common_bar(self):
        out = bp.review("email", "hi", "a founder", ask=answering(0.49))
        self.assertIn("readable on a phone (0.49)", out)

    def test_every_kind_has_its_own_rules(self):
        for kind, rules in bp.KINDS.items():
            self.assertTrue(rules, kind)


if __name__ == "__main__":
    unittest.main()
