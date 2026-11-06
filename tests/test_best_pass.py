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
        out = bp.review("text", "hi", "a friend", ask=lambda s, q: ({}, lambda v: v))
        self.assertTrue(out)
        self.assertTrue(all("no answer" in w for w in out))

    def test_every_kind_has_its_own_rules(self):
        for kind, rules in bp.KINDS.items():
            self.assertTrue(rules, kind)


if __name__ == "__main__":
    unittest.main()
