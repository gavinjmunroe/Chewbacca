"""gtme-dedupe: the same person across lists merges, two people never do.

Fixtures in tests/fixtures/gtme-dedupe are invented people at .example
domains. The splink tests run when the splink venv exists and are skipped,
loudly, when it does not; the exact-only path is always tested.
"""
import csv
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BIN = ROOT / "bin" / "gtme-dedupe"
TOOL = ROOT / "tools" / "gtme_dedupe.py"
FIX = ROOT / "tests" / "fixtures" / "gtme-dedupe"
INPUTS = [str(FIX / n) for n in ("clay_export.csv", "purchased_list.csv", "client_crm.csv")]
VENV = Path(os.environ.get("GTME_DEDUPE_VENV",
                           Path.home() / "Library/Caches/chewbacca/splink-venv"))

SPEC = importlib.util.spec_from_file_location("gtme_dedupe", TOOL)
dedupe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dedupe)


def has_splink():
    python = VENV / "bin" / "python"
    return python.exists() and subprocess.run(
        [str(python), "-c", "import splink, duckdb"], capture_output=True).returncode == 0


def run_bin(*args, env_extra=None):
    env = dict(os.environ, GTME_DEDUPE_NO_INSTALL="1", GTME_DEDUPE_VENV=str(VENV))
    env.update(env_extra or {})
    return subprocess.run(["bash", str(BIN), *args], capture_output=True, text=True, env=env)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def clusters_by_person(out_dir):
    with open(Path(out_dir) / "clusters.csv", newline="") as handle:
        rows = list(csv.DictReader(handle))
    people = {}
    for row in rows:
        people.setdefault(f"{row['norm_first']} {row['norm_last']}", set()).add(row["cluster_id"])
    return rows, people


class Normalization(unittest.TestCase):
    def test_plus_tags_strip_only_for_known_providers(self):
        self.assertEqual(dedupe.norm_email("Priya.Fennimore+clay@Gmail.com"),
                         "priya.fennimore@gmail.com")
        self.assertEqual(dedupe.norm_email("a+b@googlemail.com"), "a@gmail.com")
        self.assertEqual(dedupe.norm_email("ops+lists@northwind-labs.example"),
                         "ops+lists@northwind-labs.example")
        self.assertEqual(dedupe.norm_email("not an email"), "")

    def test_linkedin_variants_reduce_to_one_slug(self):
        variants = ["https://www.linkedin.com/in/marisol-quenby/",
                    "http://uk.linkedin.com/in/Marisol-Quenby?trk=public_profile",
                    "linkedin.com/in/marisol-quenby", "marisol-quenby",
                    "https://www.linkedin.com/in/marisol%2Dquenby#about"]
        self.assertEqual({dedupe.norm_linkedin(v) for v in variants}, {"in/marisol-quenby"})
        self.assertEqual(dedupe.norm_linkedin("https://www.linkedin.com/company/quenby"), "")

    def test_company_suffix_variants(self):
        names = ["Harrowgate Instruments, Inc.", "Harrowgate Instruments LLC",
                 "The Harrowgate Instruments Ltd", "HARROWGATE INSTRUMENTS"]
        self.assertEqual({dedupe.norm_company(n) for n in names}, {"harrowgate instruments"})
        # Capital and Ventures are not legal forms: two employers stay two.
        self.assertNotEqual(dedupe.norm_company("Acme Capital"), dedupe.norm_company("Acme Ventures"))

    def test_names_and_domains(self):
        self.assertEqual(dedupe.norm_name("Zoë Brandvold Jr."), "zoe brandvold")
        self.assertEqual(dedupe.norm_name("Vasquez-Lind"), "vasquezlind")
        self.assertEqual(dedupe.domain_from_url("https://www.Saltmarsh.example/about"),
                         "saltmarsh.example")
        self.assertEqual(dedupe.domain_from_url("https://linkedin.com/in/x"), "")


class ExactOnly(unittest.TestCase):
    def test_no_splink_flag_runs_exact_passes_and_says_so(self):
        result = run_bin(*INPUTS, "--no-splink", "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertEqual(summary["mode"], "exact-only")
        self.assertIn("SPLINK DID NOT RUN", result.stderr)
        self.assertEqual(summary["rows_in"], 20)
        self.assertEqual(summary["exact_merges_by_key"],
                         {"email": 2, "linkedin": 2, "name+domain": 1})
        self.assertEqual(summary["probabilistic_merges"], 0)
        self.assertEqual(summary["clusters"], 15)

    def test_missing_splink_falls_back_loudly(self):
        with tempfile.TemporaryDirectory() as shim:
            Path(shim, "splink.py").write_text("raise ImportError('splink removed for test')\n")
            env = dict(os.environ, PYTHONPATH=shim)
            result = subprocess.run([sys.executable, str(TOOL), *INPUTS], capture_output=True,
                                    text=True, env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("SPLINK DID NOT RUN", result.stderr)
        self.assertIn("not importable", result.stderr)
        self.assertIn("exact-only", result.stdout)


@unittest.skipUnless(has_splink(), f"splink venv missing at {VENV}; probabilistic pass untested")
class Probabilistic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.tmp.name) / "out"
        cls.before = {p: digest(p) for p in INPUTS}
        cls.result = run_bin(*INPUTS, "--out", str(cls.out), "--json")
        cls.summary = json.loads(cls.result.stdout)
        cls.rows, cls.people = clusters_by_person(cls.out)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_summary_numbers(self):
        s = self.summary
        self.assertEqual(s["mode"], "splink", self.result.stderr)
        self.assertEqual((s["rows_in"], s["clusters"], s["exact_merges"],
                          s["probabilistic_merges"], s["review_pairs"]), (20, 13, 5, 2, 2))

    def test_plus_tag_and_linkedin_variants_merge(self):
        self.assertEqual(len(self.people["priya fennimore"]), 1)
        self.assertEqual(len(self.people["marisol quenby"]), 1)

    def test_same_name_at_two_companies_does_not_merge(self):
        self.assertEqual(len(self.people["jordan okafor"]), 2)

    def test_company_suffix_and_spelling_variants_merge(self):
        self.assertEqual(len(self.people["teodor vasquezlind"]), 1)
        clusters = {r["cluster_id"] for r in self.rows if r["norm_last"] == "szalay"}
        self.assertEqual(len(clusters), 1)

    def test_coworkers_with_one_surname_stay_apart(self):
        marlow = {r["cluster_id"] for r in self.rows if r["norm_last"] == "marlow"}
        self.assertEqual(len(marlow), 2)
        self.assertEqual(len(self.people["ravi tenbrook"] | self.people["nadia ferreiraholt"]), 2)

    def test_name_only_match_goes_to_review_not_merge(self):
        self.assertEqual(len(self.people["calla whitcombe"]), 2)
        with open(self.out / "review.csv", newline="") as handle:
            names = {row["left_name"] for row in csv.DictReader(handle)}
        self.assertIn("calla whitcombe", names)

    def test_golden_has_one_row_per_cluster(self):
        with open(self.out / "golden.csv", newline="") as handle:
            golden = list(csv.DictReader(handle))
        self.assertEqual(len(golden), 13)
        self.assertEqual(len({g["cluster_id"] for g in golden}), 13)

    def test_inputs_never_written(self):
        self.assertEqual({p: digest(p) for p in INPUTS}, self.before)

    def test_threshold_flags(self):
        result = run_bin(*INPUTS, "--auto", "0.999", "--json")
        summary = json.loads(result.stdout)
        self.assertEqual(summary["probabilistic_merges"], 1)  # Teodor scores ~0.988
        self.assertEqual(summary["review_pairs"], 3)


class Safety(unittest.TestCase):
    def test_scan_writes_nothing(self):
        with tempfile.TemporaryDirectory() as cwd:
            subprocess.run(["bash", str(BIN), *INPUTS, "--no-splink"], cwd=cwd,
                           capture_output=True, check=True,
                           env=dict(os.environ, GTME_DEDUPE_NO_INSTALL="1"))
            self.assertEqual(os.listdir(cwd), [])

    def test_refuses_to_overwrite_an_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            victim = Path(tmp, "clusters.csv")
            victim.write_text(Path(INPUTS[0]).read_text())
            before = digest(victim)
            result = run_bin(str(victim), "--out", tmp, "--no-splink")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("refusing to overwrite an input", result.stderr)
            self.assertEqual(digest(victim), before)

    def test_bad_thresholds_rejected(self):
        result = run_bin(*INPUTS, "--auto", "0.5", "--review", "0.9", "--no-splink")
        self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
