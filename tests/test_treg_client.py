#!/usr/bin/env python3
"""Paid lookups through treg, billed per customer, against a fake treg on
127.0.0.1. No real token, no real charge: the fake answers with the headers
treg documents (X-Treg-Cost-Micro, X-Treg-Call-Id, X-Treg-Served-By)."""
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "tests"))
import treg_client  # noqa: E402
import gtme_solo  # noqa: E402
from test_gtme_solo import Solo  # noqa: E402

CALLS = []


class FakeTreg(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        CALLS.append({"path": self.path, "headers": dict(self.headers), "body": body})
        hit = body.get("full_name") == "Sam Lee"
        out = {"output": {"email": "sam@nomail.test" if hit else None},
               "_treg": {"served_by": "tomba", "verification": {"verdict": "valid"} if hit else {}}}
        self.send_response(200)
        self.send_header("X-Treg-Cost-Micro", "4834")
        self.send_header("X-Treg-Call-Id", f"call_{len(CALLS)}")
        self.send_header("X-Treg-Served-By", "tomba")
        self.end_headers()
        self.wfile.write(json.dumps(out).encode())

    def log_message(self, *a):
        pass


class Paid(Solo):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), FakeTreg)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        super().setUp()
        CALLS.clear()
        treg_client.BASE = f"http://127.0.0.1:{self.server.server_port}"
        os.environ["TREG_TOKEN"] = "test-not-a-real-token"
        with (self.d / "list-raw.csv").open("w") as f:
            f.write("company,website,name,title,linkedin,email,location,source,why\n"
                    "Crumb Corner,crumbcorner.test,,,,,Austin,yc,\n"
                    "No Mail Cafe,nomail.test,Sam Lee,Owner,,,Austin,yc,\n"
                    "Other Cafe,nomail.test,Pat Kim,Owner,,,Austin,yc,\n"
                    "Third Cafe,nomail.test,Lou Ng,Owner,,,Austin,yc,\n")

    def tearDown(self):
        os.environ.pop("TREG_TOKEN", None)
        super().tearDown()

    def spend_rows(self):
        f = self.d / "spend.jsonl"
        return [json.loads(x) for x in f.read_text().splitlines()] if f.exists() else []

    # these Solo tests assume the other list; they run in test_gtme_solo.py
    test_find_takes_only_emails_the_company_printed_on_its_own_site = None
    test_batch_carries_name_address_and_opt_out_and_no_blanks = None
    test_send_then_follow_up_threads_under_the_first_email = None
    test_opt_out_is_suppressed_and_a_reply_stops_follow_ups = None
    test_a_rerun_of_a_half_sent_batch_never_emails_anyone_twice = None
    test_two_batches_in_one_day_never_pass_the_daily_cap = None
    test_send_needs_the_exact_batch_and_dry_run_sends_nothing = None
    test_no_send_env_refuses = None
    test_an_edited_or_stale_batch_refuses = None
    test_a_personal_line_without_a_source_link_is_held = None

    def test_without_an_approved_amount_it_prices_exactly_one_lookup(self):
        self.ready()
        self.run_cli("find", "--client", "Dana Co", "--paid")
        self.assertEqual(len(CALLS), 1)
        self.assertEqual(len(self.spend_rows()), 1)

    def test_every_call_is_tagged_capped_and_recorded_at_treg_charge(self):
        self.ready()
        self.run_cli("find", "--client", "Dana Co", "--paid", "--spend", "1")
        self.assertEqual(len(CALLS), 3)
        h = {k.lower(): v for k, v in CALLS[0]["headers"].items()}
        self.assertEqual(h["x-treg-meta"], "customer=dana-co")
        self.assertEqual(h["x-treg-route-max-cost"], "0.0500")
        self.assertEqual(h["x-treg-token"], "test-not-a-real-token")
        self.assertEqual(CALLS[0]["path"], "/call/treg.people.email.find")
        self.assertEqual([r["cost_micro"] for r in self.spend_rows()], [4834] * 3)
        self.assertIn("sam@nomail.test", (self.d / "leads.csv").read_text())

    def test_the_approved_amount_and_the_monthly_budget_both_stop_it(self):
        self.ready()
        # $0.054 approved: one call fits even at the 5 cent cap; after its real
        # $0.0048, a second could reach $0.0548, so it never runs.
        self.run_cli("find", "--client", "Dana Co", "--paid", "--spend", "0.054")
        self.assertEqual(len(CALLS), 1)
        CALLS.clear()
        self.run_cli("package", "--client", "Dana Co", "--data-budget", "0.05")
        self.run_cli("find", "--client", "Dana Co", "--paid", "--spend", "1")
        self.assertEqual(CALLS, [])

    def test_a_corrupt_ledger_stops_spending(self):
        self.ready()
        (self.d / "spend.jsonl").write_text("not json\n")
        self.run_cli("find", "--client", "Dana Co", "--paid", "--spend", "1")
        self.assertEqual(CALLS, [])

    def test_a_missing_charge_header_counts_the_cap(self):
        rows = []
        f = self.tmp / "spend.jsonl"
        treg_client._record(f, "dana-co", "treg.people.email.find", {}, self.op.utc_now(), 0.05)
        rows = [json.loads(x) for x in f.read_text().splitlines()]
        self.assertEqual(rows[0]["cost_micro"], 50000)

    def test_no_token_spends_nothing(self):
        self.ready()
        os.environ.pop("TREG_TOKEN")
        os.environ["PATH"] = "/nonexistent"  # no `security`, so no Keychain token either
        try:
            self.run_cli("find", "--client", "Dana Co", "--paid", "--spend", "1")
        finally:
            os.environ["PATH"] = "/usr/bin:/bin"
        self.assertEqual(CALLS, [])

    def test_costs_add_data_mailboxes_and_domains(self):
        self.ready()
        self.run_cli("find", "--client", "Dana Co", "--paid", "--spend", "1")
        self.run_cli("package", "--client", "Dana Co", "--mailboxes", "10", "--mailbox-cost", "3",
                     "--domains", "4", "--domain-cost", "12", "--price", "300")
        import io
        from contextlib import redirect_stdout
        buf = io.StringIO()
        with redirect_stdout(buf):
            self.run_cli("costs", "--client", "Dana Co", "--json")
        c = json.loads(buf.getvalue())
        self.assertEqual(c["data_usd"], 0.01)
        self.assertEqual(c["mailboxes_usd"], 30)
        self.assertEqual(c["domains_usd"], 4)
        self.assertEqual(c["margin_usd"], round(300 - (0.014502 + 30 + 4), 2))


if __name__ == "__main__":
    unittest.main()
