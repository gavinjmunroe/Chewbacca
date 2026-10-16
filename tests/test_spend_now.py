"""spend_now: scoring rules, config-driven signals and columns, evidence intake, and the Clay
writes, with fake clay, fake ATS feeds and a fake Jev so nothing leaves the machine."""
import datetime as dt
import json
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools", "creator_gtm"))
import spend_now as sn  # noqa: E402

TODAY = dt.date(2026, 10, 16)
SIGNALS = [
    {"kind": "outreach", "weight": 35, "label": "Outreach", "columns": False, "question": "q {brand}"},
    {"kind": "campaign", "weight": 30, "label": "Campaign", "question": "q {brand}"},
    {"kind": "hiring", "weight": 25, "label": "Hiring", "question": "q {brand}"},
    {"kind": "funding", "weight": 10, "label": "Funding", "question": "q {brand}"},
]


def client(tmp, **spend):
    cfg = {"client_slug": "acme", "ws": "1", "table": "t_acme", "view": "gv_acme",
           "columns": {"brand": "Brand", "domain": "Brand Domain", "status": "Status"},
           "spend_now": {"signals": SIGNALS, "budget_reset": "01-01", "evidence": "ev.jsonl",
                         "brands": {"Klarna": "klarna.com", "Altra": "altrarunning.com"}, **spend}}
    path = os.path.join(tmp, "acme.json")
    with open(path, "w") as f:
        json.dump(cfg, f)
    return sn.load_client(path)


def item(brand="Klarna", kind="campaign", date="2026-10-01", jev="yes", url="https://x.test/a", text="t"):
    return {"brand": brand, "kind": kind, "date": date, "jev": jev, "url": url, "text": text}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.cfg = client(self.tmp)

    def score(self, items, today=TODAY, cfg=None):
        return sn.score_brand(items, today, cfg or self.cfg)


class Rules(Base):
    def test_window_edges(self):
        self.assertEqual(self.score([item(date="2026-07-18")])[0], 30)  # 90 days, full
        self.assertEqual(self.score([item(date="2026-07-17")])[0], 15)  # 91, half
        self.assertEqual(self.score([item(date="2026-04-19")])[0], 15)  # 180, half
        self.assertEqual(self.score([item(date="2026-04-18")])[0], 0)   # 181, none

    def test_budget_reset_halves_last_years_items(self):
        self.assertEqual(self.score([item(date="2025-12-20")], dt.date(2026, 2, 24))[0], 15)
        self.assertEqual(sn.last_reset(dt.date(2026, 3, 1), "07-01"), dt.date(2025, 7, 1))

    def test_unconfirmed_undated_or_unsourced_never_score(self):
        for bad in (item(jev="unchecked"), item(jev="no"), item(date=""), item(url=""), item(url="mb10k.com")):
            self.assertEqual(self.score([bad])[0], 0, bad)

    def test_newest_confirmed_item_per_kind_counts_once(self):
        s, best = self.score([item(date="2026-05-01"), item(date="2026-10-01", url="https://x.test/new")])
        self.assertEqual((s, best["campaign"]["url"]), (30, "https://x.test/new"))

    def test_weights_come_from_config(self):
        cfg = client(self.tmp, signals=[{"kind": "campaign", "weight": 70, "question": "q"},
                                        {"kind": "hiring", "weight": 30, "question": "q"}])
        self.assertEqual(self.score([item(), item(kind="hiring"), item(kind="funding")], cfg=cfg)[0], 100)
        self.assertIn("campaign 70, hiring 30", sn.score_description(cfg))

    def test_stale_item_still_shows_its_date(self):
        _, best = self.score([item(date="2026-01-27")])
        self.assertEqual(best["campaign"]["points"], 0)
        self.assertIn("Newest: 2026-01-27 (262 days)", sn.evidence_line(best, TODAY))

    def test_evidence_line(self):
        _, best = self.score([item(text="Pearpop case study", url="https://p.test")])
        self.assertEqual(sn.evidence_line(best, TODAY), "2026-10-01 (15 days, campaign): Pearpop case study https://p.test")
        line = sn.evidence_line({}, TODAY, [item(jev="no"), item(jev="no", date="2026-10-09", text="Field Ambassador")])
        self.assertIn("2 dated items checked", line)
        self.assertIn("newest 2026-10-09: Field Ambassador", line)

    def test_column_plan_skips_signals_without_columns(self):
        plan = sn.column_plan(self.cfg)
        self.assertEqual(plan["score"], ("Spending now", "number"))
        self.assertEqual(plan["hiring_date"], ("Hiring signal date", "date"))
        self.assertNotIn("outreach_date", plan)

    def test_config_without_signals_is_refused(self):
        path = os.path.join(self.tmp, "bad.json")
        with open(path, "w") as f:
            json.dump({"spend_now": {"brands": {"A": "a.com"}}}, f)
        with self.assertRaises(sn.Failed):
            sn.load_client(path)


class Intake(Base):
    def test_validate_refuses_unknown_brand_kind_bad_url_or_date(self):
        good = {"brand": "Klarna", "kind": "campaign", "date": "2026-08-03", "url": "https://p.test", "text": "t"}
        self.assertEqual(sn.validate_item(self.cfg, good, TODAY)["jev"], "unchecked")
        for bad in ({"brand": "Nike"}, {"kind": "vibes"}, {"url": "p.test"}, {"date": "Aug 3"}, {"text": ""}):
            with self.assertRaises(sn.Failed):
                sn.validate_item(self.cfg, {**good, **bad}, TODAY)

    def test_append_dedupes_on_brand_kind_url_even_within_a_batch(self):
        a = item(url="https://j.test/1")
        self.assertEqual(len(sn.append_evidence(self.cfg, [a, dict(a)])), 1)
        self.assertEqual(len(sn.append_evidence(self.cfg, [a])), 0)

    def test_collect_keeps_creator_titles_in_window_and_records_jev(self):
        cfg = client(self.tmp, ats={"Klarna": {"workable": "klarna"}, "Altra": {"greenhouse": "altra"}})
        feeds = {
            "https://apply.workable.com/api/v1/widget/accounts/klarna": {"jobs": [
                {"published_on": "2026-10-01", "title": "Influencer Marketing Manager", "city": "NYC", "url": "https://j/1"},
                {"published_on": "2026-10-01", "title": "Field Marketing Ambassador", "city": "LA", "url": "https://j/2"},
                {"published_on": "2026-10-01", "title": "Backend Engineer", "city": "NYC", "url": "https://j/3"},
                {"published_on": "2025-01-01", "title": "Creator Lead", "city": "NYC", "url": "https://j/4"}]},
        }

        def fetch(url):
            if url not in feeds:
                raise OSError("404")
            return feeds[url]

        asked = []

        def jev(req):
            asked.append(req)
            return {"item_0": {"choice": "yes"}, "item_1": {"choice": "no"}}

        found = sn.collect(cfg, TODAY, fetch=fetch, jev=jev)
        self.assertEqual([(f["url"], f["jev"]) for f in found], [("https://j/1", "yes"), ("https://j/2", "no")])
        self.assertEqual(len(asked), 1)  # Altra's dead board is skipped, not asked about

    def test_jev_failure_leaves_items_unchecked(self):
        sn.append_evidence(self.cfg, [{**item(), "jev": "unchecked"}])

        def broken(req):
            raise KeyError("answers")

        self.assertEqual(sn.check(self.cfg, TODAY, jev=broken), 0)
        self.assertEqual(sn.load_evidence(self.cfg)[0]["jev"], "unchecked")

    def test_each_kind_is_asked_its_own_question(self):
        cfg = client(self.tmp, signals=[{"kind": "campaign", "weight": 50, "question": "SPEND {brand}?"},
                                        {"kind": "funding", "weight": 50, "question": "MONEY {brand}?"}])
        seen = {}

        def jev(req):
            seen.update({k: v["instructions"] for k, v in req["questions"].items()})
            return {k: {"choice": "yes"} for k in req["questions"]}

        sn.jev_check(cfg, "Klarna", [item(), item(kind="funding")], jev)
        self.assertIn("SPEND Klarna?", seen["item_0"])
        self.assertIn("MONEY Klarna?", seen["item_1"])


class Writes(Base):
    def setUp(self):
        super().setUp()
        sn.append_evidence(self.cfg, [item()])
        self.calls = []
        self.cols = [{"name": "Brand", "id": "f_brand"}, {"name": "Brand Domain", "id": "f_domain"},
                     {"name": "Status", "id": "f_status"}]
        self._clay = sn.clay

        def fake(op, live=True, write=False, **kw):
            self.calls.append((op, live, write, kw))
            if op == "columns":
                return {"ok": True, "data": list(self.cols)}
            if op == "add-column" and live:
                self.cols.append({"name": kw["name"], "id": "f_" + kw["name"].replace(" ", "_")})
            if op == "row-ids":
                return {"ok": True, "data": ["r_klarnaAAAAAAAAAAAA", "r_klarnaBBBBBBBBBBBB", "r_otherCCCCCCCCCCCC"]}
            if op == "rows-by-id":
                return {"ok": True, "data": [
                    {"id": "r_klarnaAAAAAAAAAAAA", "cells": {"f_brand": {"value": "Klarna"}}},
                    {"id": "r_klarnaBBBBBBBBBBBB", "cells": {"f_brand": {"value": "Klarna"}}},
                    {"id": "r_otherCCCCCCCCCCCC", "cells": {"f_brand": {"value": "Nike"}}}]}
            if op == "add-rows":
                return {"ok": True, "data": [{"id": "r_newaltraDDDDDDDDDD"}]}
            return {"ok": True}

        sn.clay = fake

    def tearDown(self):
        sn.clay = self._clay

    def ops(self, op):
        return [c for c in self.calls if c[0] == op]

    def test_columns_come_from_config_and_score_gets_its_description(self):
        sn.ensure_columns(self.cfg, live=True)
        made = [c[3]["name"] for c in self.ops("add-column")]
        self.assertEqual(made, ["Spending now", "Spend evidence", "Campaign signal date", "Campaign signal source",
                                "Hiring signal date", "Hiring signal source", "Funding signal date", "Funding signal source"])
        desc = json.loads(self.ops("update-column")[0][3]["update"])["description"]
        self.assertIn("outreach 35, campaign 30, hiring 25, funding 10", desc)

    def test_second_run_makes_no_columns(self):
        sn.ensure_columns(self.cfg, live=True)
        self.calls.clear()
        sn.ensure_columns(self.cfg, live=True)
        self.assertEqual(self.ops("add-column"), [])

    def test_live_write_scores_every_brand_row_and_adds_missing_brands(self):
        sn.write(self.cfg, TODAY, live=True)
        added = json.loads(self.ops("add-rows")[0][3]["records"])
        self.assertEqual(added, [{"f_brand": "Altra", "f_domain": "altrarunning.com",
                                  "f_status": "Needs work: no contact run yet, spend score only"}])
        recs = json.loads(self.ops("update-rows")[0][3]["records"])
        self.assertEqual([r["id"] for r in recs], ["r_klarnaAAAAAAAAAAAA", "r_klarnaBBBBBBBBBBBB", "r_newaltraDDDDDDDDDD"])
        self.assertEqual(recs[0]["cells"]["f_Spending_now"], 30)
        self.assertEqual(recs[0]["cells"]["f_Campaign_signal_date"], "2026-10-01")
        self.assertEqual(recs[2]["cells"]["f_Spending_now"], 0)
        self.assertIsNone(recs[2]["cells"]["f_Hiring_signal_date"])

    def test_dry_run_sends_every_write_as_dry(self):
        sn.write(self.cfg, TODAY, live=False)
        writes = [c for c in self.calls if c[2]]
        self.assertTrue(writes)
        self.assertTrue(all(live is False for _, live, _, _ in writes))
        self.assertEqual(self.ops("update-rows"), [])  # no column ids yet, so nothing to write


if __name__ == "__main__":
    unittest.main()
