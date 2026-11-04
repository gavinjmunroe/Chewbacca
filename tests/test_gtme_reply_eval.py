"""gtme reply-eval: precision, recall and confusion pairs on a tiny made-up gold file.

Every row here is invented. The real gold set is private reply text and lives only in
~/.chewbacca/private/reply-gold/, never in this repo."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("gtme_reply_eval", ROOT / "tools" / "gtme_reply_eval.py")
ev = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ev)

ROWS = [
    {"id": "a", "label": "bounce_auto",
     "text": "Address not found\n\nYour message wasn't delivered to pat@example.com."},
    {"id": "b", "label": "bounce_auto",
     "text": "I am out of the office until Monday with limited access to email."},
    {"id": "c", "label": "not_interested", "text": "Not a fit for us. Good luck."},
    {"id": "d", "label": "opt_out", "text": "Please unsubscribe me."},
    {"id": "e", "label": "question", "text": "What is their current revenue? Is it ARR?"},
    {"id": "f", "label": "wrong_person",
     "text": "I have left the firm. Please contact sam@example.org instead."},
    # A forward: the classifier has no such kind, so this one is a known confusion.
    {"id": "g", "label": "forward", "text": "Looping in Lee (cc'd), who covers this area."},
    {"id": "h", "label": "not_now", "text": "Busy this month, circle back in 3 weeks."},
]


def write_gold(rows):
    handle = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False, encoding="utf-8")
    for row in rows:
        handle.write(json.dumps(row) + "\n")
    handle.close()
    return handle.name


class Mapping(unittest.TestCase):
    def test_every_classifier_kind_maps_to_a_gold_label(self):
        import gtme_reply
        for kind in gtme_reply.KINDS:
            self.assertIn(ev.to_gold({"kind": kind}), ev.GOLD_LABELS, kind)

    def test_autoresponder_later_is_bounce_auto_but_a_person_later_is_not_now(self):
        self.assertEqual(ev.to_gold({"kind": "later", "label": "Out of office"}), "bounce_auto")
        self.assertEqual(ev.to_gold({"kind": "later", "label": "Come back later"}), "not_now")


class Evaluate(unittest.TestCase):
    def setUp(self):
        self.result = ev.evaluate([dict(r) for r in ROWS])

    def test_counts_and_accuracy(self):
        self.assertEqual(self.result["rows"], 8)
        self.assertEqual(self.result["correct"], 7)
        self.assertEqual(self.result["accuracy"], 0.875)

    def test_per_label_precision_and_recall(self):
        labels = self.result["labels"]
        self.assertEqual(labels["bounce_auto"]["recall"], 1.0)
        self.assertEqual(labels["bounce_auto"]["support"], 2)
        self.assertEqual(labels["forward"]["recall"], 0.0)
        self.assertIsNone(labels["forward"]["precision"])
        # The forward read as wrong_person, so wrong_person is right once in two guesses.
        self.assertEqual(labels["wrong_person"]["precision"], 0.5)
        self.assertEqual(labels["wrong_person"]["recall"], 1.0)

    def test_confusion_pairs_carry_ids(self):
        self.assertEqual(self.result["confusion"],
                         [{"gold": "forward", "predicted": "wrong_person", "count": 1, "ids": ["g"]}])

    def test_another_classifier_can_be_measured_on_the_same_rows(self):
        result = ev.evaluate([dict(r) for r in ROWS], predict=lambda row: "needs_read")
        self.assertEqual(result["correct"], 0)
        self.assertEqual(result["labels"]["needs_read"]["precision"], 0.0)


class Cli(unittest.TestCase):
    def run_cli(self, *args):
        env = dict(os.environ, CHEWBACCA_NO_SEND="1")
        return subprocess.run([sys.executable, str(ROOT / "bin" / "gtme"), "reply-eval", *args],
                              capture_output=True, text=True, env=env, timeout=60)

    def test_prints_table_and_pairs_without_reply_text(self):
        path = write_gold(ROWS)
        try:
            out = self.run_cli("--gold", path, "--misses")
        finally:
            os.unlink(path)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("7 of 8 replies labeled right", out.stdout)
        self.assertIn("forward read as wrong_person  [g]", out.stdout)
        self.assertNotIn("Looping in", out.stdout)

    def test_json_and_recall_floor(self):
        path = write_gold(ROWS)
        try:
            ok = self.run_cli("--gold", path, "--json", "--min", "bounce_auto=1")
            low = self.run_cli("--gold", path, "--min", "forward=0.5")
        finally:
            os.unlink(path)
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertEqual(json.loads(ok.stdout)["labels"]["opt_out"]["recall"], 1.0)
        self.assertEqual(low.returncode, 1)
        self.assertIn("FAIL forward recall", low.stderr)

    def test_bad_label_is_refused(self):
        path = write_gold([{"id": "x", "text": "hi", "label": "maybe"}])
        try:
            out = self.run_cli("--gold", path)
        finally:
            os.unlink(path)
        self.assertEqual(out.returncode, 2)
        self.assertIn("is not one of", out.stderr)


if __name__ == "__main__":
    unittest.main()
