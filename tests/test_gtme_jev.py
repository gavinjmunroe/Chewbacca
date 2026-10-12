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
        return {k: {"noul": answers.get(k, 0.0)} for k in questions}, None
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


if __name__ == "__main__":
    unittest.main()
