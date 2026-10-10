"""Cross-model review merge and runner tests. Stubbed reviewers only: no model is ever called."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("review_cross", ROOT / "tools/review_cross.py")
cross = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cross)


def finding(file, line, message, scenario="input x reaches the call and it fails", severity="high"):
    return {"file": file, "line": line, "severity": severity, "message": message, "scenario": scenario}


def report(*findings, status="reviewed"):
    return {"status": status, "summary": "synthetic review", "findings": list(findings)}


NULL_A = finding("src/app.py", 42, "user_id from the request body is trusted without an ownership check",
                 "POST another user's id and read their rows")
NULL_B = finding("./src/app.py", 44, "ownership check missing: request body user_id is trusted",
                 "send someone else's user_id and their rows come back", severity="critical")
SQL_A = finding("db/query.py", 10, "query built with string interpolation of the search term",
                "a quote in the term breaks out of the SQL string")
LEAK_B = finding("src/log.py", 7, "token printed to the debug log", "run with DEBUG and the bearer token is in the file")


class MergeTests(unittest.TestCase):
    def test_classifies_agreed_and_each_side(self):
        merged = cross.merge(report(NULL_A, SQL_A), report(NULL_B, LEAK_B))
        self.assertEqual(len(merged["agreed"]), 1)
        pair = merged["agreed"][0]
        self.assertEqual(pair["a"]["line"], 42)
        self.assertEqual(pair["b"]["file"], "src/app.py")  # ./ prefix normalized
        self.assertTrue(pair["severity_differs"])
        self.assertEqual([item["file"] for item in merged["only_a"]], ["db/query.py"])
        self.assertEqual([item["file"] for item in merged["only_b"]], ["src/log.py"])

    def test_same_words_different_file_never_agree(self):
        other = dict(NULL_B, file="src/other.py")
        merged = cross.merge(report(NULL_A), report(other))
        self.assertEqual(merged["agreed"], [])
        self.assertEqual(len(merged["only_a"]), 1)
        self.assertEqual(len(merged["only_b"]), 1)

    def test_near_lines_with_unrelated_words_do_not_agree(self):
        unrelated = finding("src/app.py", 43, "off by one in pagination loop", "page 2 repeats the last row")
        merged = cross.merge(report(NULL_A), report(unrelated))
        self.assertEqual(merged["agreed"], [])

    def test_far_lines_need_strong_word_overlap(self):
        far_same = dict(NULL_A, file="src/app.py", line=42 + 30)
        self.assertEqual(len(cross.merge(report(NULL_A), report(far_same))["agreed"]), 1)
        too_far = dict(NULL_A, line=42 + cross.FAR_LINES + 1)
        self.assertEqual(cross.merge(report(NULL_A), report(too_far))["agreed"], [])
        weak_far = dict(NULL_B, line=42 + 30)
        self.assertLess(cross.similarity(NULL_A, weak_far), cross.FAR_SIMILARITY)
        self.assertEqual(cross.merge(report(NULL_A), report(weak_far))["agreed"], [])

    def test_matching_is_one_to_one_and_best_first(self):
        exact = dict(NULL_A)
        merged = cross.merge(report(NULL_A), report(NULL_B, exact))
        self.assertEqual(len(merged["agreed"]), 1)
        self.assertEqual(merged["agreed"][0]["b"]["line"], 42)  # the exact copy wins
        self.assertEqual([item["line"] for item in merged["only_b"]], [44])

    def test_deterministic_for_equal_input(self):
        a, b = report(NULL_A, SQL_A), report(LEAK_B, NULL_B)
        self.assertEqual(json.dumps(cross.merge(a, b), sort_keys=True), json.dumps(cross.merge(a, b), sort_keys=True))

    def test_normalize_file_strips_diff_prefixes_and_root(self):
        self.assertEqual(cross.normalize_file("b/src/app.py"), "src/app.py")
        self.assertEqual(cross.normalize_file("/repo/src/app.py", "/repo"), "src/app.py")
        self.assertEqual(cross.normalize_file("././src//app.py"), "src/app.py")

    def test_cross_result_surfaces_only_disagreements(self):
        result = cross.cross_result("codex", report(NULL_A, SQL_A), "claude", report(NULL_B, LEAK_B))
        self.assertEqual(result["mode"], "cross-model")
        self.assertEqual(sorted((item["found_by"], item["file"]) for item in result["needs_human"]),
                         [("claude", "src/log.py"), ("codex", "db/query.py")])
        self.assertTrue(result["complete"])
        text = cross.render(result)
        self.assertIn("Agreed, both found it (fix these): 1", text)
        self.assertIn("only codex: db/query.py:10", text)
        self.assertEqual(cross.exit_code(result), 1)

    def test_clean_cross_review_exits_zero(self):
        result = cross.cross_result("codex", report(), "claude", report())
        self.assertEqual(cross.exit_code(result), 0)
        self.assertEqual(result["needs_human"], [])

    def test_incomplete_reviewer_marks_result_incomplete(self):
        result = cross.cross_result("codex", report(), "claude", report(status="incomplete"))
        self.assertFalse(result["complete"])
        self.assertIn("claude returned status incomplete", cross.render(result))

    def test_single_model_is_labeled_and_unconfirmed(self):
        result = cross.cross_result("codex", report(SQL_A), None, None, reason="only codex is installed")
        self.assertEqual(result["mode"], "single-model")
        self.assertEqual(result["agreed"], [])
        text = cross.render(result)
        self.assertTrue(text.startswith("SINGLE-MODEL REVIEW by codex (only codex is installed)"))
        self.assertIn("unconfirmed: db/query.py:10", text)


STUB = """#!/bin/sh
# Stub reviewer: replays a canned report. Never contacts a model.
name=$(basename "$0")
[ -n "$STUB_FAIL" ] && [ "$STUB_FAIL" = "$name" ] && exit 3
echo "$name $*" >> "$STUB_LOG"
if [ "$name" = codex ]; then
  out=""
  while [ $# -gt 0 ]; do
    if [ "$1" = "--output-last-message" ]; then out="$2"; fi
    shift
  done
  cat "$STUB_DIR/codex.json" > "$out"
else
  python3 -c 'import json,sys; print(json.dumps({"type":"result","result":"done","structured_output":json.load(open(sys.argv[1]))}))' "$STUB_DIR/claude.json"
fi
"""


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.bin = base / "bin"
        self.bin.mkdir()
        self.stubs = base / "stubs"
        self.stubs.mkdir()
        self.log = base / "calls.log"
        self.repo = base / "repo"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q"], cwd=self.repo, check=True)
        (self.stubs / "codex.json").write_text(json.dumps(report(NULL_A, SQL_A)))
        (self.stubs / "claude.json").write_text(json.dumps(report(NULL_B, LEAK_B)))
        # PATH holds only the stub directory and the system tools, so a real
        # codex or claude on this machine can never be reached.
        env = {"PATH": "%s:/usr/bin:/bin" % self.bin, "STUB_DIR": str(self.stubs), "STUB_LOG": str(self.log),
               "HOME": str(base)}
        self.env = patch.dict(os.environ, env, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def install(self, *names):
        for name in names:
            path = self.bin / name
            path.write_text(STUB)
            path.chmod(0o755)

    def test_two_runtimes_run_cross_model(self):
        self.install("codex", "claude")
        first, second, reason = cross.plan_reviewers()
        self.assertEqual((first["runtime"], second["runtime"], reason), ("codex", "claude", None))
        self.assertIsNone(second["model"])  # runtime default, nothing hardcoded
        result = cross.run(self.repo)
        self.assertEqual(result["mode"], "cross-model")
        self.assertEqual(len(result["agreed"]), 1)
        self.assertEqual(len(result["needs_human"]), 2)
        calls = self.log.read_text()
        self.assertIn("--sandbox read-only", calls)
        self.assertIn("--disallowedTools Edit,Write,NotebookEdit", calls)

    def test_reviewer_order_is_configurable(self):
        self.install("codex", "claude")
        os.environ["CHEWBACCA_REVIEWERS"] = "claude,codex"
        first, second, _ = cross.plan_reviewers()
        self.assertEqual((first["runtime"], second["runtime"]), ("claude", "codex"))

    def test_claude_only_pairs_two_models(self):
        self.install("claude")
        first, second, _ = cross.plan_reviewers()
        self.assertEqual(first["runtime"], "claude")
        self.assertEqual(second["runtime"], "claude")
        self.assertNotEqual(first["model"], second["model"])
        cross.run(self.repo)
        models = [line.split("--model ")[1].split()[0] for line in self.log.read_text().splitlines()]
        self.assertEqual(len(set(models)), 2)

    def test_codex_only_degrades_to_single_model(self):
        self.install("codex")
        result = cross.run(self.repo)
        self.assertEqual(result["mode"], "single-model")
        self.assertIn("only codex", result["reason"])
        self.assertEqual(len(result["needs_human"]), 2)

    def test_second_reviewer_failure_degrades_with_reason(self):
        self.install("codex", "claude")
        os.environ["STUB_FAIL"] = "claude"
        result = cross.run(self.repo)
        self.assertEqual(result["mode"], "single-model")
        self.assertIn("second reviewer claude failed", result["reason"])

    def test_no_runtime_is_an_error(self):
        with self.assertRaises(ValueError):
            cross.run(self.repo)

    def test_reuses_review_gate_report_as_reviewer_a(self):
        self.install("codex", "claude")
        saved = Path(self.temp.name) / "failure.json"
        saved.write_text(json.dumps({"kind": "findings", "report": report(NULL_A)}))
        result = cross.run(self.repo, a_report=saved)
        self.assertEqual(result["reviewers"]["a"]["label"], "codex")
        self.assertEqual(result["reviewers"]["b"]["label"], "claude")
        self.assertEqual(len(result["agreed"]), 1)
        self.assertNotIn("codex exec", self.log.read_text())  # A was reused, not rerun

    def test_cli_merge_needs_no_runtime(self):
        a, b = Path(self.temp.name) / "a.json", Path(self.temp.name) / "b.json"
        a.write_text(json.dumps(report(NULL_A, SQL_A)))
        b.write_text(json.dumps(report(NULL_B, LEAK_B)))
        done = subprocess.run([sys.executable, str(ROOT / "bin/review-cross"), "merge", str(a), str(b), "--json"],
                              capture_output=True, text=True)
        self.assertEqual(done.returncode, 1, done.stderr)
        result = json.loads(done.stdout)
        self.assertEqual(len(result["agreed"]), 1)
        self.assertEqual(len(result["needs_human"]), 2)
        self.assertFalse(self.log.exists())

    def test_cli_detect_reports_none_without_runtimes(self):
        done = subprocess.run([sys.executable, str(ROOT / "bin/review-cross"), "detect"], capture_output=True, text=True)
        self.assertEqual(done.returncode, 2)
        self.assertEqual(json.loads(done.stdout)["mode"], "none")


if __name__ == "__main__":
    unittest.main()
