import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools", "creator_gtm")
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "intro_ledger"))
import deliver  # noqa: E402
import ledger  # noqa: E402

TOKEN = "t" * 32
INTRO = {"client": "sabo", "brand": "Strava", "person": "John Kevane", "email": "jkevane@strava.com",
         "delivered_for": "Noah Rolette (Rawdawg Run Club)", "why": "Owns athlete partnerships"}


class LedgerTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "ledger.jsonl")
        self.ledger = ledger.Ledger(self.path)

    def test_server_stamps_the_date_and_chains(self):
        r1, created = self.ledger.append(INTRO, now=datetime(2026, 10, 16, 22, 5, tzinfo=timezone.utc))
        r2, _ = self.ledger.append({**INTRO, "brand": "Klarna", "email": "jina.lee@klarna.com",
                                    "person": "Jina Lee"})
        self.assertTrue(created)
        self.assertEqual(r1["delivered_on"], "2026-10-16")
        self.assertEqual(r1["prev"], ledger.GENESIS)
        self.assertEqual(r2["prev"], r1["hash"])
        self.assertEqual(ledger.Ledger(self.path).verify(), (True, None))

    def test_caller_cannot_backdate(self):
        with self.assertRaises(ValueError):
            self.ledger.append({**INTRO, "delivered_on": "2026-01-01"})

    def test_same_intro_twice_returns_the_original(self):
        r1, _ = self.ledger.append(INTRO)
        r2, created = self.ledger.append({**INTRO, "email": "JKEVANE@strava.com"})
        self.assertFalse(created)
        self.assertEqual(r1["seq"], r2["seq"])
        self.assertEqual(len(self.ledger.records), 1)

    def test_same_person_for_another_creator_is_a_new_intro(self):
        self.ledger.append(INTRO)
        _, created = self.ledger.append({**INTRO, "delivered_for": "Another Creator"})
        self.assertTrue(created)

    def test_an_edited_file_refuses_to_load(self):
        self.ledger.append(INTRO)
        self.ledger.append({**INTRO, "delivered_for": "Another Creator"})
        with open(self.path) as f:
            lines = f.readlines()
        rec = json.loads(lines[0])
        rec["delivered_on"] = "2026-07-01"
        lines[0] = ledger.canonical(rec) + "\n"
        with open(self.path, "w") as f:
            f.writelines(lines)
        with self.assertRaises(SystemExit):
            ledger.Ledger(self.path)

    def test_a_dropped_record_refuses_to_load(self):
        for creator in ("a", "b", "c"):
            self.ledger.append({**INTRO, "delivered_for": creator})
        with open(self.path) as f:
            lines = f.readlines()
        with open(self.path, "w") as f:
            f.writelines([lines[0], lines[2]])
        with self.assertRaises(SystemExit):
            ledger.Ledger(self.path)

    def test_missing_fields_and_bad_corrections_refuse(self):
        with self.assertRaises(ValueError):
            self.ledger.append({"client": "sabo", "brand": "x"})
        with self.assertRaises(ValueError):
            self.ledger.append({**INTRO, "kind": "correction"})
        rec, created = self.ledger.append({**INTRO, "kind": "correction", "supersedes": 1, "note": "typo"})
        self.assertTrue(created)


class HttpTest(unittest.TestCase):
    def setUp(self):
        self.ledger = ledger.Ledger(os.path.join(tempfile.mkdtemp(), "ledger.jsonl"))
        os.environ["LEDGER_READ_TOKENS"] = "sabo:" + "r" * 32
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), ledger.make_handler(self.ledger, TOKEN))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()

    def call(self, method, path, body=None, token=None):
        req = urllib.request.Request(self.base + path, method=method,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Authorization": f"Bearer {token}"} if token else {})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, r.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()

    def test_writes_need_the_admin_token(self):
        self.assertEqual(self.call("POST", "/intros", INTRO)[0], 401)
        self.assertEqual(self.call("POST", "/intros", INTRO, "r" * 32)[0], 401)
        self.assertEqual(self.call("POST", "/intros", INTRO, TOKEN)[0], 201)
        self.assertEqual(self.call("POST", "/intros", INTRO, TOKEN)[0], 200)

    def test_no_update_or_delete(self):
        for m in ("PUT", "PATCH", "DELETE"):
            self.assertEqual(self.call(m, "/intros", INTRO, TOKEN)[0], 405)

    def test_health_is_public_and_shows_no_emails(self):
        self.call("POST", "/intros", INTRO, TOKEN)
        code, body = self.call("GET", "/health")
        self.assertEqual(code, 200)
        self.assertNotIn("strava", body)
        self.assertEqual(json.loads(body)["count"], 1)

    def test_a_client_token_reads_only_its_own_client(self):
        self.call("POST", "/intros", INTRO, TOKEN)
        self.call("POST", "/intros", {**INTRO, "client": "acme"}, TOKEN)
        self.assertEqual(self.call("GET", "/intros?client=sabo")[0], 401)
        code, body = self.call("GET", "/intros?client=sabo", token="r" * 32)
        self.assertEqual((code, json.loads(body)["count"]), (200, 1))
        self.assertEqual(self.call("GET", "/intros?client=acme", token="r" * 32)[0], 401)
        self.assertEqual(self.call("GET", "/intros", token="r" * 32)[0], 401)
        code, csv_body = self.call("GET", "/intros.csv?client=sabo", token=TOKEN)
        self.assertIn("jkevane@strava.com", csv_body)


class HardeningTest(HttpTest):
    def test_an_empty_read_token_refuses_to_start(self):
        os.environ["LEDGER_READ_TOKENS"] = "sabo:"
        with self.assertRaises(SystemExit):
            ledger.read_tokens()
        os.environ["LEDGER_READ_TOKENS"] = "sabo:short"
        with self.assertRaises(SystemExit):
            ledger.read_tokens()

    def test_no_bearer_reads_nothing(self):
        self.call("POST", "/intros", INTRO, TOKEN)
        req = urllib.request.Request(self.base + "/intros?client=sabo", headers={"Authorization": "Bearer "})
        with self.assertRaises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(req)
        self.assertEqual(e.exception.code, 401)

    def test_csv_neutralises_formulas(self):
        self.call("POST", "/intros", {**INTRO, "why": "=HYPERLINK(\"http://x\")", "person": "@SUM(1)"}, TOKEN)
        _, body = self.call("GET", "/intros.csv?client=sabo", token=TOKEN)
        self.assertIn("'=HYPERLINK", body)
        self.assertIn("'@SUM", body)
        self.assertNotIn(",=HYPERLINK", body)

    def test_negative_content_length_is_refused(self):
        import http.client
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1], timeout=5)
        conn.putrequest("POST", "/intros")
        conn.putheader("Authorization", f"Bearer {TOKEN}")
        conn.putheader("Content-Length", "-1")
        conn.endheaders()
        self.assertEqual(conn.getresponse().status, 400)
        conn.close()


class DeliverTest(unittest.TestCase):
    IDS = {"brand": "b", "domain": "d", "creator": "c", "person": "p", "title": "t", "email": "e",
           "verify": "v", "profile": "l", "why": "w", "contact": "k", "status": "s"}

    def row(self, verify="✅ Valid email", email="jkevane@strava.com"):
        vals = {"b": "Strava", "d": "strava.com", "c": "Noah", "p": "John Kevane", "t": "Partnerships",
                "e": email, "v": verify, "l": "https://linkedin.com/in/x", "w": "why", "k": "line", "s": "Ready"}
        return {"id": "r_1", "cells": {k: {"value": v} for k, v in vals.items()}}

    def test_payload_maps_columns_and_keeps_the_row_as_evidence(self):
        p = deliver.payload_for({"client_slug": "sabo", "ws": "1", "table": "t"}, self.row(), self.IDS)
        self.assertEqual(p["email_verdict"], "valid")
        self.assertEqual(p["source"]["row"], "r_1")
        self.assertEqual(deliver.problems(p), [])
        self.assertTrue(set(p) <= set(ledger.FIELDS))

    def test_a_ready_row_with_a_bad_email_check_is_not_recorded(self):
        p = deliver.payload_for({"client_slug": "sabo", "ws": "1", "table": "t"},
                                self.row(verify="❌ Invalid email"), self.IDS)
        self.assertEqual(deliver.problems(p), ["email check is invalid"])


if __name__ == "__main__":
    unittest.main()
