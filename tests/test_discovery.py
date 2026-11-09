"""discovery: readiness scoring refuses unproven top answers, ROI is a range, unmeasured rows stay out."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("discovery", ROOT / "tools/discovery.py")
d = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(d)

HEADER = ",".join(d.ROI_COLUMNS)


def rows(text):
    import csv, io
    return list(csv.DictReader(io.StringIO(HEADER + "\n" + text)))


class AssessTests(unittest.TestCase):
    def test_top_answer_without_evidence_scores_partial(self):
        all_two = {c["id"]: 2 for c in d.CHECKS}
        res = d.assess(all_two)
        self.assertEqual(res["points"], 10)
        self.assertEqual(len(res["unproven"]), 10)
        self.assertEqual(res["tier"], "Building")

    def test_evidence_earns_full_score_and_top_tier(self):
        full = {c["id"]: {"score": 2, "evidence": f"https://example.test/{c['id']}"} for c in d.CHECKS}
        res = d.assess(full)
        self.assertEqual((res["points"], res["tier"], res["focus_90_days"]), (20, "Operating", []))

    def test_focus_list_fixes_leadership_before_compounding(self):
        answers = {c["id"]: {"score": 2, "evidence": "x"} for c in d.CHECKS}
        answers["sharing"] = 0
        answers["owner"] = 1
        res = d.assess(answers)
        self.assertEqual([f["check"] for f in res["focus_90_days"]], ["owner", "sharing"])

    def test_blank_is_not_started(self):
        self.assertEqual(d.assess({})["tier"], "Not started")

    def test_bad_input_refused(self):
        for bad in ({"owner": 3}, {"nope": 1}, {"owner": True}):
            with self.assertRaises(SystemExit):
                d.assess(bad)


class RoiTests(unittest.TestCase):
    def test_range_math_and_payback(self):
        # 10 runs x 60 min = 10 h/week = 520 h/yr at $50 = $26,000; 50-100% automatable.
        res = d.roi(rows("Payroll prep,10,60,50,0.5,1,40,100,timed by owner"))
        w = res["workflows"][0]
        self.assertEqual(w["baseline_cost_year"], 26000)
        self.assertEqual(w["savings_year"], [13000, 26000])
        self.assertEqual(w["hours_returned_year"], [260.0, 520.0])
        self.assertEqual(w["build_cost"], 4000)
        self.assertEqual(w["payback_weeks_worst_case"], 16)  # 4000 / (13000/52) = 16

    def test_unsourced_row_stays_out_of_totals(self):
        res = d.roi(rows("Measured,10,60,50,0.5,1,40,100,stopwatch\nGuess,100,60,50,0.5,1,40,100,"))
        self.assertEqual([w["workflow"] for w in res["workflows"]], ["Measured"])
        self.assertEqual(res["unmeasured"][0]["workflow"], "Guess")
        self.assertEqual(res["totals"]["savings_year"], [13000, 26000])

    def test_build_order_uses_the_low_end(self):
        # Wide guess: huge high end, tiny low end. Narrow: solid low end. Narrow goes first.
        res = d.roi(rows("Wide,10,60,50,0.05,1,40,100,est\nNarrow,10,60,50,0.6,0.7,40,100,timed"))
        self.assertEqual([w["workflow"] for w in res["workflows"]], ["Narrow", "Wide"])

    def test_bad_rows_refused(self):
        for bad in ("X,ten,60,50,0.5,1,40,100,s", "X,10,60,50,0.9,0.5,40,100,s", "X,10,60,50,0.5,1.5,40,100,s"):
            with self.assertRaises(SystemExit):
                d.roi(rows(bad))


class CliTests(unittest.TestCase):
    def test_report_end_to_end(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = Path(tmp, "a.json"); a.write_text(json.dumps({"owner": 2, "access": {"score": 2, "evidence": "seat list"}}))
            w = Path(tmp, "w.csv"); w.write_text(HEADER + "\nInvoices,40,12,55,0.5,0.8,24,150,timed\nRFPs,5,90,80,0.3,0.6,30,150,\n")
            out = subprocess.run([sys.executable, str(ROOT / "bin/discovery"), "report", "--org", "Example Co",
                                  "--assess", str(a), "--roi", str(w)], capture_output=True, text=True)
            self.assertEqual(out.returncode, 0, out.stderr)
            self.assertIn("# Discovery report: Example Co", out.stdout)
            self.assertIn("Scored down for missing evidence: owner", out.stdout)
            self.assertIn("RFPs: no source", out.stdout)
            self.assertNotIn("—", out.stdout)

    def test_templates_round_trip(self):
        out = subprocess.run([sys.executable, str(ROOT / "bin/discovery"), "template", "assess"], capture_output=True, text=True)
        data = json.loads(out.stdout)
        self.assertEqual(set(data), {c["id"] for c in d.CHECKS})
        csv_t = subprocess.run([sys.executable, str(ROOT / "bin/discovery"), "template", "roi"], capture_output=True, text=True).stdout
        import csv, io
        self.assertEqual(len(d.roi(list(csv.DictReader(io.StringIO(csv_t))))["workflows"]), 1)


if __name__ == "__main__":
    unittest.main()
