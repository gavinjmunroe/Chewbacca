"""`chewbacca gtme creator` runs one creator end to end for the made-up Hearthside client, no network.

The fake provider from test_creator_gtm_second_client answers every data step, Instagram and Jev
are stand-ins, and any Clay call fails the test. The run has to:

  find brands from the creator's sponsored posts (dated from the shortcode, domain from the brand's
  own bio link or the client's list) and from a handed-over brands file, leaving out what has no domain;
  run the chain on each, spending brands first, with the Creator set on every record;
  turn the sponsored posts into spend evidence that Jev checks and that scores;
  copy a contact for a second creator without a paid step, and skip everything on a rerun;
  print every step with its credit estimate on a dry run, and write nothing.

Run: python3 -I tests/test_gtme_creator.py
"""
import datetime as dt
import io
import json
import os
import shutil
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "tools", "creator_gtm"))
import test_creator_gtm_second_client as T2  # noqa: E402
from test_brand_buyer import _Base, fake_jev  # noqa: E402
import brand_buyer as L  # noqa: E402
import creator_run as CR  # noqa: E402
import enrich_catalog as C  # noqa: E402
from creator_gtm import provider as P  # noqa: E402

TODAY = dt.date(2026, 10, 16)
CREATOR = "Juniper Okafor (Juniper's Table)"


def shortcode(day):
    """The shortcode Instagram would give a post made at noon UTC on this day."""
    ms = int(dt.datetime(day.year, day.month, day.day, 12, tzinfo=dt.timezone.utc).timestamp() * 1000)
    n, out = (ms - CR.IG_EPOCH_MS) << 23, ""
    while n:
        n, r = divmod(n, 64)
        out = CR.SHORTCODE[r] + out
    return out


POSTS = {"junipers.table": [
    {"code": shortcode(dt.date(2026, 10, 2)), "caption": "Brisket night on the new smoker from @emberandoakgrills #ad"},
    {"code": shortcode(dt.date(2026, 9, 14)), "caption": "Sunday loaf in my @brightloafbakeware pan, use my code JUNIPER"},
    {"code": shortcode(dt.date(2026, 9, 1)), "caption": "Dinner with @samfriend and the whole crew"},
    {"code": shortcode(dt.date(2026, 8, 20)), "caption": "#ad thanks to @linkpageonly for the aprons"},
]}
PROFILES = {
    "emberandoakgrills": {"full_name": "Ember and Oak Grills", "bio_links": [{"url": "https://emberandoak.test/shop"}]},
    "brightloafbakeware": {"full_name": "Brightloaf Bakeware", "bio_links": [{"url": "https://www.brightloaf.com/pans?ref=ig"}]},
    "linkpageonly": {"full_name": "Link Page Aprons", "bio_links": [{"url": "https://linktr.ee/aprons"}]},
}


def read(path):
    with open(path) as f:
        return json.load(f)


def lines(path):
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def yes_jev(request):
    return {q: {"choice": "yes"} for q in request["questions"]}


def no_allowance(ws):
    raise AssertionError("the allowance was read for a provider with no table")


class CreatorRunTest(_Base):
    def setUp(self):
        super().setUp()
        self.saved_cr = (CR.POSTS, CR.PROFILE, CR.ALLOWANCE, L.jev_rank)
        self.saved_providers = dict(P.PROVIDERS)
        P.PROVIDERS["fake"] = T2.FakeProvider
        T2.FakeProvider.calls = []
        L.clay = T2.no_clay
        L.SITE_READ = lambda domain: T2.SITES.get(domain, {"site_text": "", "links": []})
        L.NEXT_MOVE_JEV = T2.likes_parent
        L.jev_rank = fake_jev(T2.SCORES)
        CR.POSTS = lambda handle: list(POSTS[handle])
        CR.PROFILE = lambda handle: PROFILES.get(handle, {})
        CR.ALLOWANCE = no_allowance
        for name in ("hearthside.json", "hearthside.buyers.json"):
            shutil.copy(os.path.join(T2.CLIENT_DIR, name), self.tmp.name)
        self.path = os.path.join(self.tmp.name, "hearthside.json")
        with open(self.path) as f:
            cfg = json.load(f)
        cfg["provider"] = "fake"
        # A sponsored post is its own signal for this client, named as the one posts feed.
        cfg["spend_now"]["signals"].append({"kind": "sponsored", "weight": 40, "label": "Sponsored post",
                                            "question": "Is this a post {brand} paid a creator for? Anything else is no."})
        cfg["spend_now"]["creator_post_signal"] = "sponsored"
        cfg["creators"] = {CREATOR: {"instagram": ["junipers.table"]}}
        with open(self.path, "w") as f:
            json.dump(cfg, f)
        self.brands = os.path.join(self.tmp.name, "handed.txt")
        with open(self.brands, "w") as f:
            f.write("Brand, Domain\nCopperleaf Cookware\nSaltmarsh Pantry, https://www.saltmarshpantry.com/\nMystery Co\n")
        self.out = io.StringIO()

    def tearDown(self):
        CR.POSTS, CR.PROFILE, CR.ALLOWANCE, L.jev_rank = self.saved_cr
        P.PROVIDERS.clear()
        P.PROVIDERS.update(self.saved_providers)
        super().tearDown()

    def run_cmd(self, *argv):
        out, err = sys.stdout, sys.stderr
        sys.stdout = sys.stderr = self.out
        try:
            return CR.main([self.path, *argv], today=TODAY, jev=yes_jev)
        finally:
            sys.stdout, sys.stderr = out, err

    def side(self, suffix):
        return os.path.join(self.tmp.name, f"hearthside.{suffix}")

    def test_dry_run_prints_every_step_and_writes_nothing(self):
        before = sorted(os.listdir(self.tmp.name))
        report = self.run_cmd(CREATOR, "--brands", self.brands)
        text = self.out.getvalue()
        for step in ("1 discover", "2 plan", "3 chain", "4 waterfall", "5 spend", "6 tidy", "total:"):
            self.assertIn(step, text)
        self.assertIn("no live runs in the client's run log yet: unmeasured", text)
        self.assertEqual(report["estimate"]["chain_brands"], 4)
        self.assertEqual(sorted(os.listdir(self.tmp.name)), before)
        self.assertEqual(T2.FakeProvider.calls, [])

    def test_whole_creator_live(self):
        report = self.run_cmd(CREATOR, "--brands", self.brands, "--live")
        got = {b: (r["person"], r["status"]) for b, r in report["brands"].items()}
        self.assertEqual(got, {"Ember and Oak Grills": ("Owen Park", "Approved"),
                               "Brightloaf Bakeware": ("Kai Moreno", "Approved"),
                               "Copperleaf Cookware": ("Priya Nair", "Approved"),
                               "Saltmarsh Pantry": ("Ruth Alvarez", "Approved")})
        text = self.out.getvalue()
        # Left out with the reason, never guessed: a link-page bio and a handed name with no domain.
        self.assertIn("@linkpageonly: @linkpageonly has no site in its bio", text)
        self.assertIn("Mystery Co: handed over with no domain, and none on file", text)
        self.assertNotIn("samfriend", text)

        # Spending brands ran first: both sponsored-post brands before either handed one.
        searched = [c[1] for c in T2.FakeProvider.calls if c[0] == "people_search"]
        self.assertEqual(searched[:2], ["emberandoakgrills.com", "brightloaf.com"])
        self.assertEqual(report["brands"]["Ember and Oak Grills"]["score"], 40)

        # Every record carries the creator; every brand has this creator's row on file.
        recs = P.load_records(self.side("records.json"))["brands"]
        self.assertTrue(all(recs[k]["creator"] == CREATOR for k in
                            ("emberandoakgrills", "brightloafbakeware", "copperleafcookware", "saltmarshpantry")))
        rows = read(self.side("creator-rows.json"))
        self.assertEqual(len([k for k in rows if k.startswith(CREATOR + "|")]), 4)

        # Evidence: each find with its date, URL and source; the posts went in as spend evidence.
        found = lines(self.side("creator-evidence.jsonl"))
        posts = [e for e in found if e["kind"] == "sponsored_post"]
        self.assertEqual({(e["brand"], e["date"]) for e in posts},
                         {("Ember and Oak Grills", "2026-10-02"), ("Brightloaf Bakeware", "2026-09-14")})
        self.assertTrue(all(e["url"].startswith("https://www.instagram.com/p/") for e in posts))
        self.assertIn("domain from @brightloafbakeware's bio link", next(e for e in posts if "Bright" in e["brand"])["found_by"])
        spend = lines(self.side("spend-evidence.jsonl"))
        self.assertEqual({(e["brand"], e["kind"], e["jev"]) for e in spend},
                         {("Ember and Oak Grills", "sponsored", "yes"), ("Brightloaf Bakeware", "sponsored", "yes")})
        with open(self.path) as f:
            self.assertEqual(json.load(f)["spend_now"]["brands"]["Brightloaf Bakeware"], "brightloaf.com")
        self.assertIn("4 waterfall: skipped, Fakesearch has no table", text)
        self.assertNotRegex(text.lower(), r"sabo|aucta|rawdawg")

        # A second creator handed a brand already found: a copied row, no paid step.
        T2.FakeProvider.calls = []
        other = self.run_cmd("Rowan Fields (Fields Kitchen)", "--brands", self.brands, "--live")
        self.assertEqual(T2.FakeProvider.calls, [])
        self.assertEqual({b: r["action"] for b, r in other["brands"].items()},
                         {"Copperleaf Cookware": "copy", "Saltmarsh Pantry": "copy"})
        self.assertEqual(other["brands"]["Copperleaf Cookware"]["email"], "priya.nair@copperleafcookware.com")

        # The same creator again: everything is on their rows already.
        again = self.run_cmd(CREATOR, "--brands", self.brands, "--live")
        self.assertEqual(T2.FakeProvider.calls, [])
        self.assertEqual({r["action"] for r in again["brands"].values()}, {"skip"})


class PiecesTest(unittest.TestCase):
    def test_shortcode_dates(self):
        # Three posts from the first client's research, decoded and checked against their pages.
        self.assertEqual(CR.shortcode_date("DQfQg2TEtJJ"), dt.date(2025, 10, 31))
        self.assertEqual(CR.shortcode_date("DWr9_lakzjk"), dt.date(2026, 4, 3))
        self.assertIsNone(CR.shortcode_date("not!valid"))

    def test_estimate_prices_the_waterfall_from_the_catalog_and_the_run_log(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            log = os.path.join(d, "runs.jsonl")
            runs = [(1.1, "Ready"), (0.6, "Needs work: no email"), (1.6, "Ready"), (0.7, "Ready")]
            with open(log, "w") as f:
                for credits, status in runs:
                    f.write(json.dumps({"live": True, "cost": {"credits": credits},
                                        "result": {"person": "x", "status": status}}) + "\n")
            saved = (L.RUN_LOG, L.READY, C.CATALOG, C.OBSERVED)
            L.RUN_LOG, L.READY = log, "Ready"
            C.CATALOG, C.OBSERVED = os.path.join(d, "none.json"), os.path.join(d, "none2.json")
            try:
                steps = [("A", "a.com", "chain", None)] * 8 + [("B", "b.com", "copy", None)]
                est = CR.estimate({}, steps, has_table=True)
            finally:
                L.RUN_LOG, L.READY, C.CATALOG, C.OBSERVED = saved
        # 8 chains at a mean of 1.0, low 0.6, high 1.6; a quarter miss, so 2 waterfall rows at 1.1.
        self.assertEqual((est["chain"]["credits"], est["chain"]["low"], est["chain"]["high"]), (8.0, 4.8, 12.8))
        self.assertEqual(est["waterfall"]["credits"], 2.2)
        self.assertIn("Work Email at 1.1 credits a row", est["waterfall"]["basis"])
        self.assertEqual((est["total"], est["total_high"]), (10.2, 15.0))

    def test_plan_never_pays_twice_for_a_ready_row(self):
        records = {"strava": {"domain": "strava.com", "creator": "Noa", "view_row": "r_s",
                              "contact": {"status": "Ready"}},
                   "hoka": {"domain": "hoka.com", "creator": "Noa", "view_row": "r_h",
                            "contact": {"status": "Needs work: no email"}}}
        saved = (CR.STATUSES, L.load_rows)
        # Rows from before the record file: one Ready on the table, one not.
        L.load_rows = lambda path=None: {"gymshark": "r_g", "celsius": "r_c"}
        CR.STATUSES = lambda rows: {"r_g": "Ready", "r_c": "Needs work: catch-all"}
        try:
            steps = CR.plan({"creator": "Noa"}, "Noa", {"Strava (owns Runna)": "strava.com", "Hoka": "hoka.com",
                                                         "Gymshark": "gymshark.com", "Celsius": "celsius.com"},
                            records, {}, "Ready")
            other = CR.plan({"creator": "Noa"}, "Sam", {"Strava (owns Runna)": "strava.com", "Gymshark": "gymshark.com"},
                            records, {}, "Ready")
        finally:
            CR.STATUSES, L.load_rows = saved
        self.assertEqual([(b, a, r) for b, _, a, r in steps],
                         [("Strava (owns Runna)", "skip", "r_s"), ("Hoka", "chain", "r_h"),
                          ("Gymshark", "skip", "r_g"), ("Celsius", "chain", "r_c")])
        # Another creator copies the recorded contact; a table-only Ready row has nothing to copy, so it runs.
        self.assertEqual([(b, a) for b, _, a, _ in other], [("Strava (owns Runna)", "copy"), ("Gymshark", "chain")])

    def test_waterfall_email_counts_only_at_the_brand(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            saved = (L.RECORDS_FILE, L.show, L.ensure_pick_columns, L.READY, L.PARENT_DOMAINS)
            L.RECORDS_FILE, L.READY, L.PARENT_DOMAINS = os.path.join(d, "r.json"), "Ready", {}
            shown = []
            L.show = lambda row, cells: shown.append(row)
            L.ensure_pick_columns = lambda live: {}
            try:
                misses = [("Acme", "acme.com", {"row": "r_1", "person": "Ann", "domain": "acme.com", "why": "Ann."}),
                          ("Bolt", "bolt.com", {"row": "r_2", "person": "Bo", "domain": "bolt.com", "why": "Bo."}),
                          ("Cove", "cove.com", {"row": "r_3", "person": "Cy", "domain": "cove.com", "why": "Cy."})]
                taken = CR.take_waterfall({}, misses, {"r_1": "ann@acme.com", "r_2": "bo@gmail.com", "r_3": None})
                recs = P.load_records(L.RECORDS_FILE)["brands"]
            finally:
                L.RECORDS_FILE, L.show, L.ensure_pick_columns, L.READY, L.PARENT_DOMAINS = saved
        self.assertEqual(taken, ["Acme"])
        self.assertEqual(shown, ["r_1"])
        self.assertEqual(recs["acme"]["contact"]["status"], "Ready")
        self.assertIn("Work Email waterfall found and verified ann@acme.com", recs["acme"]["contact"]["why"])


if __name__ == "__main__":
    unittest.main()
