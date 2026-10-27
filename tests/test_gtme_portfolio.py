"""gtme-portfolio keeps the firm -invested_in-> company graph, every edge proved on its page.

Fixture sites under GTME_FIXTURES, a fake extractor, a temp graph file: no
network, no model call.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import gtme_portfolio as gpf  # noqa: E402

HOME = '<html><body><a href="/portfolio">Portfolio</a> Seed fund for food founders.</body></html>'
PORTFOLIO = ("<html><body><h1>Our companies</h1>" + "<p>We back founders early. </p>" * 30 +
             '<img alt="Mycelia Foods" src="m.png"><img alt="Oat Lab" src="o.png"></body></html>')


class PortfolioTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        sites = self.tmp / "fx" / "sites"
        sites.mkdir(parents=True)
        (sites / "seedfood.example_.html").write_text(HOME)
        (sites / "seedfood.example_portfolio.html").write_text(PORTFOLIO)
        self.env = {"GTME_FIXTURES": str(self.tmp / "fx"), "GTME_PORTFOLIO_GRAPH": str(self.tmp / "g.json")}
        self._old = {k: os.environ.get(k) for k in self.env}
        os.environ.update(self.env)

    def tearDown(self):
        for k, v in self._old.items():
            os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
        self._tmp.cleanup()

    def test_a_name_the_model_invents_never_becomes_an_edge(self):
        node = gpf.build_one("seedfood.example", "Seed Food Fund",
                             extract=lambda f, u, t: ["Mycelia Foods", "Oat Lab", "Made Up Co", "Seed Food Fund"])
        self.assertEqual([c["name"] for c in node["companies"]], ["Mycelia Foods", "Oat Lab"])
        self.assertTrue(all(c["source"] == "https://seedfood.example/portfolio" for c in node["companies"]))
        self.assertTrue(node["reachable"])

    def test_logo_walls_are_read_through_alt_text(self):
        url, text = gpf.portfolio_page("seedfood.example")
        self.assertEqual(url, "https://seedfood.example/portfolio")
        self.assertIn("Oat Lab", text)

    def test_build_fetches_only_new_firms_and_import_keeps_provenance(self):
        csvf = self.tmp / "inv.csv"
        csvf.write_text("organization,website,email\nSeed Food Fund,seedfood.example,a@seedfood.example\n"
                        "Gone Fund,gone.example,b@gone.example\n")
        calls = []
        args = type("A", (), {"csv": str(csvf), "limit": 0, "workers": 2})()
        gpf.cmd_build(args, extract=lambda f, u, t: calls.append(f) or ["Mycelia Foods"])
        g = gpf.load()
        self.assertEqual(sorted(g["firms"]), ["gone.example", "seedfood.example"])
        self.assertFalse(g["firms"]["gone.example"]["reachable"])
        gpf.cmd_build(args, extract=lambda f, u, t: calls.append(f) or [])
        self.assertEqual(calls, ["Seed Food Fund"], "a firm already in the graph is never fetched twice")
        old = self.tmp / "old.json"
        old.write_text(json.dumps({"firms": {"other.example": {"firm": "Other", "page_url": "https://other.example/p",
                                                               "reachable": True, "companies": [
                                                                   {"name": "Brew Co", "sector": "cpg"}]}}}))
        gpf.cmd_import(type("A", (), {"path": str(old)})())
        node = gpf.load()["firms"]["other.example"]
        self.assertEqual(node["companies"], [{"name": "Brew Co", "source": "https://other.example/p"}])
        self.assertIn("imported from", node["extractor"])

    def test_matches_are_cached_per_pitch_on_the_firm(self):
        g = {"firms": {"seedfood.example": {"firm": "Seed Food Fund", "companies": [
            {"name": "Mycelia Foods", "source": "https://seedfood.example/portfolio"}]}}}
        gpf.save(g)
        g = gpf.load()
        calls = []
        fake = lambda firm, names, pitch: calls.append(pitch) or [("Mycelia Foods", 0.9)]
        self.assertEqual(gpf.matches("Seed Food Fund", ["Mycelia Foods"], "mushroom protein", g, ask=fake),
                         [("Mycelia Foods", 0.9)])
        self.assertEqual(gpf.matches("Seed Food Fund", ["Mycelia Foods"], "mushroom protein", gpf.load(), ask=fake),
                         [("Mycelia Foods", 0.9)])
        self.assertEqual(calls, ["mushroom protein"], "the second ask came from the graph")
        gpf.matches("Seed Food Fund", ["Mycelia Foods"], "payments software", gpf.load(), ask=fake)
        self.assertEqual(len(calls), 2, "a new pitch is a new question")
        self.assertIsNone(gpf.matches("Seed Food Fund", ["X"], "a third pitch", gpf.load(), ask=lambda *a: None))

    def test_a_name_only_match_needs_a_second_look_with_page_context(self):
        # 10/26: W Capital -> Tacala, a Taco Bell franchisee, passed for an MSP founder on its name alone.
        seen = []

        def ask(state, questions, decision=None):
            seen.append(state)
            return {"fit": {"type": "noul", "noul": 0.9 if state["company"] == "Mycelia Foods" else 0.06}}
        got = gpf.confirm_hits("Seed Food Fund", [("Mycelia Foods", 0.72), ("Oat Lab", 0.74)], "mushroom protein",
                               lambda n: "https://seedfood.example/portfolio", ask=ask)
        self.assertEqual(got, [("Mycelia Foods", 0.9)])
        self.assertIn("Mycelia Foods", seen[0]["page_text_around_it"], "the page around the name is the evidence")

    def test_the_tool_names_no_client(self):
        src = (ROOT / "tools" / "gtme_portfolio.py").read_text().lower()
        for word in ("zeutara", "thallus", "junto", "/users/"):
            self.assertNotIn(word, src, word)


if __name__ == "__main__":
    unittest.main(verbosity=1)
