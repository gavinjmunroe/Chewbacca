"""Offline checks for the GTM engineer interview bank and its runner.

Each guard here is the failure it prevents: a case that cites a procedure
nobody wrote, a command the kit cannot run, a transcript pasted into the repo,
or an answer path too slow to use in an interview.
"""

import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("gtme_interview", ROOT / "tools/gtme_interview.py")
interview = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(interview)

CASES_FILE = ROOT / "skills/gtme-interview/evals/evals.json"
SKILL = ROOT / "skills/gtme-interview/SKILL.md"
WALKTHROUGHS = ROOT / "library/learning/clay-navigation/WALKTHROUGHS.md"
RAW = Path.home() / "second-brain/raw/clay-videos"

# The copyright line for this kit: a quote under 15 words. Anything longer in
# the shipped files is a paste, not a paraphrase.
MAX_QUOTE_WORDS = 15
# A run of this many words shared with a private transcript or page means text
# was copied rather than distilled. Twelve is long enough that UI labels and
# limits ("Only run if", "50,000 rows") never trip it.
SHINGLE = 12


class CaseBankTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(CASES_FILE.read_text(encoding="utf-8"))
        cls.cases = cls.data["cases"]
        cls.procedures = interview.load_procedures()
        cls.registry = interview.load_registry()

    def test_bank_size_and_shape(self):
        self.assertEqual(self.data["skill"], "gtme-interview")
        self.assertGreaterEqual(len(self.cases), 25)
        ids = [c["id"] for c in self.cases]
        self.assertEqual(len(ids), len(set(ids)), "duplicate case ids")
        for case in self.cases:
            with self.subTest(case=case["id"]):
                for field in ("prompt", "paraphrase", "model_answer", "procedures", "key_points", "build"):
                    self.assertTrue(case.get(field), f"missing {field}")
                self.assertGreaterEqual(len(case["key_points"]), 3)
                self.assertTrue(any(k.startswith("expect") for k in case), "no expectation for chewbacca evals")

    def test_every_case_maps_to_a_sourced_procedure(self):
        for case in self.cases:
            with self.subTest(case=case["id"]):
                for pid in case["procedures"]:
                    self.assertIn(pid, self.procedures, f"{pid} is not in WALKTHROUGHS.md")
                    entry = self.procedures[pid]
                    self.assertTrue(entry["source"], f"{pid} has no Source line")
                    self.assertIn(entry["kit"], {"kit-read", "ui-only", "untaught-write", "formula", "practice"})

    def test_every_procedure_has_a_source_and_one_kit_tag(self):
        self.assertGreaterEqual(len(self.procedures), 100)
        for pid, entry in self.procedures.items():
            with self.subTest(procedure=pid):
                self.assertTrue(entry["source"])
                self.assertTrue(re.search(r"\b(U|D|CB|YT|W):", entry["source"]), "source has no tag")
                self.assertIsNotNone(entry["kit"])

    def test_every_cited_clay_op_exists(self):
        texts = {
            "evals.json": CASES_FILE.read_text(encoding="utf-8"),
            "SKILL.md": SKILL.read_text(encoding="utf-8"),
            "WALKTHROUGHS.md": WALKTHROUGHS.read_text(encoding="utf-8"),
        }
        for name, text in texts.items():
            for op in interview.clay_ops_in(text):
                with self.subTest(file=name, op=op):
                    self.assertIn(op, self.registry, f"chewbacca clay {op} is not in the registry")

    def test_card_commands_validate(self):
        for case in self.cases:
            for command in case.get("commands", []):
                with self.subTest(case=case["id"], command=command):
                    result = interview.validate_command(command, self.registry)
                    self.assertTrue(result["ok"], result["why"])

    def test_validator_rejects_a_made_up_op_and_arg(self):
        self.assertFalse(interview.validate_command("chewbacca clay launch-everything ws=1", self.registry)["ok"])
        self.assertFalse(interview.validate_command("chewbacca clay credits bogus=1", self.registry)["ok"])
        self.assertFalse(interview.validate_command("gtme-nothing --help", self.registry)["ok"])

    def test_model_answers_pass_their_own_key_points(self):
        for case in self.cases:
            with self.subTest(case=case["id"]):
                result = interview.grade(case, case["model_answer"])
                self.assertEqual(result["score"], 1.0, f"model answer misses {result['missed']}")

    def test_grader_fails_a_wrong_answer(self):
        bogus = "I would export everything to a spreadsheet and look at it by hand."
        for case in self.cases:
            with self.subTest(case=case["id"]):
                self.assertFalse(interview.grade(case, bogus)["pass"])

    def test_compute_cases_match_the_math(self):
        computed = [c for c in self.cases if c.get("compute")]
        self.assertGreaterEqual(len(computed), 2)
        for case in computed:
            with self.subTest(case=case["id"]):
                result = interview.compute(case)
                self.assertTrue(result["ok"], result)

    def test_no_long_quotes_and_no_transcript_lines(self):
        for path in (CASES_FILE, SKILL, WALKTHROUGHS):
            text = path.read_text(encoding="utf-8")
            with self.subTest(file=path.name):
                self.assertIsNone(re.search(r"^\s*\[\d+:\d\d\]", text, re.M), "a timestamped transcript line")
                if path.suffix == ".json":
                    # Quoted speech inside a JSON value shows up as inner quotes.
                    # Formulas are code, where quotes delimit strings.
                    phrases = []

                    def walk(node, key=None):
                        if isinstance(node, dict):
                            for k, v in node.items():
                                walk(v, k)
                        elif isinstance(node, list):
                            for v in node:
                                walk(v, key)
                        elif isinstance(node, str) and key != "formula":
                            phrases.extend(seg for i, seg in enumerate(node.split('"')) if i % 2)
                            phrases.extend(re.findall(r"“([^”]+)”", node))

                    walk(json.loads(text))
                else:
                    body = re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.S)
                    body = re.sub(r"```.*?```", "", body, flags=re.S)
                    phrases = [seg for line in body.splitlines()
                               for i, seg in enumerate(re.sub(r"`[^`]*`", "", line).split('"')) if i % 2]
                    phrases += re.findall(r"“([^”]+)”", body)
                for phrase in phrases:
                    self.assertLessEqual(len(phrase.split()), MAX_QUOTE_WORDS, phrase)

    def test_no_em_dashes(self):
        for path in (CASES_FILE, SKILL, WALKTHROUGHS, ROOT / "tools/gtme_interview.py"):
            with self.subTest(file=path.name):
                self.assertNotIn("—", path.read_text(encoding="utf-8"))

    @unittest.skipUnless(RAW.is_dir(), "private raw store not on this machine")
    def test_no_copied_runs_from_private_sources(self):
        def shingles(text):
            words = re.findall(r"[a-z0-9']+", text.lower())
            return {" ".join(words[i:i + SHINGLE]) for i in range(len(words) - SHINGLE + 1)}

        ours = set()
        for path in (CASES_FILE, SKILL, WALKTHROUGHS):
            text = path.read_text(encoding="utf-8")
            # Source lines are citations: a page slug is the page's own title
            # and is meant to match. Code spans are commands copied on purpose.
            text = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("- Source:"))
            ours |= shingles(re.sub(r"`[^`\n]*`", " ", text))
        leaked = []
        for source in RAW.rglob("*.txt"):
            body = source.read_text(encoding="utf-8", errors="ignore")
            if "\n---\n" in body:
                body = body.split("\n---\n", 1)[1]
            common = ours & shingles(body)
            if common:
                leaked.append((source.name, sorted(common)[0]))
        self.assertEqual(leaked, [], f"copied text: {leaked}")


class RunnerTests(unittest.TestCase):
    def test_bench_is_inside_the_budget_and_retrieves_every_prompt(self):
        cases, procedures, registry = interview.load_cases(), interview.load_procedures(), interview.load_registry()
        report = interview.bench(cases, procedures, registry)
        self.assertTrue(report["within_budget"], report["max_ms"])
        self.assertEqual(report["retrieval_prompt"], 1.0, report["misses"])
        # Measured 0.61 top-1 and 0.85 top-3 on 2026-10-10 with author-written
        # paraphrases; the floors catch a retrieval regression, not a target.
        self.assertGreaterEqual(report["retrieval_paraphrase"], 0.5)
        self.assertGreaterEqual(report["retrieval_paraphrase_top3"], 0.8)
        self.assertTrue(all(r["commands_ok"] and r["compute_ok"] for r in report["rows"] if r["correct"]))

    def test_cli_drill_answers_inside_two_seconds_wall_clock(self):
        start = time.perf_counter()
        out = subprocess.run([sys.executable, str(ROOT / "bin/gtme-interview"), "drill", "--seed", "1", "--json"],
                             capture_output=True, text=True, timeout=30)
        wall_ms = (time.perf_counter() - start) * 1000
        self.assertEqual(out.returncode, 0, out.stderr)
        result = json.loads(out.stdout)
        self.assertLess(result["timing"]["total_ms"], interview.BUDGET_MS)
        self.assertEqual(result["grade"]["score"], 1.0)
        # Wall clock includes Python startup on a machine other agents share;
        # 0.11 s was measured at load 24, so 2 s leaves room without hiding a hang.
        self.assertLess(wall_ms, 2000)

    def test_check_exits_nonzero_on_a_failing_answer(self):
        out = subprocess.run([sys.executable, str(ROOT / "bin/gtme-interview"), "check", "icp-score-formula",
                              "--answer", "use a spreadsheet"], capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 1)
        self.assertIn("FAIL", out.stdout)

    def test_bare_command_drills(self):
        # No subcommand is the documented default (drill); it crashed on a
        # missing --seed until 2026-10-10.
        out = subprocess.run([sys.executable, str(ROOT / "bin/gtme-interview")],
                             capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("timing:", out.stdout)

    def test_unknown_case_is_refused(self):
        out = subprocess.run([sys.executable, str(ROOT / "bin/gtme-interview"), "show", "nope"],
                             capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 2)


if __name__ == "__main__":
    unittest.main()
