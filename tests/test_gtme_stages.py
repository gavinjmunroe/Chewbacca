"""Every list builder runs as named stages through gtme_accounts.run_stages.

Dough improvement plan item 13 (2026-11-02): five list builders overlapped, each with its own
copy of the same steps. They now share one runner, so this checks the seam itself: an unknown
stage is refused, a trace counts rows in and out of every step, each builder reports its own
stage order, and asking for a trace changes no row. Fixtures are the builders' own invented
test data, so nothing leaves the machine.

Run: CHEWBACCA_NO_SEND=1 python3 -I tests/test_gtme_stages.py
"""
from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "tests"))
import gtme_accounts as ga  # noqa: E402
import gtme_investors as gi  # noqa: E402
import gtme_pipeline as gp  # noqa: E402
import test_gtme_accounts as TA  # noqa: E402
import test_gtme_investors as TI  # noqa: E402


def stages(trace):
    return [t["stage"] for t in trace]


class Runner(unittest.TestCase):
    def test_unknown_stage_is_refused(self):
        with self.assertRaises(ValueError):
            ga.run_stages([("enrich", lambda rows: rows)], [])

    def test_trace_counts_rows_through_each_step(self):
        trace = []

        def evens(rows):
            return [r for r in rows if r % 2 == 0]

        out = ga.run_stages([("source", lambda _: list(range(10))), ("fit", evens)], trace=trace)
        self.assertEqual(out, [0, 2, 4, 6, 8])
        self.assertEqual([(t["stage"], t["step"], t["in"], t["out"]) for t in trace],
                         [("source", "<lambda>", 0, 10), ("fit", "evens", 10, 5)])


class Investors(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        db = Path(self._tmp.name) / "contacts.db"
        TI.make_db(db)
        self.con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)

    def tearDown(self):
        self.con.close()
        self._tmp.cleanup()

    def test_fund_list_stages_and_trace_changes_nothing(self):
        block = dict(TI.BLOCK, judge={"mode": "keyword"})
        plain, _ = gi.build(self.con, block)
        trace = []
        traced, stats = gi.build(self.con, block, trace=trace)
        self.assertEqual(plain, traced)
        self.assertEqual(stages(trace), ["source", "fit", "dedupe", "verify", "tier"])
        self.assertEqual(trace[0]["out"], stats["pool"])
        self.assertEqual(trace[-1]["out"], len(traced))

    def test_angels_are_judged_one_row_per_call(self):
        sizes, trace = [], []

        def ask(states, q):
            sizes.append(len(states))
            return [0.9] * len(states)

        rows, stats = gi.build_angels(self.con, dict(TI.BLOCK), ask=ask, mx=lambda d: True, trace=trace)
        self.assertEqual(stages(trace), ["source", "fit", "verify", "dedupe", "verify", "tier"])
        self.assertTrue(sizes and set(sizes) == {1}, "an angel is judged alone, never in a batch")
        self.assertEqual(trace[-1]["out"], len(rows))


class Pipeline(unittest.TestCase):
    def test_registry_list_stages(self):
        rows_in = [{"company": "Acme IT", "rank": "2"}, {"company": "Beta MSP", "rank": "1"},
                   {"company": "Gamma Ops", "rank": "3"}]
        saved = gp.seed, gp.confirm
        gp.seed = lambda block: ([dict(r) for r in rows_in], {"sources": [], "dropped": {}})
        gp.confirm = lambda rec, block: rec
        try:
            trace = []
            ps = iter([0.9, 0.1, 0.9])
            rows, report = gp.build({"judge": {"question": "fit?"}}, ask=lambda st, q: [next(ps) for _ in st],
                                    trace=trace)
        finally:
            gp.seed, gp.confirm = saved
        self.assertEqual(stages(trace), ["source", "verify", "fit", "tier"])
        self.assertEqual([t["out"] for t in trace], [3, 3, 2, 2])
        self.assertEqual(report["judged_no"], 1)
        self.assertEqual([r["company"] for r in rows], ["Acme IT", "Gamma Ops"])


class Accounts(unittest.TestCase):
    def test_account_list_stages(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            os.environ["PEOPLE_DIR"] = str(tmp / "no-people")
            try:
                trace = []
                rows, summary = ga.build("acme", TA.plan(tmp), tmp / "work", tools=TA.fake_tools(),
                                         ask=TA.fake_ask([]), about=lambda org, sigs: (sigs, []),
                                         today=date(2026, 10, 29), trace=trace)
            finally:
                os.environ.pop("PEOPLE_DIR", None)
        self.assertEqual(stages(trace), ["source", "fit", "fit", "fit", "buyer", "verify", "dedupe", "dnc", "tier"])
        self.assertEqual(trace[0]["out"], summary["accounts_sourced"])
        self.assertEqual(trace[-1]["out"], summary["rows"])


if __name__ == "__main__":
    unittest.main()
