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
import test_gtme_solo  # noqa: E402

CALLS = []
# Who the fake finder finds, and the verdict its same-call check gives.
FOUND = {"Sam Lee": ("sam@nomail.test", "valid"), "Pat Kim": ("pat@othercafe.test", "catch_all")}
# The fake verifier's word per address; anything else is valid.
VERIFY_WORDS = {"hello@rollhouse.test": "invalid", "maria@crumbcorner.test": "accept_all"}


class FakeTreg(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        CALLS.append({"path": self.path, "headers": dict(self.headers), "body": body})
        if self.path == "/call/treg.people.email.verify":
            # The routed verifier answers {output: {valid, status}}; status is
            # the provider's own word. A catch-all domain says valid=true.
            word = VERIFY_WORDS.get(body.get("email"), "valid")
            # "ok_false": a provider saying ok while its valid flag says no.
            out = {"output": {"valid": word in ("valid", "accept_all"),
                              "status": "ok" if word == "ok_false" else word},
                   "_treg": {"served_by": "contactout"}}
            self.send_response(200)
            self.send_header("X-Treg-Cost-Micro", "0")
            self.send_header("X-Treg-Call-Id", f"call_{len(CALLS)}")
            self.send_header("X-Treg-Served-By", "contactout.people.email.verify")
            self.end_headers()
            self.wfile.write(json.dumps(out).encode())
            return
        hit = body.get("full_name") in FOUND
        out = {"output": {"email": FOUND[body["full_name"]][0] if hit else None},
               "_treg": {"served_by": "tomba",
                         "verification": {"verdict": FOUND[body["full_name"]][1]} if hit else {}}}
        self.send_response(200)
        self.send_header("X-Treg-Cost-Micro", "4834")
        self.send_header("X-Treg-Call-Id", f"call_{len(CALLS)}")
        self.send_header("X-Treg-Served-By", "tomba")
        self.end_headers()
        self.wfile.write(json.dumps(out).encode())

    def log_message(self, *a):
        pass


class Paid(test_gtme_solo.Solo):
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

    def test_a_found_email_that_only_verifies_catch_all_is_held_and_never_bought_twice(self):
        # Before 2026-10-13 anything not "invalid" went out, so Pat's catch_all did.
        self.ready()
        self.run_cli("sender", "--client", "Dana Co", "--name", "Dana Ruiz", "--address", "12 Main St, Austin TX")
        self.run_cli("find", "--client", "Dana Co", "--paid", "--spend", "1")
        self.assertEqual(self.verdicts()["pat@othercafe.test"], "catch_all")
        b = self.batch()
        self.assertIn("pat@othercafe.test", [m["to"] for m in b["held"]])
        self.assertNotIn("pat@othercafe.test", [m["to"] for m in b["mails"]])
        bought = [c["body"].get("full_name") for c in CALLS]
        CALLS.clear()
        self.run_cli("find", "--client", "Dana Co", "--paid", "--spend", "1")
        self.assertNotIn("Pat Kim", [c["body"].get("full_name") for c in CALLS])
        self.assertIn("Pat Kim", bought)

    # verify: the site's own emails, checked before they leave a primary inbox

    def site_list(self):
        (self.tmp / "fx" / "sites" / "bakery.test.html").write_text("<p>orders@bakery.test</p>")
        with (self.d / "list-raw.csv").open("w") as f:
            f.write("company,website,name,title,linkedin,email,location,source,why\n"
                    "Crumb Corner,crumbcorner.test,,,,,Austin,yc,\n"
                    "Roll House,rollhouse.test,,,,,Austin,yc,\n"
                    "Bakery,bakery.test,,,,,Austin,yc,\n")
        self.ready()

    def verdicts(self):
        import csv
        return {r["email"]: r["email_verdict"] for r in csv.DictReader((self.d / "leads.csv").open())}

    def test_verify_without_an_approved_amount_prices_one_check(self):
        self.site_list()
        self.run_cli("verify", "--client", "Dana Co")
        self.assertEqual([c["path"] for c in CALLS], ["/call/treg.people.email.verify"])
        self.assertEqual(len(self.spend_rows()), 1)
        self.assertEqual(sum(1 for v in self.verdicts().values() if v), 1)

    def test_verify_is_tagged_capped_and_only_valid_reaches_a_batch(self):
        self.site_list()
        self.run_cli("verify", "--client", "Dana Co", "--spend", "1")
        self.assertEqual(len(CALLS), 3)
        h = {k.lower(): v for k, v in CALLS[0]["headers"].items()}
        self.assertEqual(h["x-treg-meta"], "customer=dana-co")
        self.assertEqual(h["x-treg-route-max-cost"], "0.0150")
        self.assertEqual(self.verdicts(), {"maria@crumbcorner.test": "catch_all",
                                           "hello@rollhouse.test": "invalid", "orders@bakery.test": "valid"})
        self.assertIn("hello@rollhouse.test", gtme_solo.suppressed("Dana Co"))
        b = self.batch()
        self.assertEqual([m["to"] for m in b["mails"]], ["orders@bakery.test"])
        self.assertEqual([m["to"] for m in b["held"]], ["maria@crumbcorner.test"])
        # A second run checks nothing it already paid for, and a rerun of find keeps the verdicts.
        CALLS.clear()
        self.run_cli("verify", "--client", "Dana Co", "--spend", "1")
        self.run_cli("find", "--client", "Dana Co")
        self.assertEqual(CALLS, [])
        self.assertEqual(self.verdicts()["orders@bakery.test"], "valid")

    def test_verify_with_no_token_changes_nothing(self):
        self.site_list()
        os.environ.pop("TREG_TOKEN")
        os.environ["PATH"] = "/nonexistent"
        try:
            self.assertEqual(self.run_cli("verify", "--client", "Dana Co", "--spend", "1"), 0)
        finally:
            os.environ["PATH"] = "/usr/bin:/bin"
        self.assertEqual(CALLS, [])
        self.assertFalse(any(self.verdicts().values()))
        self.assertEqual(len(self.batch()["mails"]), 3)

    def test_valid_false_is_never_sent_whatever_the_status_word(self):
        self.site_list()
        VERIFY_WORDS["orders@bakery.test"] = "ok_false"
        try:
            self.run_cli("verify", "--client", "Dana Co", "--spend", "1")
        finally:
            VERIFY_WORDS.pop("orders@bakery.test")
        self.assertEqual(self.verdicts()["orders@bakery.test"], "invalid")

    def test_verdict_words_never_turn_unknown_into_valid(self):
        self.assertEqual(treg_client.verdict_word("accept_all"), "catch_all")
        self.assertEqual(treg_client.verdict_word("Deliverable"), "valid")
        self.assertEqual(treg_client.verdict_word("do_not_mail"), "unknown")
        self.assertEqual(treg_client.verdict_word(None), "unknown")

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

    def test_only_a_retainer_pays_for_mailboxes_and_domains(self):
        self.ready()
        import io
        from contextlib import redirect_stdout
        for shape in ("one_time_list", "self_serve"):
            self.run_cli("package", "--client", "Dana Co", "--shape", shape, "--price", "500")
            buf = io.StringIO()
            with redirect_stdout(buf):
                self.run_cli("costs", "--client", "Dana Co", "--json")
            c = json.loads(buf.getvalue())
            self.assertEqual((c["shape"], c["mailboxes_usd"], c["domains_usd"]), (shape, 0, 0))
            self.assertEqual(c["margin_usd"], 500)
        with self.assertRaises(SystemExit):
            self.run_cli("package", "--client", "Dana Co", "--shape", "percent_of_deals")


# Solo's own tests assume Solo's list and run in test_gtme_solo.py. Naming them
# one by one here broke whenever Solo gained a test: on 2026-10-13 four new ones
# ran against this list and failed on main.
for _name in [n for n in vars(test_gtme_solo.Solo) if n.startswith("test_") and n not in vars(Paid)]:
    setattr(Paid, _name, None)


if __name__ == "__main__":
    unittest.main()
