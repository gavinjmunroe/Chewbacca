#!/usr/bin/env python3
"""gtme_jev: one Jev call per outbound email, gated in code. Jev is faked here;
each test says what it answered, so nothing reaches the network."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import gtme_jev  # noqa: E402

MAIL = {"line": "Your plan a visit page has no form, only an email link.", "subject": "Grace website",
        "body": "Hi Ann,\n\nYour plan a visit page has no form, only an email link.\n\nIs fixing that on your list?"}
RULINGS = [{"id": "refusals", "rule": "Never offer AI pastoral care or anything that moves money.",
            "jev": "Does this email offer AI pastoral care or anything that moves money?"},
           {"id": "no-question", "rule": "Local churches first."}]


def fake(answers):
    calls = []

    def ask(state, questions):
        calls.append((state, questions))
        if answers is None:
            return None, None
        return {k: ({"score": answers.get(k, 2)} if q["type"] == "score" else {"noul": answers.get(k, 0.0)})
                for k, q in questions.items()}, None
    ask.calls = calls
    return ask


class Review(unittest.TestCase):
    def test_a_clean_email_passes_in_one_call(self):
        ask = fake({"line": 0.93, "rule:refusals": 0.02})
        self.assertEqual(gtme_jev.review(MAIL, RULINGS, ask=ask), [])
        self.assertEqual(len(ask.calls), 1)
        self.assertEqual(set(ask.calls[0][1]), {"line", "rule:refusals"})

    def test_a_vague_or_harsh_opener_is_held(self):
        why = gtme_jev.review(MAIL, RULINGS, ask=fake({"line": 0.31, "rule:refusals": 0.02}))
        self.assertEqual(len(why), 1)
        self.assertIn("opener", why[0])

    def test_breaking_a_ruling_is_held_and_named(self):
        why = gtme_jev.review(MAIL, RULINGS, ask=fake({"line": 0.95, "rule:refusals": 0.71}))
        self.assertIn("Never offer AI pastoral care", why[0])

    def test_no_answer_from_jev_holds_it(self):
        self.assertTrue(gtme_jev.review(MAIL, RULINGS, ask=fake(None)))

    def test_nothing_to_ask_makes_no_call(self):
        ask = fake({})
        self.assertEqual(gtme_jev.review({**MAIL, "line": ""}, [RULINGS[1]], ask=ask), [])
        self.assertEqual(ask.calls, [])


class Grade(unittest.TestCase):
    LONG = {**MAIL, "step": 1, "body": MAIL["body"] + " " + "word " * 50}

    def test_strong_copy_passes_the_85_bar(self):
        ask = fake({"line": 0.95, "rule:refusals": 0.01})
        self.assertEqual(gtme_jev.review(self.LONG, RULINGS, ask=ask, min_grade=85), [])
        self.assertTrue(any(k.startswith("grade:") for k in ask.calls[0][1]))

    def test_weak_copy_is_held_with_its_breakdown(self):
        ask = fake({"line": 0.95, "rule:refusals": 0.01, "grade:situation": 0, "grade:value": 1})
        why = gtme_jev.review(self.LONG, RULINGS, ask=ask, min_grade=85)
        self.assertIn("under 85", why[0])
        self.assertIn("situation 0", why[0])

    def test_follow_ups_are_not_graded(self):
        ask = fake({"line": 0.95})
        gtme_jev.review({**self.LONG, "step": 2}, [], ask=ask, min_grade=85)
        self.assertFalse(any(k.startswith("grade:") for k in ask.calls[0][1]))


class KitJev(unittest.TestCase):
    def test_kit_jev_ignores_a_same_named_module(self):
        # 11/2: tools/jev.py (no ask) shadowed bin/lib/jev.py and every buyer check was held
        import types
        old = sys.modules.get("jev")
        sys.modules["jev"] = types.ModuleType("jev")
        try:
            gtme_jev._KIT_JEV = None
            self.assertTrue(hasattr(gtme_jev.kit_jev(), "ask"))
        finally:
            if old is None:
                sys.modules.pop("jev", None)
            else:
                sys.modules["jev"] = old


if __name__ == "__main__":
    unittest.main()
