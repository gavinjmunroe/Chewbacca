"""rfp-extract: verbatim rows with page and line, typed, deduped, numbered clauses intact."""
import csv
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("rfp_extract", ROOT / "tools/rfp_extract.py")
rx = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rx)

# An invented RFP, two pages split by a form feed like pdftotext emits.
RFP = """REQUEST FOR PROPOSAL 26-114
Payroll Job Costing Software

3 Scope of Work
3.1 The vendor shall reconcile payroll exports before any file reaches the ledger. The vendor
must log every change against the record it touched.
The vendor should provide weekly training for staff.

Proposals are due no later than December 4, 2026 at 5:00 PM Pacific.
Questions must be submitted by 11/20/2026.
\f4 Evaluation Criteria
Proposals will be evaluated on technical approach (40 points), cost (30 points) and past performance (30%).
3.1 The vendor shall reconcile payroll exports before any file reaches the ledger.
This page describes the county's history and has nothing binding in it.
"""


class RfpTests(unittest.TestCase):
    def rows(self):
        return rx.extract(RFP.split("\f"))

    def test_kinds_and_counts(self):
        kinds = [r["kind"] for r in self.rows()]
        self.assertEqual(kinds, ["mandatory", "mandatory", "desired", "deadline", "deadline", "scoring"])

    def test_verbatim_and_located(self):
        r = self.rows()
        self.assertEqual(r[0]["text"], "3.1 The vendor shall reconcile payroll exports before any file reaches the ledger.")
        self.assertEqual((r[0]["page"], r[0]["line"]), (1, 5))
        self.assertEqual(r[1]["text"], "The vendor must log every change against the record it touched.")
        self.assertEqual(r[0]["section"], "3 Scope of Work")
        self.assertEqual(r[5]["page"], 2)
        self.assertEqual(r[5]["section"], "4 Evaluation Criteria")

    def test_repeat_clause_counted_once(self):
        texts = [r["text"] for r in self.rows()]
        self.assertEqual(len(texts), len(set(texts)))

    def test_questions_deadline_beats_must(self):
        q = [r for r in self.rows() if r["text"].startswith("Questions")][0]
        self.assertEqual(q["kind"], "deadline")

    def test_cli_csv_and_empty_refusal(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp, "rfp.txt"); src.write_text(RFP)
            out_csv = Path(tmp, "m.csv")
            out = subprocess.run([sys.executable, str(ROOT / "bin/rfp-extract"), str(src), "--csv", str(out_csv)],
                                 capture_output=True, text=True)
            self.assertEqual(out.returncode, 0, out.stderr)
            self.assertIn("2 mandatory, 1 desired, 2 deadline, 1 scoring", out.stdout)
            with out_csv.open(encoding="utf-8-sig") as f:
                rows = list(csv.DictReader(f))
            self.assertEqual(rows[0]["response"], "")
            blank = Path(tmp, "b.txt"); blank.write_text("Just a history of the county.\n")
            none = subprocess.run([sys.executable, str(ROOT / "bin/rfp-extract"), str(blank)], capture_output=True, text=True)
            self.assertEqual(none.returncode, 2)


if __name__ == "__main__":
    unittest.main()
