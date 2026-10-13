"""The pre-send gate in the engine: config-driven refused senders and firm
limits, one receipt per client, and the checks the client repo's gate ran.

Synthetic throughout: .example.test domains, invented clients, a temp HOME.
Nothing reads DNS (MX runs through a stub) or a real clients.json.
"""
from __future__ import annotations

import contextlib
import csv
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import gtme_presend as gp  # noqa: E402

HEADER = ["full_name", "title", "organization", "email", "email_verification"]
CLEAN = [["Ann A", "Partner", "Alpha Ventures", "ann@alphaventures.example.test", "valid"],
         ["Bob B", "General Partner", "Beta Capital", "bob@betacapital.example.test", "valid"]]


def write_csv(path: Path, header, rows) -> str:
    with open(path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(rows)
    return str(path)


class PresendTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.home = self.tmp / "home"
        (self.home / ".chewbacca" / "gtm").mkdir(parents=True)
        self.cfg = self.home / ".chewbacca" / "gtm" / "clients.json"
        self.cfg.write_text(json.dumps({"clients": [
            {"name": "Acme Test", "workspaces": ["9001"],
             "refused_senders": ["^(boss)@", "@acme(shop|io)[.-]", r"@(?:[^@]*[.-])?(shop|io)(?:[.-][^@]*)?$"],
             "refused_senders_source": "Acme review 2026-03-04"},
            {"name": "Harbor Test", "workspaces": ["9002"], "presend": {"per_firm_total": 1}}]}))
        self._env = {k: os.environ.get(k) for k in ("HOME", "GTM_CONFIG", "GTME_CLIENTS", "CHEWBACCA_GTM_CLIENTS")}
        os.environ["HOME"] = str(self.home)
        for k in ("GTM_CONFIG", "GTME_CLIENTS", "CHEWBACCA_GTM_CLIENTS"):
            os.environ.pop(k, None)
        self.lst = write_csv(self.tmp / "l.csv", HEADER, CLEAN)
        self.sup = write_csv(self.tmp / "sent.csv", ["email"], [["old@gone.example.test"]])
        self.ver = write_csv(self.tmp / "v.csv", ["email", "verification"],
                             [[r[3], "valid"] for r in CLEAN])

    def tearDown(self):
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self._tmp.cleanup()

    def run_main(self, *argv, client=None):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = gp.main(list(argv), client=client)
        return code, out.getvalue()

    def senders(self, *emails) -> str:
        return write_csv(self.tmp / "senders.csv", ["email"], [[e] for e in emails])

    def full(self, client, senders):
        # every check but MX on the command line; MX runs through a stub
        orig = gp._dig
        gp._dig = lambda d, t: ["10 mx.example.test."] if t == "MX" else []
        try:
            return self.run_main(self.lst, "--client", client, "--verification", self.ver, "--suppress", self.sup,
                                 "--senders", senders, "--mx", "--no-lines")
        finally:
            gp._dig = orig

    def test_a_full_pass_writes_this_clients_receipt_only(self):
        code, out = self.full("Acme Test", self.senders("jane@acmelabs.example.test"))
        self.assertEqual(code, 0, out)
        r = gp.read_receipt("Acme Test")
        self.assertEqual((r["client"], r["full"], r["full_but_lines"]), ("Acme Test", False, True))
        self.assertEqual(sorted(os.path.basename(p) for p in r["hashes"]),
                         ["l.csv", "senders.csv", "sent.csv", "v.csv"])
        self.assertIsNone(gp.read_receipt("Harbor Test"))
        self.assertEqual(gp.receipt_path("Acme Test").name, "acme-test.json")

    def test_a_refused_list_writes_no_receipt(self):
        bad = write_csv(self.tmp / "bad.csv", HEADER, [CLEAN[0][:4] + ["invalid"]])
        code, out = self.run_main(bad, "--client", "Acme Test", "--first-send", "--no-senders", "--no-lines")
        self.assertEqual(code, 1, out)
        self.assertIsNone(gp.read_receipt("Acme Test"))

    def test_refused_senders_come_from_the_clients_config(self):
        for bad in ("boss@acmelabs.example.test", "jane@acmeshop.example.test", "jane@acme-io.example.test",
                    "jane@acme.io", "jane@shop.example.test", "jane@x-shop-y.example.test"):
            code, out = self.full("Acme Test", self.senders(bad))
            self.assertEqual(code, 1, bad)
            self.assertIn("refused list (Acme review 2026-03-04)", out)
            self.assertNotIn(bad.split("@")[0] + "@", out.split("e.g.")[0])
        for fine in ("jane@acmelabs.example.test", "j.doe@acmeone.example.test", "jane@shopify-labs.example.test"):
            self.assertEqual(self.full("Acme Test", self.senders(fine))[0], 0, fine)
        # The other client refused none of these.
        self.assertEqual(self.full("Harbor Test", self.senders("jane@acmeshop.example.test"))[0], 0)

    def test_firm_limits_come_from_the_clients_config(self):
        twin = write_csv(self.tmp / "l2.csv", HEADER, [["Ann B", "Partner", "Alpha Ventures",
                                                       "ann.b@alphaventures.example.test", "valid"]])
        code, out = self.run_main(self.lst, twin, "--client", "Harbor Test", "--first-send", "--no-senders",
                                  "--no-lines")
        self.assertEqual(code, 1, out)
        self.assertIn("exceed the ceiling of 1", out)
        code, out = self.run_main(self.lst, twin, "--client", "Acme Test", "--first-send", "--no-senders",
                                  "--no-lines")
        self.assertEqual(code, 0, out)

    def test_messages_name_no_client(self):
        code, out = self.run_main(self.lst, "--client", "Acme Test", "--no-lines")
        self.assertEqual(code, 1)
        self.assertIn("checked against the client's refused senders", out)
        self.assertIn("every earlier wave", out)
        for name in ("Jonah", "Zeutara", "Sagar"):
            self.assertNotIn(name, out)

    def test_unknown_client_is_a_usage_error(self):
        self.assertEqual(self.run_main(self.lst, "--client", "Nobody Test", "--first-send")[0], 2)

    def test_a_shim_names_its_client_and_receipt(self):
        dest = self.tmp / "elsewhere.json"
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = gp.main([self.lst, "--first-send", "--no-senders", "--no-lines"], client="Acme Test",
                           receipt=str(dest))
        self.assertEqual(code, 0, out.getvalue())
        self.assertTrue(dest.exists())
        self.assertIsNone(gp.read_receipt("Acme Test"))

    def test_chewbacca_gtme_presend_dispatches(self):
        env = dict(os.environ, HOME=str(self.home))
        p = subprocess.run([sys.executable, str(ROOT / "bin" / "gtme"), "presend", self.lst, "--client", "Acme Test",
                            "--first-send", "--no-senders", "--no-lines", "--json"],
                           capture_output=True, text=True, env=env, timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(json.loads(p.stdout)["fails"], [])


if __name__ == "__main__":
    unittest.main()
