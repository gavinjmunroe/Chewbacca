"""clay_reads: what clay-build learns from Clay itself, through `chewbacca clay`.

Credits, whether table auto-run is on, the work email column, and one rows read
that gives both progress (each cell's status) and found emails. Shapes are the
ones `clay credits balance --help`, `clay tables columns get --help` and
`clay tables rows list --help` document (CLI 2.25.0). Every row here is made
up: example.com addresses and invented names."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import clay_reads  # noqa: E402

EMAIL = "f_email"
NAME = "f_name"
COLUMNS = [
    {"type": "basic", "id": NAME, "name": "Full Name"},
    {"type": "basic", "id": "f_company", "name": "Company Name"},
    {"type": "action", "id": EMAIL, "name": "Find work email"},
    {"type": "basic", "id": "f_sys", "name": "Work email (system)", "system": True},
]


def row(i, cell):
    return {"id": f"r_{i}", "updatedAt": "2026-10-09", "cells": {NAME: {"status": "success", "value": f"Person {i}"},
                                                                   EMAIL: cell}}


def ok(data, **extra):
    return {"ok": True, "op": "x", "surface": "cli", "data": data, **extra}


class FakeRun:
    """Answers `chewbacca clay` by op, and rows by cursor."""

    def __init__(self, answers):
        self.answers = answers
        self.calls = []

    def __call__(self, argv, **kw):
        self.calls.append(argv)
        op = argv[2]
        args = dict(a.split("=", 1) for a in argv[3:])
        body = self.answers[op]
        if isinstance(body, dict) and "pages" in body:
            body = body["pages"][args.get("cursor", "")]
        return subprocess.CompletedProcess(argv, 0, json.dumps(body) + "\n", "")


class ReadsTests(unittest.TestCase):
    def reads(self, **answers):
        run = FakeRun(answers)
        return clay_reads.Reads(run=run, root=Path("/kit")), run

    def test_credits_and_the_exact_argv(self):
        reads, run = self.reads(credits=ok({"balance": 1234.5, "actionExecutionBalance": 0}))
        self.assertEqual(reads.credits("1372623"), 1234.5)
        self.assertEqual(run.calls[0], ["node", "/kit/bin/chewbacca-clay", "credits", "ws=1372623"])

    def test_a_balance_that_is_not_a_number_is_refused(self):
        for data in ({"balance": "lots"}, {"balance": True}, {}, []):
            reads, _ = self.reads(credits=ok(data))
            with self.assertRaises(clay_reads.ReadError):
                reads.credits("1")

    def test_auto_run(self):
        reads, _ = self.reads(table=ok({"id": "t_1", "tableSettings": {"AUTO_RUN_ON": True}}))
        self.assertTrue(reads.auto_run("t_1"))
        reads, _ = self.reads(table=ok({"id": "t_1", "tableSettings": {"AUTO_RUN_ON": False}}))
        self.assertFalse(reads.auto_run("t_1"))

    def test_auto_run_unknown_is_never_read_as_off(self):
        # `clay tables get` answers with a row count and no settings.
        reads, _ = self.reads(table=ok({"type": "regular", "id": "t_1", "rowCount": 50}))
        with self.assertRaises(clay_reads.AutoRunUnknown):
            reads.auto_run("t_1")
        self.assertTrue(issubclass(clay_reads.AutoRunUnknown, clay_reads.ReadError))

    def test_email_field_exact_then_fallback_then_missing(self):
        reads, _ = self.reads(columns=ok(COLUMNS))
        self.assertEqual(reads.email_field("t_1"), EMAIL)
        other = [{"type": "action", "id": "f_w", "name": "Enrich Work Email (waterfall)"}, *COLUMNS[:2]]
        reads, _ = self.reads(columns=ok(other))
        self.assertEqual(reads.email_field("t_1"), "f_w")
        reads, _ = self.reads(columns=ok(COLUMNS[:2] + [COLUMNS[3]]))
        with self.assertRaises(clay_reads.ReadError):
            reads.email_field("t_1")

    def test_name_field(self):
        reads, _ = self.reads(columns=ok(COLUMNS))
        self.assertEqual(reads.name_field("t_1"), NAME)
        reads, _ = self.reads(columns=ok([COLUMNS[2]]))
        self.assertIsNone(reads.name_field("t_1"))

    def test_progress_counts_each_cell_status(self):
        cells = [{"status": "success", "value": "a@example.com"}, {"status": "error", "error": "x"},
                 {"status": "running"}, {"status": "retry"}, {"status": "rate_limited"},
                 {"status": "awaiting_callback"}, {"status": "queued"}, {"status": "empty"}, {"status": "SUCCESS"}]
        reads, _ = self.reads(rows=ok([row(i, c) for i, c in enumerate(cells)]))
        got = reads.progress("1", "t_1", EMAIL)
        self.assertEqual(got, clay_reads.Progress(rows=9, done=2, running=4, queued=1, errors=1))
        self.assertFalse(got.settled)
        reads, _ = self.reads(rows=ok([row(0, {"status": "success"}), row(1, {"status": "empty"})]))
        self.assertTrue(reads.progress("1", "t_1", EMAIL).settled)

    def test_emails_across_pages_with_the_misses_named(self):
        first = [row(i, {"status": "success", "value": f"p{i}@example.com"}) for i in range(3)]
        second = [row(3, {"status": "success", "value": None}),
                  row(4, {"status": "error", "error": "no provider"}),
                  row(5, {"status": "success", "value": {"email": "p5@example.org", "valid": True}})]
        reads, run = self.reads(rows={"pages": {"": ok(first, cursor="c2"), "c2": ok(second)}},
                                columns=ok(COLUMNS))
        tally = reads.emails("1", "t_1", EMAIL)
        self.assertEqual(tally, clay_reads.Tally(rows=6, ran=6, found=4, missing_names=("Person 3", "Person 4")))
        rows_calls = [c for c in run.calls if c[2] == "rows"]
        self.assertEqual(rows_calls[0], ["node", "/kit/bin/chewbacca-clay", "rows", "ws=1", "table=t_1", "limit=100"])
        self.assertEqual(rows_calls[1][-1], "cursor=c2")

    def test_a_cursor_that_repeats_stops_instead_of_looping(self):
        page = ok([row(0, {"status": "empty"})], cursor="same")
        reads, run = self.reads(rows={"pages": {"": page, "same": page}})
        with self.assertRaises(clay_reads.ReadError):
            reads.progress("1", "t_1", EMAIL)
        self.assertLessEqual(len(run.calls), 3)

    def test_a_missed_name_is_cleaned_and_capped(self):
        nasty = "Eve‮" + "x" * 200 + "\n\x00"
        r = {"id": "r_1", "cells": {NAME: {"status": "success", "value": nasty},
                                    EMAIL: {"status": "success", "value": None}}}
        reads, _ = self.reads(rows=ok([r]), columns=ok(COLUMNS))
        name = reads.emails("1", "t_1", EMAIL).missing_names[0]
        self.assertEqual(len(name), 80)
        self.assertTrue(name.startswith("Evexxx"))
        self.assertNotIn("‮", name)

    def test_only_rows_that_ran_count_as_tested(self):
        # After the test run, 2 of 4 rows ran; the untouched ones are not misses.
        rows = [row(0, {"status": "success", "value": "a@example.com"}),
                row(1, {"status": "error", "error": "bounced from b@example.com"}),
                row(2, {"status": "empty"}), row(3, {"status": "empty"})]
        reads, _ = self.reads(rows=ok(rows), columns=ok(COLUMNS))
        self.assertEqual(reads.emails("1", "t_1", EMAIL),
                         clay_reads.Tally(rows=4, ran=2, found=1, missing_names=("Person 1",)))

    def test_has_email(self):
        self.assertTrue(clay_reads.has_email("jo@example.com"))
        self.assertTrue(clay_reads.has_email({"value": {"emails": ["jo@example.co.uk"]}}))
        self.assertTrue(clay_reads.has_email([None, "x", "JO@EXAMPLE.COM"]))
        self.assertFalse(clay_reads.has_email("No email found"))
        self.assertFalse(clay_reads.has_email({"status": "error"}))
        self.assertFalse(clay_reads.has_email(None))
        self.assertFalse(clay_reads.has_email("a@b"))

    def test_ids_from_href(self):
        href = "https://app.clay.com/workspaces/1372623/workbooks/wb_1/tables/t_0tltdAbc9/views/gv_1"
        self.assertEqual(clay_reads.ids_from_href(href), ("1372623", "t_0tltdAbc9"))
        self.assertEqual(clay_reads.ids_from_href("https://app.clay.com/workspaces/9/home"), ("9", None))
        self.assertEqual(clay_reads.ids_from_href("https://example.com/"), (None, None))

    def test_not_ok_raises_the_reason(self):
        reads, _ = self.reads(credits={"ok": False, "class": "error",
                                       "reason": "Not signed in. Run `clay login` to authenticate."})
        with self.assertRaises(clay_reads.ReadError) as caught:
            reads.credits("1")
        self.assertIn("clay login", str(caught.exception))

    def test_a_hung_read_is_an_error(self):
        def run(argv, **kw):
            raise subprocess.TimeoutExpired(argv, kw.get("timeout"))
        with self.assertRaises(clay_reads.ReadError):
            clay_reads.Reads(run=run).credits("1")

    def test_fixture_mode_end_to_end(self):
        balance = {"exit": 0, "stdout": json.dumps({"balance": 1234.5}), "stderr": ""}
        with tempfile.TemporaryDirectory() as d:
            for kind in ("cli", "bin"):
                (Path(d) / kind).mkdir()
            (Path(d) / "cli" / "credits.json").write_text(json.dumps(balance))
            env = {**os.environ, "CHEWBACCA_CLAY_FIXTURES": d}
            reads = clay_reads.Reads(run=lambda argv, **kw: subprocess.run(argv, env=env, **kw))
            self.assertEqual(reads.credits("1372623"), 1234.5)


if __name__ == "__main__":
    unittest.main()
