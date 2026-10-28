"""gtme-investors turns a client's investors block into one deduped, audited CSV.

Every fixture is invented: a tiny sqlite file with the Prometheus contacts
shape, .example domains, no real investor and no real client. Nothing reads
the network or the real database.
"""
from __future__ import annotations

import contextlib
import csv
import io
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "tools" / "gtme_investors.py"
sys.path.insert(0, str(ROOT / "tools"))

import gtme_investors as gi  # noqa: E402

SCHEMA = """CREATE TABLE contacts (
  record_id TEXT PRIMARY KEY, full_name TEXT, title TEXT, organization TEXT,
  org_type TEXT, grade TEXT, grade_score INTEGER, seniority_tier TEXT, entity_kind TEXT,
  email TEXT, linkedin TEXT, website TEXT, city TEXT, state TEXT, country TEXT,
  region TEXT, check_size TEXT, d_org_junk INTEGER, d_name_nan INTEGER, sectors_norm TEXT)"""

# (id, name, title, org, org_type, grade, seniority, email, linkedin, country, region, check, sectors, junk)
PEOPLE = [
    ("p1", "Avery Quill", "Founder", "Quill Seed Fund", "VC", "A", "A_founder_cxo",
     "avery@quillseed.example", "https://linkedin.com/in/avery-quill", "United States", "North America",
     "Early Stage VC, Seed Round", "saas, software", 0),
    ("p2", "Blake Rowe", "Partner", "Rowe Ventures", "VC", "B", "B_vp_director",
     "blake@rowe.example", "https://linkedin.com/in/someone-else", "USA", "North America",
     "", "", 0),
    ("p3", "Casey Lin", "Managing Partner", "Lin Capital", "VC", "A", "A_founder_cxo",
     "casey@lincap.example", "", "United States", "North America", "", "real estate", 0),
    ("p4", "Dana Ortiz", "Founder", "Ortiz Partners", "VC", "A", "A_founder_cxo",
     "info@ortiz.example", "", "United States", "North America", "", "software", 0),
    ("p5", "Eli Park", "Founder", "Person", "Angel", "A", "A_founder_cxo",
     "eli@park.example", "", "United States", "North America", "", "software", 0),
    ("p6", "Fran Moss", "Founder", "Moss Fund", "VC", "A", "A_founder_cxo",
     "fran@moss.example", "", "UAE", "MENA", "", "software", 0),
    ("p7", "Avery Quill", "Founder", "Quill Seed Fund", "VC", "A", "A_founder_cxo",
     "avery.q@quillseed.example", "", "United States", "North America", "", "saas", 0),
    ("p8", "Gale Hart", "Founder", "Hart Growth (NYS: HG)", "VC", "A", "A_founder_cxo",
     "gale@hart.example", "", "United States", "North America", "", "crypto, software", 0),
    ("p9", "Hana Bell", "Principal", "Bell Angels LLC", "Angel", "B", "B_vp_director",
     "hana@bellangels.example", "", "United States", "North America", "", "retail, ai", 0),
    ("p10", "Ivo Kent", "Founder", "11283.jpg (https://dl.airtable.com/x)", "VC", "A", "A_founder_cxo",
     "ivo@kent.example", "", "United States", "North America", "", "software", 1),
    ("p11", "Jo Vance", "Founder", "Vance Mega Fund", "VC", "A", "A_founder_cxo",
     "jo@vance.example", "", "United States", "North America", "50.00 - 200.00", "software", 0),
    ("p12", "Kit Noor", "Analyst", "Noor Ventures", "VC", "A", "C_manager_ic",
     "kit@noor.example", "", "United States", "North America", "", "software", 0),
]


def make_db(path: Path) -> None:
    con = sqlite3.connect(path)
    con.execute(SCHEMA)
    for p in PEOPLE:
        (rid, name, title, org, ot, grade, sen, email, li, country, region, check, sectors, junk) = p
        con.execute("INSERT INTO contacts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (rid, name, title, org, ot, grade, 80, sen, "Person", email, li, "", "City", "ST",
                     country, region, check, junk, 0, sectors))
    con.execute("INSERT INTO contacts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                ("o1", "Some Org", "", "Some Org", "VC", "A", 90, "unknown", "Organization",
                 "deals@org.example", "", "", "", "", "United States", "North America", "", 0, 0, "saas"))
    con.commit()
    con.close()


BLOCK = {
    "thesis": ["saas", "software", "ai"],
    "stage": ["seed", "early stage"],
    "max_check_musd": 3.0,
    "org_types": ["VC", "Angel"],
    "countries": ["united states", "usa"],
    "regions": ["north america"],
    "exclude_sectors": ["crypto", "real estate"],
    "seniority": ["A_founder_cxo", "B_vp_director"],
    "include_unknown_sector": True,
}


class InvestorsTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.db = self.tmp / "contacts.db"
        make_db(self.db)
        con = sqlite3.connect(self.db)
        con.execute("UPDATE contacts SET website = record_id || '.example' WHERE website = ''")
        con.commit(); con.close()
        self.con = sqlite3.connect(f"file:{self.db}?mode=ro", uri=True)
        self._graph = os.environ.get("GTME_PORTFOLIO_GRAPH")
        os.environ["GTME_PORTFOLIO_GRAPH"] = str(self.tmp / "portfolio.json")

    def tearDown(self):
        if self._graph is None:
            os.environ.pop("GTME_PORTFOLIO_GRAPH", None)
        else:
            os.environ["GTME_PORTFOLIO_GRAPH"] = self._graph
        self.con.close()
        self._tmp.cleanup()

    def build(self, ask=None, match=None, **over):
        block = dict(BLOCK, **over)
        gi.check_block(block)
        self.asked = []

        def fake(states, question):
            self.asked.append(len(states))
            return (ask or (lambda st: [0.9] * len(st)))(states)
        def portfolio(dom, firm):
            return {"firm": firm, "companies": [{"name": f"{firm} Portco", "source": f"https://{dom}/portfolio"}]}
        return gi.build(self.con, block, ask=fake, says=lambda site: "We back seed-stage software founders.",
                        match=match or (lambda firm, names: [(names[0], 0.9)]), read_portfolio=portfolio,
                        lender_ask=lambda st, q: [0.0] * len(st))

    def emails(self, rows):
        return [r["email"] for r in rows]

    def test_filters_drop_every_row_that_would_break_a_send(self):
        rows, stats = self.build()
        got = self.emails(rows)
        self.assertNotIn("info@ortiz.example", got, "role inbox")
        self.assertNotIn("eli@park.example", got, "company is the literal Person")
        self.assertNotIn("ivo@kent.example", got, "image URL in the company column")
        self.assertNotIn("fran@moss.example", got, "outside the geography")
        self.assertNotIn("casey@lincap.example", got, "excluded sector")
        self.assertNotIn("gale@hart.example", got, "crypto is excluded even next to software")
        self.assertNotIn("jo@vance.example", got, "a $200M check is not a seed investor")
        self.assertNotIn("kit@noor.example", got, "below the seniority floor")
        self.assertNotIn("deals@org.example", got, "organizations are not people")
        self.assertEqual(stats["dropped"]["role inbox"], 1)

    def test_one_person_once_and_thesis_matches_rank_above_generalists(self):
        rows, _ = self.build()
        got = self.emails(rows)
        self.assertEqual(sum(1 for r in rows if r["full_name"] == "Avery Quill"), 1)
        self.assertEqual(got[0], "avery@quillseed.example")
        self.assertEqual(got[-1], "blake@rowe.example", "blank sector is a generalist, ranked last")
        self.assertEqual(rows[-1]["thesis_match"], "no")

    def test_generalists_can_be_turned_off(self):
        rows, _ = self.build(include_unknown_sector=False)
        self.assertNotIn("blake@rowe.example", self.emails(rows))

    def test_words_match_whole_words_only(self):
        rows, _ = self.build(thesis=["ai"])
        row = next(r for r in rows if r["email"] == "hana@bellangels.example")
        self.assertEqual(row["thesis_match"], "yes", "ai in 'retail, ai'")
        self.assertNotIn("avery@quillseed.example",
                         [r["email"] for r in rows if r["thesis_match"] == "yes"],
                         "'ai' must not match inside 'saas' or 'retail'")

    def test_a_strangers_linkedin_is_blanked_and_the_company_is_cleaned(self):
        rows, _ = self.build()
        blake = next(r for r in rows if r["email"] == "blake@rowe.example")
        self.assertEqual(blake["linkedin"], "")
        hana = next(r for r in rows if r["email"] == "hana@bellangels.example")
        self.assertEqual(hana["organization"], "Bell Angels")
        self.assertEqual(gi.clean_company("Morgan Fund (NYS: MF)"), "Morgan Fund")
        self.assertEqual(gi.first_name("Dr. JANE DOE"), "Jane")

    def test_suppress_file_removes_people_already_emailed(self):
        sup = self.tmp / "sent.csv"
        sup.write_text("Email,status\navery@quillseed.example,sent\n")
        rows, stats = self.build(suppress=[str(sup)])
        self.assertNotIn("avery@quillseed.example", self.emails(rows))
        self.assertEqual(stats["dropped"]["suppressed"], 1)

    def test_a_formula_in_a_name_or_firm_is_defused_in_the_csv(self):
        rows, _ = self.build()
        rows[0]["full_name"] = "=HYPERLINK(\"http://evil.example\")"
        rows[0]["organization"] = "@SUM(A1)"
        rows[0]["title"] = "-2+3"
        out = self.tmp / "defused.csv"
        gi.write_csv(rows, out)
        with out.open() as fh:
            got = next(csv.DictReader(fh))
        self.assertEqual(got["full_name"], "'=HYPERLINK(\"http://evil.example\")")
        self.assertEqual(got["organization"], "'@SUM(A1)")
        self.assertEqual(got["title"], "'-2+3")
        self.assertEqual(got["email"], rows[0]["email"], "a clean cell is left alone")

    def test_bad_config_is_refused(self):
        with self.assertRaises(gi.ConfigError):
            gi.check_block({"thesis": []})
        with self.assertRaises(gi.ConfigError):
            gi.check_block({"thesis": "saas"})

    def cli(self, *args, env=None):
        # An AMBER_ROOT with no consent file switches Jev off: nothing leaves the machine.
        e = dict(os.environ, PROMETHEUS_DB=str(self.db), AMBER_ROOT=str(self.tmp / "no-consent"))
        e.update(env or {})
        return subprocess.run([sys.executable, str(TOOL), *args], capture_output=True, text=True,
                              env=e, timeout=120)

    def test_cli_reads_the_client_file_writes_and_audits_clean(self):
        clients = self.tmp / "clients"
        clients.mkdir()
        out = self.tmp / "out" / "investors.csv"
        (clients / "northwind.json").write_text(json.dumps({"investors": dict(BLOCK, out=str(out))}))
        proc = self.cli("--client", "northwind", "--json", env={"GTME_CLIENTS_DIR": str(clients)})
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        summary = json.loads(proc.stdout)
        self.assertTrue(summary["audit"]["ran"])
        self.assertEqual(summary["audit"]["defects"], {})
        with out.open() as fh:
            rows = list(csv.DictReader(fh))
        self.assertEqual(len(rows), summary["written"])
        self.assertEqual(list(rows[0].keys()), gi.COLUMNS)

    def test_dry_run_writes_nothing_and_missing_db_is_named(self):
        cfg = self.tmp / "c.json"
        out = self.tmp / "never.csv"
        cfg.write_text(json.dumps({"investors": dict(BLOCK, out=str(out))}))
        proc = self.cli("--config", str(cfg), "--dry-run")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertFalse(out.exists())
        proc = self.cli("--config", str(cfg), env={"PROMETHEUS_DB": str(self.tmp / "missing.db")})
        self.assertEqual(proc.returncode, 2)
        self.assertIn("no Prometheus db", proc.stderr)

    def test_check_sizes_keep_their_units(self):
        # 2026-10-26: "100K USD" read as $100M dropped every seed check in K.
        self.assertEqual(gi.check_range("100K USD"), (0.1, 0.1))
        self.assertEqual(gi.check_range("500K - 2.5M"), (0.5, 2.5))
        self.assertEqual(gi.check_range("0 - 2.5M"), (0.0, 2.5))
        self.assertEqual(gi.check_range("$500K - $1M, $1M - $3M"), (0.5, 3.0))
        self.assertEqual(gi.check_range("50.00 - 200.00"), (50.0, 200.0), "bare numbers are $M, the file's own way")
        self.assertEqual(gi.check_range("250,000"), (0.25, 0.25))
        self.assertIsNone(gi.check_range("Early Stage VC, Seed Round"))

    def test_a_k_check_is_a_seed_investor_with_a_reason(self):
        con = sqlite3.connect(self.db)
        con.execute("UPDATE contacts SET check_size='100K USD', sectors_norm='software' WHERE record_id='p2'")
        con.commit(); con.close()
        rows, _ = self.build()
        blake = next(r for r in rows if r["email"] == "blake@rowe.example")
        self.assertEqual(blake["stage_match"], "yes")
        self.assertIn("checks $100K, inside the $3M round", blake["why"])
        self.assertIn("thesis: software (sector)", blake["why"])

    def test_min_check_and_require_stage_drop_with_a_named_reason(self):
        con = sqlite3.connect(self.db)
        con.execute("UPDATE contacts SET check_size='10K - 25K' WHERE record_id='p9'")
        con.commit(); con.close()
        rows, stats = self.build(min_check_musd=0.05)
        self.assertNotIn("hana@bellangels.example", self.emails(rows))
        self.assertEqual(stats["dropped"]["check too small"], 1)
        rows, stats = self.build(require_stage=True)
        self.assertNotIn("blake@rowe.example", self.emails(rows), "no stage word, no check size")
        self.assertGreaterEqual(stats["dropped"]["no early-stage evidence"], 1)
        self.assertTrue(all(r["stage_match"] == "yes" for r in rows))
        with self.assertRaises(gi.ConfigError):
            gi.check_block(dict(BLOCK, require_stage="yes"))

    def add(self, *people):
        con = sqlite3.connect(self.db)
        for rid, name, title, org, sectors in people:
            con.execute("INSERT INTO contacts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (rid, name, title, org, "VC", "A", 80, "A_founder_cxo", "Person",
                         f"{rid}@{rid}.example", "", f"{rid}.example", "City", "ST", "United States", "North America",
                         "", 0, 0, sectors))
        con.commit(); con.close()

    def test_jev_decides_every_row_and_a_keyword_alone_admits_nobody(self):
        # 2026-10-26: "consumer" alone put Greylock on a mushroom-protein founder's list.
        self.add(("gl", "Gia Lock", "Partner", "Greylock Partners", "consumer, software"),
                 ("fd", "Fern Dale", "Partner", "Dale Food Fund", "consumer, food"),
                 ("g3", "Gus Three", "Managing Director", "Big Bank", ""))
        def fit(st):
            return [0.9 if "Food" in s["organization"] or "Quill" in s["organization"] else 0.1 for s in st]
        rows, stats = self.build(ask=fit, thesis=["food", "consumer", "saas"], limit=500,
                                 match=lambda firm, names: [(names[0], 0.9)] if "Food" in firm or "Quill" in firm
                                 else [])
        got = self.emails(rows)
        self.assertNotIn("gl@gl.example", got, "a keyword hit is a candidate, Jev said no")
        self.assertIn("fd@fd.example", got)
        self.assertNotIn("g3@g3.example", got)
        self.assertEqual(stats["judged"], stats["thesis_rows"] + stats["unknown_pool"], "every candidate judged")
        self.assertGreater(stats["dropped"]["Jev: not a fit for the pitch"], 0)
        self.assertLess(len(rows), 500, "nothing pads to the limit")
        fd = next(r for r in rows if r["email"] == "fd@fd.example")
        self.assertIn("backed Dale Food Fund Portco (Jev 0.90, from its portfolio page)", fd["why"])
        self.assertEqual(rows[0]["judge_p"], "0.90", "strongest Jev score first")

    def test_a_firm_is_in_only_when_it_backed_something_in_the_pitchs_market(self):
        con = sqlite3.connect(self.db)
        con.execute("UPDATE contacts SET website='quillseed.example' WHERE record_id='p1'")
        con.execute("UPDATE contacts SET website='bellangels.example' WHERE record_id='p9'")
        con.commit(); con.close()
        (self.tmp / "portfolio.json").write_text(json.dumps({"firms": {
            "quillseed.example": {"firm": "Quill Seed Fund", "companies": [
                {"name": "Mycelia Foods", "source": "https://quillseed.example/portfolio"},
                {"name": "Ledger App", "source": "https://quillseed.example/portfolio"}]},
            "bellangels.example": {"firm": "Bell Angels", "companies": [
                {"name": "Pay Rails", "source": "https://bellangels.example/portfolio"}]}}}))
        walked = []

        def match(firm, names):
            walked.append((firm, names))
            return [("Mycelia Foods", 0.9)] if "Mycelia Foods" in names else []
        block = dict(BLOCK)
        rows, stats = gi.build(self.con, block, ask=lambda st, q: [0.99] * len(st),
                               says=lambda site: "We invest in everything.", match=match,
                               lender_ask=lambda st, q: [0.0] * len(st))
        got = self.emails(rows)
        quill = next(r for r in rows if r["email"] == "avery@quillseed.example")
        self.assertIn("backed Mycelia Foods (Jev 0.90, from its portfolio page)", quill["why"])
        self.assertNotIn("hana@bellangels.example", got, "a portfolio with nothing in the market outranks its own site")
        self.assertIn(("Bell Angels", ["Pay Rails"]), walked)
        self.assertEqual(stats["by_portfolio"], 1)

    def test_a_homepage_yes_with_no_readable_portfolio_stays_out(self):
        rows, stats = gi.build(self.con, dict(BLOCK), ask=lambda st, q: [0.95] * len(st),
                               says=lambda site: "We back great founders.",
                               match=lambda firm, names: [(names[0], 0.9)],
                               read_portfolio=lambda dom, firm: {"firm": firm, "companies": []},
                               lender_ask=lambda st, q: [0.0] * len(st))
        self.assertEqual(rows, [])
        self.assertGreater(stats["dropped"]["site reads as a fit, no portfolio to prove it"], 0)

    def test_a_lender_stays_but_is_tagged_last_and_never_counted_as_proven(self):
        def portfolio(dom, firm):
            return {"firm": firm, "companies": [{"name": "Portco", "source": f"https://{dom}/p"}]}
        rows, stats = gi.build(self.con, dict(BLOCK), ask=lambda st, q: [0.9] * len(st),
                               says=lambda site: "We buy equity in seed startups.",
                               match=lambda firm, names: [("Portco", 0.9)], read_portfolio=portfolio,
                               lender_ask=lambda st, q: [0.9 if st[0]["organization"] == "Quill Seed Fund" else 0.1])
        self.assertEqual(rows[-1]["email"], "avery@quillseed.example")
        self.assertEqual(rows[-1]["lender"], "yes")
        self.assertTrue(rows[-1]["why"].startswith("LENDER"))
        self.assertEqual(stats["lenders"], 1)
        self.assertEqual(stats["by_portfolio"], len(rows) - 1)

    def test_the_pitch_is_the_question(self):
        self.assertIn("mushroom protein", gi.judge_question({"pitch": "mushroom protein for restaurants"}))
        self.assertIn("food", gi.judge_question({"thesis_text": ["food"]}))

    def test_with_jev_down_the_list_falls_back_to_keywords_and_says_so(self):
        rows, stats = self.build(ask=lambda st: [None] * len(st))
        self.assertTrue(stats["keyword_only"])
        self.assertTrue(rows)
        self.assertTrue(all(r["thesis_match"] == "yes" for r in rows))

    def test_a_generalist_with_no_site_text_is_never_sent_to_jev(self):
        sent = []
        block = dict(BLOCK)
        rows, stats = gi.build(self.con, block, ask=lambda st, q: sent.extend(st) or [0.99] * len(st),
                               says=lambda site: "",
                               lender_ask=lambda st, q: [0.0] * len(st))
        self.assertTrue(sent, "keyword rows still go, judged on their sectors")
        self.assertTrue(all(s["sectors"] for s in sent), "a blank-sector row with no site is never asked")
        self.assertGreater(stats["unscored"], 0)

    def test_keyword_mode_is_the_offline_match(self):
        rows, stats = self.build(ask=lambda st: self.fail("keyword mode never calls Jev"),
                                 judge={"mode": "keyword"})
        self.assertTrue(all(r["thesis_match"] == "yes" for r in rows))
        with self.assertRaises(gi.ConfigError):
            gi.check_block(dict(BLOCK, judge={"mode": "vibes"}))

    def test_a_website_cell_with_two_hosts_never_crashes_a_run(self):
        import gtme_solo
        self.assertEqual(gtme_solo.fetch("https://www.aim13.example\nwww.aim13.nyc/"), "")
        seen = []
        real = gtme_solo.fetch
        gtme_solo.fetch = lambda url, limit=0: seen.append(url) or ""
        os.environ["GTME_LIST_CACHE"] = str(self.tmp / "cache")
        try:
            gi.site_says("www.aim13.example\nwww.aim13.nyc")
        finally:
            gtme_solo.fetch = real
            os.environ.pop("GTME_LIST_CACHE")
        self.assertEqual(seen, ["https://www.aim13.example"])

    def test_the_judge_runs_from_the_installed_entry_point(self):
        # 2026-10-26: bin/gtme-investors could not import gtme_pipeline for the judge.
        proc = subprocess.run(
            [sys.executable, "-c", "import runpy,sys; ns = runpy.run_path(sys.argv[1], run_name='x'); "
             "print(repr(ns['site_says']('firm.example')))", str(TOOL)],
            capture_output=True, text=True, timeout=60, cwd=str(self.tmp),
            env=dict(os.environ, GTME_FIXTURES=str(self.tmp), PYTHONPATH=""))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(proc.stdout.strip(), "''")

    def test_one_contact_per_firm_and_no_junior_titles(self):
        self.add(("s1", "Sam Stone", "Managing Partner", "Stonepeak Partners", "saas"),
                 ("s2", "Sue Stone", "Partner", "Stonepeak", "saas"),
                 ("j1", "Jay Junior", "Executive Assistant", "Assist Ventures", "saas"),
                 ("j2", "Ann Alyst", "Analyst", "Alyst Capital", "saas"))
        rows, stats = self.build()
        stone = [r for r in rows if "stonepeak" in r["organization"].lower()]
        self.assertEqual(len(stone), 1, "list-gate's firm_key makes these one firm")
        self.assertEqual(stats["dropped"]["another contact at the same firm"], 1)
        self.assertNotIn("j1@j1.example", self.emails(rows))
        self.assertNotIn("j2@j2.example", self.emails(rows))
        self.assertEqual(stats["dropped"]["too junior to decide"], 2)
        self.add(("c1", "Larry Braga", "Executive Officer, Director, Chief Executive Officer and Secretary",
                  "Braga Seed Fund", "saas"))
        rows, _ = self.build()
        self.assertIn("c1@c1.example", self.emails(rows), "a CEO who is also Secretary is the CEO")

    def test_two_firm_names_on_one_domain_are_one_firm(self):
        # Khosla Impact and Khosla Ventures, both khoslaventures.com, 10/26.
        self.add(("k1", "Vin Kho", "Partner", "Kho Impact", "saas"), ("k2", "Dee Wei", "Partner", "Kho Ventures", "saas"))
        con = sqlite3.connect(self.db)
        con.execute("UPDATE contacts SET website='https://www.khoventures.example', email='vk@khoventures.example' WHERE record_id='k1'")
        con.execute("UPDATE contacts SET website='http://khoventures.example/', email='dw@khoventures.example' WHERE record_id='k2'")
        con.commit(); con.close()
        rows, stats = self.build()
        self.assertEqual(sum(1 for r in rows if "khoventures" in r["email"]), 1)
        self.assertGreaterEqual(stats["dropped"]["another contact at the same firm"], 1)

    def test_the_output_passes_list_gate(self):
        self.add(("s1", "Sam Stone", "Managing Partner", "Stonepeak Partners", "saas"),
                 ("s2", "Sue Stone", "Partner", "Stonepeak", "saas"),
                 ("j1", "Jay Junior", "Executive Assistant", "Assist Ventures", "saas"))
        rows, _ = self.build()
        out = self.tmp / "gate.csv"
        gi.write_csv(rows, out)
        proc = subprocess.run([sys.executable, str(ROOT / "bin" / "list-gate"), str(out)], capture_output=True,
                              text=True, timeout=60)
        self.assertEqual(proc.returncode, 0, proc.stdout)

    def add_angels(self, *people):
        con = sqlite3.connect(self.db)
        for rid, name, org, email, sectors in people:
            con.execute("INSERT INTO contacts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (rid, name, "Angel Investor", org, "Angel", "A", 70, "unknown", "Person", email, "",
                         "", "City", "ST", "United States", "North America", "Angel (individual)", 0, 0, sectors))
        con.commit(); con.close()

    def test_angel_mode_judges_each_angel_alone_and_keeps_the_sendable_ones(self):
        # 2026-10-26: the fund path dropped every angel (no portfolio page) and a
        # $5K-check round came back all funds. Every row and email here is invented.
        self.add_angels(("a1", "Ada Wren", "", "ada@wrenhome.example", "consumer, wearables"),
                        ("a2", "Bo Finch", "", "bo@finchco.example", "fintech"),
                        ("a3", "Cy Dove", "", "cy@dovestudio.example", "consumer, design"),
                        ("a4", "Di Dove", "Dove Studio", "di@dovestudio.example", "consumer, apparel"),
                        ("a5", "Ed Lark", "", "ed@deadmail.example", "consumer, jewelry"),
                        ("a6", "Flo Gray", "", "flo@agency.gov", "consumer"),
                        ("a7", "Gil Moor", "", "gil@gmail.com", "consumer"))
        scores = {"wearables": 0.82, "fintech": 0.59, "design": 0.9, "apparel": 0.7, "jewelry": 0.88}
        asked, looked_up = [], []

        def ask(states, q):
            asked.append(len(states))
            s = states[0]["sectors"]
            return [next((p for k, p in scores.items() if k in s), 0.1)]

        def mx(domain):
            looked_up.append(domain)
            return domain != "deadmail.example"
        con = self.con
        funds, _ = gi.build(con, dict(BLOCK), ask=lambda st, q: [0.9] * len(st), says=lambda site: "",
                            match=lambda firm, names: [], read_portfolio=lambda d, f: {"companies": []},
                            lender_ask=lambda st, q: [0.0] * len(st))
        self.assertNotIn("ada@wrenhome.example", self.emails(funds), "the fund path drops a portfolio-less angel")

        rows, stats = gi.build_angels(con, dict(BLOCK, angels=True), ask=ask, mx=mx)
        got = self.emails(rows)
        self.assertTrue(asked and all(n == 1 for n in asked), "every angel judged alone, never in a batch")
        self.assertIn("ada@wrenhome.example", got, "an angel with no portfolio page survives")
        ada = next(r for r in rows if r["email"] == "ada@wrenhome.example")
        self.assertEqual(ada["organization"], "wrenhome.example", "company is the mail domain")
        self.assertEqual(ada["judge_p"], "0.82")
        self.assertNotIn("bo@finchco.example", got, "0.59 is under the 0.6 cut")
        dove = [r for r in rows if r["email"].endswith("@dovestudio.example")]
        self.assertEqual([r["email"] for r in dove], ["cy@dovestudio.example"], "one angel per domain, best first")
        self.assertEqual(stats["dropped"]["another angel at the same domain"], 1)
        self.assertNotIn("ed@deadmail.example", got, "a domain with no MX is dropped")
        self.assertEqual(stats["dropped"]["mail domain has no MX"], 1)
        self.assertNotIn("flo@agency.gov", got)
        self.assertNotIn("gil@gmail.com", got, "a free mailbox with no company names nobody")
        self.assertNotIn("finchco.example", looked_up, "a judged no never costs a lookup")
        self.assertEqual(len(looked_up), len(set(looked_up)), "one lookup per domain")
        self.assertEqual(got, sorted(got, key=lambda e: -float(next(r["judge_p"] for r in rows if r["email"] == e))))
        out = self.tmp / "angels.csv"
        gi.write_csv(rows, out)
        proc = subprocess.run([sys.executable, str(ROOT / "bin" / "list-gate"), str(out)], capture_output=True,
                              text=True, timeout=60)
        self.assertEqual(proc.returncode, 0, proc.stdout)

    def test_angels_flag_routes_the_cli_to_the_angel_pass(self):
        cfg = self.tmp / "c.json"
        cfg.write_text(json.dumps({"investors": dict(BLOCK, db=str(self.db))}))
        seen = []
        real = gi.build_angels
        gi.build_angels = lambda con, block: seen.append(block.get("angels")) or ([], {
            "pool": 0, "matched": 0, "thesis_rows": 0, "unknown_pool": 0, "judged": 0, "judged_in": 0,
            "unscored": 0, "mx_unchecked": 0, "dropped": {}})
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(gi.main(["--config", str(cfg), "--angels", "--dry-run", "--json"]), 0)
        finally:
            gi.build_angels = real
        self.assertEqual(seen, [True])
        with self.assertRaises(gi.ConfigError):
            gi.check_block(dict(BLOCK, angels="yes"))

    def test_the_tool_names_no_client(self):
        src = TOOL.read_text().lower()
        for word in ("zeutara", "junto", "sabo", "thermoshade", "/users/", "zeutara-data"):
            self.assertFalse(word in src, f"tool source names {word}")


if __name__ == "__main__":
    unittest.main(verbosity=1)
