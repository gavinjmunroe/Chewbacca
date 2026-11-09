#!/usr/bin/env python3
"""plan-check's read names what says nothing real, and a read that can't run is never a pass."""
import importlib.machinery
import importlib.util
import unittest
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "bin" / "plan-check"
loader = importlib.machinery.SourceFileLoader("plan_check", str(PATH))
spec = importlib.util.spec_from_loader("plan_check", loader)
pc = importlib.util.module_from_spec(spec)
loader.exec_module(pc)
TEXT = "## Outcome\n\nStuff.\n\n## Review log\n\n- me: fine\n"


def answering(score):
    return lambda state, qs: ({k: {"noul": score} for k in qs}, lambda v: v)


class Read(unittest.TestCase):
    def test_real_text_passes(self):
        self.assertEqual(pc.read_plan(TEXT, ask=answering(0.95)), [])

    def test_filler_names_each_weak_part(self):
        weak = pc.read_plan(TEXT, ask=answering(0.1))
        self.assertTrue(any("review really happened" in w for w in weak), weak)
        self.assertEqual(len(weak), len(pc.READ))

    def test_a_read_that_cant_run_is_none(self):
        self.assertIsNone(pc.read_plan(TEXT, ask=lambda s, q: (None, None)))

    def test_a_crash_in_the_read_is_none(self):
        def boom(s, q):
            raise OSError("no jev")
        self.assertIsNone(pc.read_plan(TEXT, ask=boom))

    def test_a_missing_answer_is_not_a_pass(self):
        weak = pc.read_plan(TEXT, ask=lambda s, q: ({"other": {"noul": 1.0}}, lambda v: v))
        self.assertTrue(weak and all("no answer" in w for w in weak))

    def test_long_sections_are_cut_before_the_call(self):
        seen = {}

        def spy(state, qs):
            seen.update(state["plan"])
            return {k: {"noul": 1.0} for k in qs}, lambda v: v
        pc.read_plan("## Outcome\n\n" + "x" * 9000, ask=spy)
        self.assertLessEqual(len(seen["outcome"]), 2500)


if __name__ == "__main__":
    unittest.main()
