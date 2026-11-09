"""case-study: numbers need sources, ranges stay ranges, typed headlines must match the math."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("case_study", ROOT / "tools/case_study.py")
cs = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cs)

STORY = {"anonymous_as": "An engineering firm", "permission": {},
         "metrics": [{"name": "Time per payroll", "unit": "hours", "before": [4, 8], "after": 0.5,
                      "source": "timesheets"}],
         "value": [{"label": "Quote avoided", "amount": 30000, "source": "vendor PDF"}]}


class CaseStudyTests(unittest.TestCase):
    def test_range_in_range_out(self):
        # 4 to 0.5 is 87.5% less, 8 to 0.5 is 93.75% less: a public "94%" uses only the top end.
        r = cs.compute(STORY["metrics"][0])
        self.assertEqual(r["change"], "88 to 94% less")
        self.assertEqual(r["before"], "4 to 8 hours")

    def test_point_values_and_higher_is_better(self):
        r = cs.compute({"name": "Meetings a month", "before": 4, "after": 10, "lower_is_better": False, "source": "crm"})
        self.assertEqual(r["change"], "150% more")

    def test_unsourced_number_refused(self):
        s = copy.deepcopy(STORY); s["metrics"][0]["source"] = ""
        self.assertIn("Time per payroll: no source", cs.problems(s))
        with self.assertRaises(SystemExit):
            cs.build(s)

    def test_named_client_and_quote_need_permission(self):
        s = copy.deepcopy(STORY); s["client"] = "Real Co"; s["quote"] = {"text": "Great", "who": "CEO", "source": "email"}
        bad = cs.problems(s)
        self.assertTrue(any("permission.name" in b for b in bad))
        self.assertTrue(any("permission.quote" in b for b in bad))
        s["permission"] = {"name": "CEO email 2026-10-01", "quote": "same email"}
        self.assertEqual(cs.problems(s), [])

    def test_typed_headline_must_match(self):
        m = dict(STORY["metrics"][0], headline_pct=99)
        with self.assertRaises(SystemExit):
            cs.compute(m)
        self.assertEqual(cs.compute(dict(m, headline_pct=94))["change"], "88 to 94% less")

    def test_no_metrics_is_a_testimonial(self):
        self.assertTrue(cs.problems({"metrics": []}))

    def test_cli_writes_md_and_html(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp, "s.json"); p.write_text(json.dumps(STORY))
            md, ht = Path(tmp, "o.md"), Path(tmp, "o.html")
            out = subprocess.run([sys.executable, str(ROOT / "bin/case-study"), "build", str(p), "--out", str(md), "--html", str(ht)],
                                 capture_output=True, text=True)
            self.assertEqual(out.returncode, 0, out.stderr)
            self.assertIn("88 to 94% less", md.read_text())
            self.assertIn("<table>", ht.read_text())
            self.assertNotIn("—", md.read_text() + ht.read_text())
            chk = subprocess.run([sys.executable, str(ROOT / "bin/case-study"), "check", str(p)], capture_output=True, text=True)
            self.assertEqual(chk.returncode, 0)

    def test_template_is_publishable(self):
        self.assertEqual(cs.problems(cs.TEMPLATE), [])


if __name__ == "__main__":
    unittest.main()
