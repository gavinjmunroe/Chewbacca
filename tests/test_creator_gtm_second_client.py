"""The creator GTM tools run as one product for a second, made-up client, with no network.

Hearthside Talent (library/gtm/brand-buyer/clients/hearthside.json) has a different roster,
brands, column names, signals, weights, ready value and people-search keywords from the first
client. One fake provider answers every data step. The chain:

  brand_buyer    finds the buyer at two brands; the third's search is empty and next-move
                 reads the brand's site and reruns on the parent it names
  spend_now      ranks the three brands from dated, Jev-checked evidence with this client's weights
  follow_buyers  turns a past buyer's job change into a warm row
  deliver        puts every handed contact in the intro ledger under client id "hearthside"

Any Clay call fails the test. Run: python3 -I tests/test_creator_gtm_second_client.py
"""
import datetime as dt
import io
import json
import os
import re
import shutil
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "tools", "creator_gtm"))
sys.path.insert(0, os.path.join(ROOT, "tools", "creator_gtm", "intro_ledger"))
from test_brand_buyer import _Base, fake_jev, person  # noqa: E402
import brand_buyer as L  # noqa: E402
from creator_gtm import provider as P  # noqa: E402
import deliver as D  # noqa: E402
import follow_buyers as F  # noqa: E402
import ledger as LG  # noqa: E402
import spend_now as SN  # noqa: E402

CLIENT_DIR = os.path.join(ROOT, "library", "gtm", "brand-buyer", "clients")
TODAY = dt.date(2026, 10, 16)

DANA_URL = "https://www.linkedin.com/in/dana-whitfield-demo/"
PRIYA = person("Priya Nair", "Influencer Partnerships Manager")
TOM = person("Tom Becker", "Regional Sales Manager")
RUTH = person("Ruth Alvarez", "Social Media and Creator Program Lead")
OWEN = person("Owen Park", "Brand Partnerships Director")
DANA = person("Dana Whitfield", "Head of Creator Partnerships", url=DANA_URL)
KAI = person("Kai Moreno", "Content Partnerships Manager")

PEOPLE = {
    "copperleafcookware.com": [TOM, PRIYA],
    "saltmarshpantry.com": [],
    "tidewaterprovisions.com": [RUTH],
    "emberandoakgrills.com": [OWEN],
    "brightloaf.com": [KAI, DANA],
}
EMAILS = {
    PRIYA["url"]: "priya.nair@copperleafcookware.com",
    RUTH["url"]: "ruth@tidewaterprovisions.com",
    OWEN["url"]: "owen@emberandoakgrills.com",
    DANA_URL: "dana@brightloaf.com",
    KAI["url"]: "kai@brightloaf.com",
}
SCORES = {"Priya Nair": 1.9, "Tom Becker": 0.1, "Ruth Alvarez": 1.6, "Owen Park": 1.8,
          "Dana Whitfield": 0.4, "Kai Moreno": 1.7}
# Saltmarsh's footer names its parent and links the parent's careers site, the shape next-move
# trusts ("owned_and_linked"), so the parent's emails count as the brand's.
SITES = {"saltmarshpantry.com": {
    "site_text": "Recipes | Stockists | Contact. Saltmarsh Pantry is part of Tidewater Provisions Group. "
                 "© 2026 Saltmarsh Pantry LLC",
    "links": ["saltmarshpantry.com", "careers.tidewaterprovisions.com", "www.instagram.com"]}}


def no_clay(op, *a, **kw):
    raise AssertionError(f"Clay was called ({op}) for a client on the fake provider")


class FakeProvider(P.Provider):
    """Canned answers for every data step. No table, so the record file is the only copy."""
    name, label = "fake", "Fakesearch"
    calls = []

    def people_search(self, ref, domain, filters=None):
        self.calls.append(("people_search", domain, dict(filters or {})))
        self.record("people_search", cents=1.0)
        return list(PEOPLE.get(domain, []))

    def find_email(self, ref, person):
        self.calls.append(("find_email", person["url"]))
        self.record("find_email", cents=0.5)
        return EMAILS.get(person["url"])

    def verify_email(self, ref, email):
        self.calls.append(("verify_email", email))
        self.record("verify_email", cents=0.2)
        return "valid"


def likes_parent(req):
    """Jev stand-in for next-move: rates the move toward the parent named on the site highest."""
    return {"answers": {q: {"type": "noul", "noul": 0.9 if "tidewaterprovisions" in spec["instructions"] else 0.2}
                        for q, spec in req["questions"].items()}}


def spend_jev(request):
    """Jev stand-in for spend_now: yes to everything except the item marked as a retail job."""
    return {q: {"choice": "no" if "retail" in request["state"].split("\n")[int(q.split("_")[1])].lower() else "yes"}
            for q in request["questions"]}


class SecondClientTest(_Base):
    def setUp(self):
        super().setUp()
        self.saved_providers = dict(P.PROVIDERS)
        self.saved_jev_rank = L.jev_rank
        P.PROVIDERS["fake"] = FakeProvider
        FakeProvider.calls = []
        L.clay = no_clay
        L.SITE_READ = lambda domain: SITES.get(domain, {"site_text": "", "links": []})
        L.NEXT_MOVE_JEV = likes_parent
        # The client file and its seed file, copied so the run writes next to them in tmp.
        for name in ("hearthside.json", "hearthside.buyers.json"):
            shutil.copy(os.path.join(CLIENT_DIR, name), self.tmp.name)
        self.path = os.path.join(self.tmp.name, "hearthside.json")
        with open(self.path) as f:
            cfg = json.load(f)
        cfg["provider"] = "fake"
        with open(self.path, "w") as f:
            json.dump(cfg, f)
        self.out = io.StringIO()

    def tearDown(self):
        P.PROVIDERS.clear()
        P.PROVIDERS.update(self.saved_providers)
        super().tearDown()

    def quiet(self, fn, *a):
        out, err = sys.stdout, sys.stderr
        sys.stdout = sys.stderr = self.out
        try:
            return fn(*a)
        finally:
            sys.stdout, sys.stderr = out, err

    def buyer(self, brand, domain):
        L.jev_rank = fake_jev(SCORES)
        return self.quiet(L.main, [brand, domain, "--live", "--client", self.path])

    def records(self):
        return P.load_records(os.path.join(self.tmp.name, "hearthside.records.json"))["brands"]

    def test_whole_chain_for_a_second_client(self):
        # ── brand_buyer: two direct finds and one empty search that next-move resolves ──
        copper = self.buyer("Copperleaf Cookware", "copperleafcookware.com")
        salt = self.buyer("Saltmarsh Pantry", "saltmarshpantry.com")
        ember = self.buyer("Ember and Oak Grills", "emberandoakgrills.com")

        self.assertEqual(L.PICK_COLUMNS, {"person": "Decision maker", "title": "Role", "why": "Reasoning",
                                          "status": "Stage", "contact": "Handoff"})
        self.assertEqual(copper["result"]["person"], "Priya Nair")
        self.assertEqual(copper["result"]["status"], "Approved")
        self.assertEqual(ember["result"]["person"], "Owen Park")
        self.assertEqual(salt["result"]["person"], "Ruth Alvarez")
        self.assertEqual(salt["result"]["domain"], "tidewaterprovisions.com")
        self.assertEqual(salt["result"]["status"], "Approved")
        self.assertIn("parent tidewaterprovisions.com, after saltmarshpantry.com returned no one", salt["result"]["why"])
        hops = [s for s in salt["steps"] if s.get("step") == "parent fallback"]
        self.assertEqual([h["to"] for h in hops], ["tidewaterprovisions.com"])
        # This client's people-search keywords reached the provider, not the default ones.
        searches = [c for c in FakeProvider.calls if c[0] == "people_search"]
        self.assertTrue(all("creator program" in c[2]["keywords"] and c[2]["limit"] == 4 for c in searches))
        self.assertEqual(L.CLIENT_SLUG, "hearthside")
        self.assertTrue(os.path.exists(os.path.join(self.tmp.name, "hearthside.runs.jsonl")))

        # ── spend_now: this client's signals and weights rank the brands ──
        cfg = SN.load_client(self.path)
        evidence = [
            {"brand": "Ember and Oak Grills", "kind": "launch", "date": "2026-09-20", "url": "https://emberandoak.test/launch",
             "text": "Ember and Oak's smoker launch names twelve paid food creators"},
            {"brand": "Ember and Oak Grills", "kind": "hiring", "date": "2026-10-01", "url": "https://emberandoak.test/jobs/1",
             "text": "Ember and Oak Grills job: Creator Partnerships Manager"},
            {"brand": "Copperleaf Cookware", "kind": "hiring", "date": "2026-09-10", "url": "https://copperleaf.test/jobs/7",
             "text": "Copperleaf Cookware job: Influencer Marketing Lead"},
            {"brand": "Copperleaf Cookware", "kind": "gifting", "date": "2026-03-01", "url": "https://copperleaf.test/gift",
             "text": "Copperleaf seeded pans to recipe creators"},
            {"brand": "Saltmarsh Pantry", "kind": "hiring", "date": "2026-10-05", "url": "https://saltmarsh.test/jobs/2",
             "text": "Saltmarsh Pantry job: Retail Merchandiser"},
        ]
        items = [SN.validate_item(cfg, e, TODAY) for e in evidence]
        self.assertEqual(len(SN.append_evidence(cfg, items)), 5)
        self.assertEqual(SN.check(cfg, TODAY, jev=spend_jev), 5)
        ev = SN.load_evidence(cfg)
        ranked = sorted(((SN.brand_result(ev, b, TODAY, cfg)[0], b) for b in cfg["spend_now"]["brands"]), reverse=True)
        # Ember: launch 45 + hiring 35. Copperleaf: hiring 35 + gifting at 229 days, past the
        # 120-day window, 0. Saltmarsh: its only item is a retail job Jev called no.
        self.assertEqual(ranked, [(80, "Ember and Oak Grills"), (35, "Copperleaf Cookware"), (0, "Saltmarsh Pantry")])
        self.assertIn("judged not creator spend", SN.brand_result(ev, "Saltmarsh Pantry", TODAY, cfg)[2])
        plan = SN.column_plan(cfg)
        self.assertEqual(plan["score"][0], "Creator budget heat")
        self.assertNotIn("gifting_date", plan)  # "columns": false on that signal
        # The table's columns resolve by this client's names; nothing falls back to another client's.
        # The table also has the first client's "Brand" and "Brand Domain" columns, which must
        # never be picked up by default.
        table = [{"name": n, "id": f"f_{i}"} for i, n in enumerate(
            ["Company", "Website", "Stage", "Creator budget heat", "Heat source", "Launch signal date",
             "Launch signal source", "Hiring signal date", "Hiring signal source", "Brand", "Brand Domain"])]
        saved_clay = SN.clay
        SN.clay = lambda op, live=True, write=False, **kw: {"ok": True, "data": table if op == "columns" else None}
        try:
            ids = SN.ensure_columns(cfg, live=False)
            unnamed = SN.ensure_columns({**cfg, "columns": {}}, live=False)
        finally:
            SN.clay = saved_clay
        self.assertEqual((ids["brand"], ids["domain"], ids["status"]), ("f_0", "f_1", "f_2"))
        self.assertEqual((unnamed["brand"], unnamed["domain"]), (None, None))

        # ── follow_buyers: a past buyer's job change becomes a warm row ──
        L.jev_rank = fake_jev(SCORES)
        out = self.quiet(F.main, ["--client", self.path, "--live"])
        warm = next(o for o in out if o.get("seed") == "Dana Whitfield")
        self.assertEqual(warm["result"]["status"], F.WARM)
        self.assertEqual(warm["result"]["email"], "dana@brightloaf.com")
        self.assertIn("Juniper's Table", warm["result"]["why"])
        self.assertIn("Fakesearch's people search at brightloaf.com lists Dana Whitfield there", warm["result"]["why"])
        self.assertEqual(next(o for o in out if o.get("seed") == "Marcus Lee"), {"seed": "Marcus Lee",
                                                                                 "stayed": "Ember and Oak Grills"})

        # ── deliver: every handed contact lands in the intro ledger under this client ──
        with open(self.path) as f:
            client_cfg = json.load(f)
        recs = self.records()
        handed = {k for k, r in recs.items() if D.handed(client_cfg, r["contact"]["status"])}
        self.assertEqual(handed, {"copperleafcookware", "saltmarshpantry", "emberandoakgrills", "brightloafbakeware"})
        book = LG.Ledger(os.path.join(self.tmp.name, "ledger", "ledger.jsonl"))
        report = D.deliver_records(client_cfg, D.records_path(client_cfg, self.path), True, book.append)
        self.assertEqual(report["skipped"], [])
        self.assertEqual(len(report["recorded"]), 4)
        self.assertEqual(book.verify(), (True, None))
        rows = book.for_client("hearthside")
        self.assertEqual(sorted(r["email"] for r in rows), ["dana@brightloaf.com", "owen@emberandoakgrills.com",
                                                            "priya.nair@copperleafcookware.com",
                                                            "ruth@tidewaterprovisions.com"])
        self.assertTrue(all(r["client"] == "hearthside" and r["delivered_for"] == "Juniper Okafor (Juniper's Table)"
                            and r["email_verdict"] == "valid" for r in rows))
        self.assertEqual(len(book.records), 4)
        # A second run records nothing new: each record carries its ledger stamp.
        again = D.deliver_records(client_cfg, D.records_path(client_cfg, self.path), True, book.append)
        self.assertEqual((len(again["recorded"]), len(again["already"])), (0, 4))
        self.assertTrue(all(r.get("delivered", {}).get("ledger", "").startswith("#") for k, r in self.records().items()
                            if k in handed))

        # Nothing the tools printed for this client names another one.
        self.assertNotRegex(self.out.getvalue().lower(), r"sabo|aucta|rawdawg")

    def test_tools_name_no_client(self):
        """The first client's name, ids and file paths live in its client file, never in the tools."""
        paths = [os.path.join(ROOT, "tools", "brand_buyer.py"), os.path.join(ROOT, "tools", "next_move.py")]
        for d, _, files in os.walk(os.path.join(ROOT, "tools", "creator_gtm")):
            paths += [os.path.join(d, f) for f in files if f.endswith(".py")]
        first_client = re.compile(r"sabo|aucta|rawdawg|1149025|t_0tmy|gv_0tmy", re.I)
        hits = []
        for p in paths:
            with open(p) as f:
                hits += [f"{os.path.relpath(p, ROOT)}:{i}" for i, line in enumerate(f, 1) if first_client.search(line)]
        self.assertEqual(hits, [])


if __name__ == "__main__":
    unittest.main()
