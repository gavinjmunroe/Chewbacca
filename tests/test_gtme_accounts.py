"""gtme accounts runs the whole account-list stack from a client's accounts block.

Every org, person and site is invented on .example hosts. The site audit, Maps and
News are fakes handed to build(), Jev is a fake ask, the people store is a scratch
PEOPLE_DIR, so nothing leaves the machine.
"""
from __future__ import annotations

import csv
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import gtme_accounts as ga  # noqa: E402

IRS_HEAD = "EIN,NAME,CITY,STATE,ZIP,NTEE_CD,REVENUE_AMT,TAX_PERIOD\n"
IRS = IRS_HEAD + "\n".join([
    "1,ALPHA LEGAL AID,LOS ANGELES,CA,90010-1,I73,20000000,202506",
    "2,BETA HEALTH FOUNDATION,ONTARIO,CA,91761-2,E32,30000000,202506",
    "3,GAMMA CLINIC,PASADENA,CA,91101-3,F30,15000000,202506",
    "4,DELTA ADVOCACY,LOS ANGELES,CA,90012-4,R20,12000000,202506",
    "5,ECHO ARTS,LOS ANGELES,CA,90012-5,A20,12000000,202506",         # NTEE not in the ICP
    "6,FOXTROT RELIEF,SAN DIEGO,CA,92101-6,E20,12000000,202506",       # zip outside the ranges
    "7,GOLF LEGAL,LOS ANGELES,CA,90013-7,I20,90000000,202506",         # revenue over the band
    "8,ALPHA LEGAL AID FUND,LOS ANGELES,CA,90010-8,I73,11000000,202506",  # same site as 1
])

SITES = {
    "Alpha Legal Aid": ("https://alpha.example/", [
        {"name": "Dana Ruiz", "title": "Chief Operating Officer", "email": "dana@alpha.example",
         "source_url": "https://alpha.example/team"}]),
    "Alpha Legal Aid Fund": ("https://www.alpha.example/", [
        {"name": "Dana Ruiz", "title": "Chief Operating Officer", "email": "dana@alpha.example",
         "source_url": "https://alpha.example/team"}]),
    # the IEHP shape: a title from another org on the same page
    "Beta Health Foundation": ("https://beta.example/", [
        {"name": "Karen Scott", "title": "Chair / Other County Fund Executive Director", "email": "",
         "source_url": "https://beta.example/board"}]),
    "Gamma Clinic": ("https://gamma.example/", [
        {"name": "Lee Park", "title": "Executive Director", "email": "", "source_url": "https://gamma.example/about"}]),
    "Delta Advocacy": ("https://delta.example/", [
        {"name": "Sam Cole", "title": "Chief Executive Officer", "email": "sam@delta.example",
         "source_url": "https://delta.example/staff"}]),
}
JEV = {"Dana Ruiz": 0.91, "Karen Scott": 0.06, "Lee Park": 0.88, "Sam Cole": None}


AUDIT_TITLES = []


def fake_tools():
    def resolve(q):
        for name, (site, _) in sorted(SITES.items(), key=lambda kv: -len(kv[0])):
            if q.lower().startswith(name.lower()):
                return {"website": site, "name": name}
        return None

    def audit(url, _, titles="church"):
        AUDIT_TITLES.append(titles)
        for site, contacts in SITES.values():
            if site == url:
                return {"status": "ok", "contacts": contacts, "page_emails": [], "chms": "", "final_url": url}
        return {"status": "unreachable"}

    def jobs(url):
        return [{"title": "Data Manager", "url": url + "careers"}] if "delta" in url else []

    lead_card = SimpleNamespace(resolve=resolve, jobs=jobs, ET=None, get=lambda u: "")
    return SimpleNamespace(audit=audit), lead_card


def fake_ask(calls):
    def ask(state, questions, decision):
        calls.append(state["person"])
        p = JEV[state["person"]]
        return None if p is None else {"buyer": {"noul": p}}
    return ask


def plan(tmp: Path, **extra) -> dict:
    (tmp / "eo_ca.csv").write_text(IRS)
    acc = {"icp": {"confirmed": True, "confirmed_by": "the client on a test call", "buyer": "COO or ED"},
           "source": {"kind": "irs_eo", "states": ["CA"], "zips": ["900-918", "926-928"],
                      "ntee": ["R", "W", "I", "E", "F"], "revenue": {"min": 10_000_000, "max": 50_000_000},
                      "files": {"CA": str(tmp / "eo_ca.csv")}},
           "titles": ["Chief Operating", "COO", "Executive Director", "Chief Executive", "CEO"],
           "criteria": {"revenue_range": {"min": 10_000_000, "max": 50_000_000}},
           "lanes": {"I": "legal aid", "E": "health", "F": "mental health", "R": "advocacy"}}
    acc.update(extra)
    return acc


class Refusals(unittest.TestCase):
    def run_main(self, cfg):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "acme.json").write_text(json.dumps(cfg))
            os.environ["GTME_CLIENTS_DIR"] = d
            try:
                return ga.main(["--client", "acme", "--check"])
            finally:
                os.environ.pop("GTME_CLIENTS_DIR")

    def test_no_accounts_block_refuses(self):
        self.assertEqual(self.run_main({"client": "Acme"}), 2)

    def test_unconfirmed_icp_refuses(self):
        with tempfile.TemporaryDirectory() as d:
            acc = plan(Path(d))
            acc["icp"]["confirmed"] = False
            self.assertEqual(self.run_main({"accounts": acc}), 2)
            acc["icp"] = {"confirmed": True}  # no one named as saying yes
            self.assertEqual(self.run_main({"accounts": acc}), 2)

    def test_confirmed_icp_passes_check(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(self.run_main({"accounts": plan(Path(d))}), 0)

    def test_missing_site_audit_refuses(self):
        os.environ["GTME_SITE_AUDIT_DIR"] = "/nonexistent/audit"
        try:
            with self.assertRaises(ga.Refused):
                ga.site_audit()
        finally:
            os.environ.pop("GTME_SITE_AUDIT_DIR")


class Source(unittest.TestCase):
    def test_irs_filter_keeps_only_the_icp(self):
        with tempfile.TemporaryDirectory() as d:
            rows = ga.irs_rows(plan(Path(d))["source"], Path(d))
        self.assertEqual(sorted(r["key"] for r in rows), ["1", "2", "3", "4", "8"])


class Build(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        tmp = Path(cls.tmp.name)
        people = tmp / "people"
        people.mkdir()
        db = sqlite3.connect(people / "people.db")
        db.executescript("create table people (id text primary key, name text, phone text, email text, company text);"
                         "create table identities (person_id text, kind text, value text);"
                         "insert into people values ('p1', 'Lee Park', '+15555550100', '', 'Gamma Clinic');")
        db.commit()
        db.close()
        os.environ["PEOPLE_DIR"] = str(people)
        (tmp / "dnc.csv").write_text("email,reason\nsam@delta.example,unsubscribed 10/01\n")
        cls.calls = []
        cls.rows, cls.summary = ga.build("acme", plan(tmp, dnc={"csv": [str(tmp / "dnc.csv")]}), tmp / "work",
                                         tools=fake_tools(), ask=fake_ask(cls.calls),
                                         about=lambda org, sigs: (sigs, []), today=date(2026, 10, 29))
        cls.by = {r["org"]: r for r in cls.rows}

    @classmethod
    def tearDownClass(cls):
        os.environ.pop("PEOPLE_DIR", None)
        cls.tmp.cleanup()

    def test_one_row_per_site(self):
        self.assertEqual(sum(1 for r in self.rows if "alpha" in r["website"]), 1)

    def test_every_picked_buyer_gets_one_jev_call(self):
        self.assertEqual(sorted(set(self.calls)), ["Dana Ruiz", "Karen Scott", "Lee Park", "Sam Cole"])

    def test_jev_no_holds_the_buyer_and_retiers(self):
        b = self.by["Beta Health Foundation"]
        self.assertEqual((b["buyer"], b["buyer_check"]), ("", "Jev 0.06, held"))
        # 60 with a named buyer, 40 once Jev holds it: below tier 2's line
        self.assertEqual((b["fit"], b["tier"]), (40, 3))

    def test_unscored_is_held_never_passed(self):
        d = self.by["Delta Advocacy"]
        self.assertEqual((d["buyer"], d["buyer_check"]), ("", "Jev not scored, held"))
        self.assertIn("Delta Advocacy", self.summary["jev_held"])

    def test_confirmed_buyer_kept_with_its_page(self):
        a = self.by["Alpha Legal Aid"] if "Alpha Legal Aid" in self.by else self.by["Alpha Legal Aid Fund"]
        self.assertEqual((a["buyer"], a["buyer_check"]), ("Dana Ruiz", "Jev 0.91"))
        self.assertEqual(a["buyer_source"], "https://alpha.example/team")
        self.assertEqual(a["kind"], "legal aid")

    def test_known_person_is_a_text_not_an_email(self):
        g = self.by["Gamma Clinic"]
        self.assertTrue(g["relationship"].startswith("warm"))
        self.assertEqual(g["channel"], "text")
        self.assertEqual(g["treg_find"], "")

    def test_dnc_is_checked_on_every_published_email(self):
        a = next(r for r in self.rows if "alpha" in r["website"])
        self.assertTrue(a["dnc"].startswith("clear"))

    def test_treg_priced_never_spent(self):
        self.assertEqual(self.summary["treg_priced_rows"], 0)
        row = {"buyer": "X", "buyer_email": "", "channel": "find email", "treg_find": ""}
        self.assertGreater(ga.price_treg(row), 0)
        self.assertIn("not spent", row["treg_find"])

    def test_summary_counts_fill(self):
        self.assertEqual(self.summary["jev_confirmed"], 2)
        self.assertEqual(self.summary["fill"]["website"], len(self.rows))

    def test_csv_has_every_column(self):
        out = Path(self.tmp.name) / "out.csv"
        ga.write(self.rows, out)
        with open(out) as fh:
            self.assertEqual(next(csv.reader(fh)), ga.COLUMNS)


class Parts(unittest.TestCase):
    def test_dnc_suppressed_clears_the_email(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "dnc.csv"
            p.write_text("email\nsam@delta.example\n")
            entries, where = ga.dnc_entries({"dnc": {"csv": [str(p)]}})
        row = {"buyer": "Sam Cole", "buyer_email": "sam@delta.example"}
        ga.apply_dnc(row, entries, where)
        self.assertEqual(row["buyer_email"], "")
        self.assertTrue(row["dnc"].startswith("SUPPRESSED"))

    def test_no_dnc_list_says_not_checked(self):
        entries, where = ga.dnc_entries({})
        self.assertIsNone(entries)
        row = {"buyer": "A B", "buyer_email": "a@b.example"}
        ga.apply_dnc(row, entries, where)
        self.assertTrue(row["dnc"].startswith("not checked"))

    def test_same_person_two_orgs_is_one_send(self):
        base = {"tier": 1, "fit": 80, "why_now_score": 5, "buyer_title": "CEO", "dupe_of": ""}
        rows = [dict(base, org="One Org", website="https://one.example/", buyer="Pat Kim", buyer_email="pat@one.example"),
                dict(base, org="Two Org", website="https://two.example/", buyer="Pat Kim", buyer_email="pat@one.example")]
        out = ga.dedupe(rows)
        self.assertEqual(sum(1 for r in out if r["dupe_of"]), 1)

    def test_csv_defuses_formulas_from_a_strangers_page(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "x.csv"
            ga.write([{"org": "=HYPERLINK(\"http://x.example\")", "fit": 80}], out)
            with open(out) as fh:
                self.assertFalse(next(csv.DictReader(fh))["org"].startswith("="))

    def test_suppressed_buyer_gets_no_channel_and_no_treg(self):
        row = {"buyer": "Pat Kim", "buyer_email": "", "website": "https://x.example/", "org": "X", "dupe_of": ""}
        entries = ga.gtme_dnc.load_csv.__globals__["Entry"]("", "x.example", "asked out", None, "t")
        ga.apply_dnc(row, [entries], "t.csv")
        ga.relationship(row, None)
        self.assertTrue(row["dnc"].startswith("SUPPRESSED"))
        self.assertEqual(row["channel"], "none: on a DNC list")
        self.assertEqual(ga.price_treg(dict(row, treg_find="")), 0.0)

    def test_dupe_keeps_the_best_tier(self):
        base = {"fit": 80, "why_now_score": 5, "buyer_title": "CEO", "dupe_of": ""}
        rows = [dict(base, tier=3, org="Low Org", website="https://low.example/", buyer="Pat Kim", buyer_email="pat@x.example"),
                dict(base, tier=1, org="Top Org", website="https://top.example/", buyer="Pat Kim", buyer_email="pat@x.example")]
        out = {r["org"]: r for r in ga.dedupe(rows)}
        self.assertEqual((out["Top Org"]["dupe_of"], out["Low Org"]["dupe_of"]), ("", "Top Org"))

    def test_shared_host_is_not_one_org(self):
        a = {"website": "https://www.facebook.com/alpha", "org": "Alpha"}
        b = {"website": "https://www.facebook.com/beta", "org": "Beta"}
        self.assertNotEqual(ga.org_key(a), ga.org_key(b))

    def test_one_word_name_inside_a_longer_one_is_another_org(self):
        self.assertFalse(ga.same_org("Hope", "Hope Mission Thrift Store Church"))
        self.assertTrue(ga.same_org("Alpha Legal Aid", "Alpha Legal Aid Foundation"))
        self.assertTrue(ga.same_org("Kcs Inc", "KCS Health Center - Lincoln"))

    def test_acronym_and_small_words_match_their_headlines(self):
        items = [{"title": "IEHP Foundation launches AI data program", "date": "2026-10-01", "url": "u"},
                 {"title": "YMCA of Greater Los Angeles names CTO", "date": "2026-10-01", "url": "u"}]
        self.assertEqual(len(ga.own_news("Iehp Foundation", items)), 1)
        self.assertEqual(len(ga.own_news("Ymca Of Greater Los Angeles", items)), 1)

    def test_failed_lookup_is_retried_not_cached(self):
        with tempfile.TemporaryDirectory() as d:
            work = Path(d)
            (work / "enriched.jsonl").write_text(json.dumps({"key": "1", "name": "Alpha Legal Aid", "error": "maps: 429"}) + "\n")
            recs = ga.enrich([{"key": "1", "name": "Alpha Legal Aid", "city": "", "state": "CA"}], work, fake_tools(),
                             ga.re.compile("x"), ga.re.compile("x"), 1, False)
            self.assertEqual(recs[0]["website"], "https://alpha.example/")
            self.assertEqual(len((work / "enriched.jsonl").read_text().splitlines()), 1)

    def test_audit_reads_org_titles_not_church_ones(self):
        # The church default dropped every CEO and CTO: AuraPath got a buyer for 9 of 52 (10/29).
        AUDIT_TITLES.clear()
        with tempfile.TemporaryDirectory() as d:
            ga.enrich([{"key": "1", "name": "Alpha Legal Aid", "city": "", "state": "CA"}], Path(d), fake_tools(),
                      ga.re.compile("x"), ga.re.compile("x"), 1, False)
        self.assertEqual(AUDIT_TITLES, ["org"])

    def test_law_firm_founder_kept_over_it_director(self):
        # Marko Law, 11/2: the founder was dropped and the IT director became the buyer.
        contacts = [{"name": "Noah Overby", "title": "IT Director"},
                    {"name": "Ann Lee", "title": "Director of Digital Marketing"},
                    {"name": "Sam Roe", "title": "Data Analyst"},
                    {"name": "Jonathan R. Marko", "title": "Principal Attorney/Founder"},
                    {"name": "Lisa Grant", "title": "Firm Administrator"}]
        names = [c["name"] for c in ga.leaders(contacts)]
        self.assertIn("Jonathan R. Marko", names)
        self.assertIn("Lisa Grant", names)
        cands = [{"contact_id": c["name"], "full_name": c["name"], "title": c["title"]} for c in ga.leaders(contacts)]
        prim = ga.gtme_score.resolve_primary(cands, ["Founder", "Managing Partner", "Partner", "Owner"])
        self.assertEqual(prim["primary_contact_id"], "Jonathan R. Marko")

    def test_any_icp_title_from_config_is_kept_and_ranked_first(self):
        contacts = [{"name": "Noah Overby", "title": "IT Director"},
                    {"name": "Dana Wells", "title": "Head of Revenue"}]
        self.assertEqual([c["name"] for c in ga.leaders(contacts)], ["Noah Overby"])
        self.assertEqual([c["name"] for c in ga.leaders(contacts, ["Head of Revenue"])][0], "Dana Wells")

    def test_a_title_is_never_a_buyer_name(self):
        for bad in ["Managing Attorney", "Firm Founder", "Recent Articles", "Managing Partner", "Cher"]:
            self.assertFalse(ga.is_person(bad), bad)
        for good in ["Jonathan R. Marko", "Cherie Lobb", "Patrick O’Keefe", "JOSEPH BRUGNOLI"]:
            self.assertTrue(ga.is_person(good), good)

    def test_icp_work_found_one_click_deep_with_its_page(self):
        pages = {"https://firm.example/": '<a href="/practice-areas/auto">Car Accidents</a> Free consult',
                 "https://firm.example/practice-areas/auto":
                     "<p>We fight insurers for your Michigan no-fault PIP benefits.</p>"}
        audit = SimpleNamespace(fetch=lambda u: {"html": pages.get(u, ""), "final_url": u})
        ev = ga.icp_evidence(audit, None, "https://firm.example/", r"no[- ]fault|\bPIP\b")
        self.assertTrue(ev["ok"])
        self.assertEqual(ev["url"], "https://firm.example/practice-areas/auto")
        self.assertIn("PIP benefits", ev["line"])
        none = ga.icp_evidence(SimpleNamespace(fetch=lambda u: {"html": "<p>Divorce and custody</p>", "final_url": u}),
                               None, "https://other.example/", r"no[- ]fault|\bPIP\b")
        self.assertFalse(none["ok"])

    def test_no_size_market_tiers_on_icp_evidence(self):
        # Michigan PIP, 11/2: no revenue or headcount, so all 145 firms were tier 3.
        acc = {"titles": ["Founder"], "criteria": {"headcount_range": {"min": 10, "max": 150}},
               "icp": {"must_show": "PIP"}}
        rec = {"name": "Marko Law", "city": "Detroit", "state": "MI", "website": "https://markolaw.com/",
               "leaders": [{"name": "Jonathan R. Marko", "title": "Founder", "email": "jon@markolaw.com",
                            "source_url": "https://markolaw.com/staff"}],
               "jobs": [{"title": "PIP Paralegal", "url": "https://markolaw.com/careers"}],
               "icp_fit": {"ok": True, "line": "Michigan no-fault PIP", "url": "https://markolaw.com/pip"}}
        row = ga.score(rec, acc, ga.re.compile("x"), date(2026, 11, 2), about=lambda org, sigs: (sigs, []))
        self.assertEqual(row["icp_fit"], "yes")
        self.assertLess(row["tier"], 3)
        off = dict(rec, icp_fit={"ok": False, "line": "", "url": "https://markolaw.com/"})
        self.assertEqual(ga.score(off, acc, ga.re.compile("x"), date(2026, 11, 2),
                                  about=lambda org, sigs: (sigs, []))["tier"], 3)

    def test_maps_source_runs_every_query_in_every_place(self):
        # Michigan PIP, 11/2: 20 Maps searches run by hand, then merged and deduped by hand.
        calls = []

        def call(q):
            calls.append(q)
            return {"ok": True, "data": [
                {"name": "Marko Law", "website": "https://www.markolaw.com/?utm=gmb",
                 "address": "220 W Congress St, Detroit, MI 48226"},
                {"name": "Mike Morse Injury Law Firm", "website": "https://855mikewins.com/",
                 "address": "24901 Northwestern Hwy, Southfield, MI 48075"},
                {"name": "Ohio Injury", "website": "https://ohioinjury.com/", "address": "1 Main St, Toledo, OH 43604"},
                {"name": "No Site Law", "address": "2 Main St, Troy, MI 48084"}]}
        rows = ga.maps_rows({"queries": ["PIP attorney", "auto accident lawyer"], "places": ["Detroit MI", "Troy MI"],
                             "state": "MI", "exclude": "Mike Morse"}, Path("."), call=call)
        self.assertEqual(len(calls), 4)
        self.assertEqual([(r["name"], r["website"], r["city"]) for r in rows],
                         [("Marko Law", "https://www.markolaw.com/", "Detroit")])
        self.assertIn("maps", ga.SOURCES)

    def test_linkedin_hiring_matches_exact_names_only(self):
        def call(kw, loc):
            return {"ok": True, "data": [
                {"company": "Michigan Auto Law", "title": "Paralegal", "url": "u1", "postedDate": "2026-10-22"},
                {"company": "Blue Cross Blue Shield of Michigan", "title": "Paralegal", "url": "u2"},
                {"company": "Hamo Law Firm, PLLC", "title": "PIP Case Manager", "url": "u3", "postedDate": "2026-10-30"}]}
        posts = ga.linkedin_hiring({"keywords": ["paralegal"], "places": ["Detroit, Michigan"]}, call=call)
        self.assertEqual(posts[ga.name_key("Michigan Auto Law - Auto Accident Attorneys")][0]["date"], "2026-10-22")
        self.assertEqual(posts[ga.name_key("Hamo Law Firm - Auto Accident Lawyers")][0]["title"], "PIP Case Manager")
        self.assertNotIn(ga.name_key("Michigan Injury Attorneys"), posts)

    def test_buyer_named_on_another_site_is_dropped(self):
        acc = {"titles": ["Founder"], "criteria": {}}
        rec = {"name": "Marko Law", "city": "", "state": "MI", "website": "https://www.markolaw.com/",
               "leaders": [{"name": "Alex Kay", "title": "Founder", "source_url": "https://www.michbar.org/alex"},
                           {"name": "Jonathan R. Marko", "title": "Founder", "source_url": "https://markolaw.com/staff"}]}
        row = ga.score(rec, acc, ga.re.compile("x"), date(2026, 11, 2), about=lambda org, sigs: (sigs, []))
        self.assertEqual(row["buyer"], "Jonathan R. Marko")

    def test_blind_sample_refuses_the_full_run(self):
        # Michigan PIP, 11/2: 145 sites read, 1 buyer, because no title the reader knew fit.
        def audit(url, _, titles="church", buyer_titles=None):
            return {"status": "ok", "contacts": [], "page_emails": [], "chms": "", "final_url": url}
        tools = (SimpleNamespace(audit=audit), fake_tools()[1])
        old = ga.SAMPLE
        ga.SAMPLE = 2
        try:
            with tempfile.TemporaryDirectory() as d:
                with self.assertRaises(ga.Refused) as e:
                    ga.build("acme", plan(Path(d)), Path(d) / "work", tools=tools, ask=fake_ask([]),
                             about=lambda org, sigs: (sigs, []), today=date(2026, 11, 2))
            self.assertIn("blind to this market", str(e.exception))
        finally:
            ga.SAMPLE = old

    def test_new_titles_reread_cached_sites(self):
        seen = []

        def audit(url, _, titles="church", buyer_titles=None):
            seen.append(tuple(buyer_titles or ()))
            return {"status": "ok", "contacts": [], "page_emails": [], "chms": "", "final_url": url}
        tools = (SimpleNamespace(audit=audit), fake_tools()[1])
        acct = [{"key": "1", "name": "Alpha Legal Aid", "city": "", "state": "CA"}]
        with tempfile.TemporaryDirectory() as d:
            ga.enrich(acct, Path(d), tools, ga.re.compile("x"), ga.re.compile("x"), 1, False, ["CEO"])
            ga.enrich(acct, Path(d), tools, ga.re.compile("x"), ga.re.compile("x"), 1, False, ["CEO"])
            ga.enrich(acct, Path(d), tools, ga.re.compile("x"), ga.re.compile("x"), 1, False, ["Managing Partner"])
        self.assertEqual(seen, [("CEO",), ("Managing Partner",)])

    def test_jev_true_is_not_a_probability(self):
        row = {"buyer": "Pat", "buyer_title": "CEO", "buyer_email": "", "org": "X", "website": "", "buyer_source": "",
               "revenue": "", "fit": 80}
        ga.jev_check(row, {"criteria": {}}, "t", lambda *a: {"buyer": {"noul": True}})
        self.assertEqual(row["buyer_check"], "Jev not scored, held")

    def test_why_now_signals_go_through_jev_about_this_org(self):
        rec = {"key": "1", "name": "Delta Advocacy", "city": "Los Angeles", "state": "CA", "website": "https://delta.example/",
               "revenue": 12_000_000, "leaders": [], "news": [], "jobs": [{"title": "Data Manager", "url": "u"}]}
        acc = {"titles": ["CEO"], "criteria": {"revenue_range": {"min": 10_000_000}}}
        seen = []
        def about(org, sigs):
            seen.append(org["name"])
            return [], sigs  # Jev says none of it is about this org
        row = ga.score(rec, acc, ga.re.compile("data"), date(2026, 10, 29), about)
        self.assertEqual(seen, ["Delta Advocacy"])
        self.assertEqual(row["fit"], 40)  # the dropped job post is no reason to talk
        unscored = ga.score(rec, acc, ga.re.compile("data"), date(2026, 10, 29), lambda o, s: None)
        self.assertEqual(unscored["hold"], "HOLD")

    def test_form_d_raise_stands_in_for_revenue(self):
        rec = {"key": "1", "name": "Acme Robotics", "city": "", "state": "CA", "website": "https://acme.example/",
               "revenue": None, "raised": 5_000_000, "leaders": [], "news": [], "jobs": []}
        acc = {"titles": ["CEO"], "criteria": {"raise_range": {"min": 1_000_000, "max": 20_000_000}}}
        row = ga.score(rec, acc, ga.re.compile("x"), date(2026, 10, 29), lambda o, s: (s, []))
        self.assertEqual(row["fit"], 40)

    def test_own_news_needs_the_whole_name(self):
        items = [{"title": "Bitcoin Well raises fund", "date": "2026-10-01", "url": "u"},
                 {"title": "Urban Impact Center names new CEO", "date": "2026-10-01", "url": "u"}]
        self.assertEqual(ga.own_news("The Well", items), [])
        self.assertEqual(len(ga.own_news("Urban Impact Center", items)), 1)

    def test_dispatches_through_gtme(self):
        import subprocess
        p = subprocess.run([sys.executable, str(ROOT / "tools" / "gtme_operator.py"), "accounts", "--help"],
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("icp", p.stdout.lower())


if __name__ == "__main__":
    unittest.main()
