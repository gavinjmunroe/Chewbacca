"""gtme-rules: a ruling counts as enforced only when a named check exists, and
client text is refused on the rulings words alone can break."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import gtme_rules as rules  # noqa: E402


def repo_with(rulings, files=None):
    d = Path(tempfile.mkdtemp())
    (d / "DECISIONS.json").write_text(json.dumps({"client": "Acme", "rulings": rulings}))
    for rel, body in (files or {}).items():
        (d / rel).parent.mkdir(parents=True, exist_ok=True)
        (d / rel).write_text(body)
    return d / "DECISIONS.json"


def ruling(id_, refs=None, status="active"):
    r = {"id": id_, "rule": "x", "who": "y", "date": "2026-10-11", "source": "z", "status": status}
    if refs is not None:
        r["enforced_by"] = refs
    return r


class Audit(unittest.TestCase):
    def test_states(self):
        f = repo_with([ruling("a", ["tests/t.py::test_a"]), ruling("b"), ruling("c", ["tests/t.py::test_gone"]),
                       ruling("d", ["missing.py"]), ruling("e", status="superseded")],
                      {"tests/t.py": "def test_a(): pass\n"})
        got = {r["id"]: r["state"] for r in rules.audit([f])}
        self.assertEqual(got, {"a": "ENFORCED", "b": "UNENFORCED", "c": "BROKEN", "d": "BROKEN"})

    def test_kit_refs_resolve_against_the_kit(self):
        f = repo_with([ruling("a", ["kit:tools/gtme_rules.py::def check_text"])])
        self.assertEqual(rules.audit([f])[0]["state"], "ENFORCED")

    def test_strict_fails_on_any_gap(self):
        f = repo_with([ruling("a", ["DECISIONS.json"]), ruling("b")])
        self.assertEqual(rules.main(["audit", "--decisions", str(f), "--strict"]), 1)
        f = repo_with([ruling("a", ["DECISIONS.json"])])
        self.assertEqual(rules.main(["audit", "--decisions", str(f), "--strict"]), 0)


class CheckText(unittest.TestCase):
    def kinds(self, text, facts=None):
        return [k for k, _ in rules.check_text(text, facts)]

    def test_clean_update_passes(self):
        self.assertEqual(self.kinds("Jonah, this week 1,732 emails went out and 62 people replied.",
                                    {"sent": 1732, "replies": 62}), [])

    def test_shorthand_and_greeting(self):
        self.assertIn("client-register", self.kinds("Hey Jonah, sending u the numbers w the deck"))

    def test_process_chatter(self):
        self.assertIn("client-channel", self.kinds("Togari flagged it and the Clay workflow reran."))

    def test_interest_needs_a_quote(self):
        self.assertIn("interest-from-text", self.kinds("Three investors are interested in Ivy."))
        self.assertEqual(self.kinds('One investor wrote "please send over the deck and our team will follow up".'), [])
        self.assertEqual(self.kinds("Nobody has said they are interested yet."), [])

    def test_unsourced_number(self):
        self.assertIn("client-register", self.kinds("We booked 14 meetings.", {"meetings": 0}))

    def test_dash(self):
        self.assertIn("client-register", self.kinds("Strong week — more soon."))

    def test_business_words_are_not_chatter(self):
        self.assertEqual(self.kinds("Their deal pipeline and business model look strong."), [])


if __name__ == "__main__":
    unittest.main()
