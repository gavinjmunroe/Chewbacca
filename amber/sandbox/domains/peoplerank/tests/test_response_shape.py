"""PeopleRank response-shape tests.

These pin the exact JSON shape that apps/mobile/lib/peoplerank.ts parses, so a
backend change that drops or renames a field is caught here instead of in the
iOS app. They run fully offline: with no OPENAI_API_KEY the relevance signal
falls back to local TF-IDF, and with no ANTHROPIC_API_KEY the grounded answer
is skipped. No network calls, no API spend.

Run: python -m unittest discover -s tests
"""
import os
import sys
import unittest
from pathlib import Path

# Repo root on sys.path so `import api.*` resolves when run from anywhere.
_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from api.people_rank import run_people_rank  # noqa: E402
from api.schemas import ContactIn, MeProfile, PeopleRankRequest  # noqa: E402


# The contract the iOS parser depends on. Keep in sync with peoplerank.ts.
TOP_LEVEL_KEYS = {"query", "count", "people", "answer", "answer_status", "citations"}
PERSON_KEYS = {"contactId", "name", "company", "title", "score", "components", "reason", "profile", "links"}
COMPONENT_KEYS = {"warmth", "centrality", "recency", "relevance"}
PROFILE_KEYS = {"email", "phone", "source"}
CITATION_KEYS = {"marker", "contactId", "name", "company", "title", "score", "rank"}


def _contacts():
    return [
        ContactIn(contactId="c1", name="Ada Lovelace", title="Founder", company="Analytical Engines", city="London"),
        ContactIn(contactId="c2", name="Grace Hopper", title="Engineer", company="Navy", city="New York"),
        ContactIn(contactId="c3", name="Alan Turing", title="Researcher", company="Bletchley", city="London"),
    ]


class ResponseShapeTest(unittest.TestCase):
    def setUp(self):
        # Force the fully-offline path: no embeddings API, no answer model.
        self._saved = {}
        for k in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY"):
            self._saved[k] = os.environ.pop(k, None)
        os.environ["PEOPLERANK_CACHE_DISABLED"] = "1"

    def tearDown(self):
        for k, v in self._saved.items():
            if v is not None:
                os.environ[k] = v
        os.environ.pop("PEOPLERANK_CACHE_DISABLED", None)

    def test_top_level_shape_with_query(self):
        req = PeopleRankRequest(
            query="who do I know in engineering",
            limit=15,
            me=MeProfile(city="London", occupation="Engineer"),
            contacts=_contacts(),
        )
        out = run_people_rank(req)
        self.assertEqual(set(out.keys()), TOP_LEVEL_KEYS)
        self.assertEqual(out["count"], len(out["people"]))
        self.assertIsInstance(out["people"], list)
        self.assertIsInstance(out["citations"], list)
        # No anthropic key -> no answer, status reflects skip/no_key, never None status.
        self.assertIsNone(out["answer"])
        self.assertIn(out["answer_status"], {"no_key", "skipped"})

    def test_person_shape(self):
        req = PeopleRankRequest(query="engineer in London", contacts=_contacts())
        out = run_people_rank(req)
        self.assertTrue(out["people"])
        for p in out["people"]:
            self.assertEqual(set(p.keys()), PERSON_KEYS)
            self.assertEqual(set(p["components"].keys()), COMPONENT_KEYS)
            self.assertEqual(set(p["profile"].keys()), PROFILE_KEYS)
            self.assertIsInstance(p["links"], list)
            # score is a 0..1 float
            self.assertGreaterEqual(p["score"], 0.0)
            self.assertLessEqual(p["score"], 1.0)
            # centrality and recency are still seams, reported as 0.
            self.assertEqual(p["components"]["centrality"], 0.0)
            self.assertEqual(p["components"]["recency"], 0.0)

    def test_citation_shape_falls_back_to_top_n(self):
        # With no answer generated, citations fall back to the top-N people so
        # the app can still render chips.
        req = PeopleRankRequest(query="engineer", contacts=_contacts())
        out = run_people_rank(req)
        self.assertTrue(out["citations"])
        for c in out["citations"]:
            self.assertEqual(set(c.keys()), CITATION_KEYS)
            self.assertTrue(c["marker"].startswith("[[p:"))
            self.assertTrue(c["marker"].endswith("]]"))
            self.assertIn(c["contactId"], {p["contactId"] for p in out["people"]})

    def test_empty_contacts_is_graceful(self):
        req = PeopleRankRequest(query="anyone", contacts=[])
        out = run_people_rank(req)
        self.assertEqual(out["count"], 0)
        self.assertEqual(out["people"], [])
        self.assertEqual(out["citations"], [])
        self.assertEqual(set(out.keys()), TOP_LEVEL_KEYS)

    def test_limit_is_clamped(self):
        many = [ContactIn(contactId=f"c{i}", name=f"Person {i}") for i in range(80)]
        req = PeopleRankRequest(query="person", limit=999, contacts=many)
        out = run_people_rank(req)
        # Hard cap is 50 regardless of requested limit.
        self.assertLessEqual(len(out["people"]), 50)

    def test_no_query_orders_deterministically(self):
        # No query, no warmth -> deterministic alphabetical tie-break by name.
        contacts = [
            ContactIn(contactId="z", name="Zed"),
            ContactIn(contactId="a", name="Aaron"),
            ContactIn(contactId="m", name="Mona"),
        ]
        req = PeopleRankRequest(contacts=contacts)
        out = run_people_rank(req)
        names = [p["name"] for p in out["people"]]
        self.assertEqual(names, ["Aaron", "Mona", "Zed"])

    def test_no_query_warmth_ranks_first(self):
        contacts = [
            ContactIn(contactId="far", name="Far Away", city="Tokyo"),
            ContactIn(contactId="near", name="Near Me", city="London"),
        ]
        req = PeopleRankRequest(me=MeProfile(city="London"), contacts=contacts)
        out = run_people_rank(req)
        self.assertEqual(out["people"][0]["contactId"], "near")
        self.assertGreater(out["people"][0]["components"]["warmth"], 0.0)


if __name__ == "__main__":
    unittest.main()
