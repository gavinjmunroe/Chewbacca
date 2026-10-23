"""gtme-investors turns a client's investors block into one deduped, audited CSV.

Every fixture is invented: a tiny sqlite file with the Prometheus contacts
shape, .example domains, no real investor and no real client. Nothing reads
the network or the real database.
"""
from __future__ import annotations

import csv
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
        self.con = sqlite3.connect(f"file:{self.db}?mode=ro", uri=True)

    def tearDown(self):
        self.con.close()
        self._tmp.cleanup()

    def build(self, **over):
        block = dict(BLOCK, **over)
        gi.check_block(block)
        return gi.build(self.con, block)

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
        e = dict(os.environ, PROMETHEUS_DB=str(self.db))
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

    def test_the_tool_names_no_client(self):
        src = TOOL.read_text().lower()
        for word in ("zeutara", "junto", "sabo", "thermoshade", "/users/", "zeutara-data"):
            self.assertFalse(word in src, f"tool source names {word}")


if __name__ == "__main__":
    unittest.main(verbosity=1)
