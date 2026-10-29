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


def fake_tools():
    def resolve(q):
        for name, (site, _) in sorted(SITES.items(), key=lambda kv: -len(kv[0])):
            if q.lower().startswith(name.lower()):
                return {"website": site, "name": name}
        return None

    def audit(url, _):
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
                                         tools=fake_tools(), ask=fake_ask(cls.calls), today=date(2026, 10, 29))
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
        row = {"buyer_email": "sam@delta.example"}
        ga.apply_dnc(row, entries, where)
        self.assertEqual(row["buyer_email"], "")
        self.assertTrue(row["dnc"].startswith("SUPPRESSED"))

    def test_no_dnc_list_says_not_checked(self):
        entries, where = ga.dnc_entries({})
        self.assertIsNone(entries)
        row = {"buyer_email": "a@b.example"}
        ga.apply_dnc(row, entries, where)
        self.assertTrue(row["dnc"].startswith("not checked"))

    def test_same_person_two_orgs_is_one_send(self):
        base = {"tier": 1, "fit": 80, "why_now_score": 5, "buyer_title": "CEO", "dupe_of": ""}
        rows = [dict(base, org="One Org", website="https://one.example/", buyer="Pat Kim", buyer_email="pat@one.example"),
                dict(base, org="Two Org", website="https://two.example/", buyer="Pat Kim", buyer_email="pat@one.example")]
        out = ga.dedupe(rows)
        self.assertEqual(sum(1 for r in out if r["dupe_of"]), 1)

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
