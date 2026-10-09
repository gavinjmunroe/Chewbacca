"""Exercise the real gate process with a synthetic capture subprocess."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

GATE = Path(__file__).resolve().parents[1] / "bin/design-gate"
CAPTURE = '''import json, os, pathlib, sys
INK_LO = .03
def pinned_and_clipped(res): return []
def dead_runs(res, lo): return []
if __name__ == "__main__":
    mode = os.environ["TEST_CAPTURE_MODE"]
    if mode == "crash": sys.exit(1)
    out = pathlib.Path(sys.argv[sys.argv.index("--out") + 1])
    shots = int(sys.argv[sys.argv.index("--shots") + 1])
    record = {"y": 0, "vh": 900, "ink": .1, "illegible": [], "overlaps": [], "texts": []}
    if mode == "defect": record["illegible"] = [{"purity": .2}]
    data = [record] * shots
    if mode == "empty": data = []
    if mode == "partial": data = data[:-1]
    (out / "eye.json").write_text("broken json" if mode == "malformed" else json.dumps(data))
    if mode == "exit7": sys.exit(7)
    sys.exit(1 if mode in ("defect", "advisory") else 0)
'''


class CaptureGateTests(unittest.TestCase):
    def run_gate(self, mode, stale=False):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            shutil.copyfile(GATE, root / "design-gate")
            (root / "ux-eye").write_text(CAPTURE)
            out = root / "output"
            out.mkdir()
            if stale:
                (out / "eye.json").write_text(json.dumps([
                    {"y": 0, "vh": 900, "ink": .1, "illegible": [], "overlaps": [], "texts": []}
                ] * 2))
            env = dict(os.environ, DESIGN_GATE_OUT=str(out), TEST_CAPTURE_MODE=mode)
            result = subprocess.run([sys.executable, str(root / "design-gate"),
                                     "https://test.invalid", "--shots", "2"],
                                    env=env, capture_output=True, text=True)
            captures = list(out.glob("capture-*/eye.json"))
            return result, len(captures)

    def test_failed_capture_cannot_reuse_stale_clean_report(self):
        result, count = self.run_gate("crash", stale=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(count, 0)
        self.assertIn("GATE ERROR", result.stderr)
        self.assertNotIn("GATE PASS", result.stdout)

    def test_clean_capture_passes_from_new_directory(self):
        result, count = self.run_gate("clean", stale=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(count, 1)
        self.assertIn("GATE PASS", result.stdout)

    def test_legitimate_defect_exit_is_evaluated(self):
        result, _ = self.run_gate("defect")
        self.assertEqual(result.returncode, 2)
        self.assertIn("REFUSED", result.stderr)
        self.assertIn("unreadable", result.stderr)
        self.assertNotIn("GATE ERROR", result.stderr)

    def test_advisory_exit_one_is_not_a_capture_failure(self):
        result, _ = self.run_gate("advisory")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_unexpected_exit_cannot_pass_even_with_fresh_report(self):
        result, _ = self.run_gate("exit7")
        self.assertEqual(result.returncode, 2)
        self.assertIn("exit 7", result.stderr)

    def test_incomplete_or_unreadable_reports_fail_closed(self):
        for mode in ("empty", "partial", "malformed"):
            with self.subTest(mode=mode):
                result, _ = self.run_gate(mode)
                self.assertEqual(result.returncode, 2)
                self.assertIn("GATE ERROR", result.stderr)
                self.assertNotIn("GATE PASS", result.stdout)


if __name__ == "__main__":
    unittest.main()
