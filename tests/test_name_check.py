"""name-check reads whois the way it's really printed, with no network."""

import importlib.machinery
import importlib.util
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
loader = importlib.machinery.SourceFileLoader("name_check", str(ROOT / "bin" / "name-check"))
spec = importlib.util.spec_from_loader("name_check", loader)
nc = importlib.util.module_from_spec(spec)
loader.exec_module(nc)

# Shapes copied from real whois output on 2026-10-28.
VERISIGN_FREE = 'No match for domain "DOUGHGTM.COM".\n>>> Last update of whois database'
AI_FREE = "Domain not found.\n"
TAKEN_BRAND = "   Domain Name: DOUGH.COM\n   Registrar: MarkMonitor Inc.\n   Creation Date: 1996"
TAKEN_SMALL = "   Domain Name: GODOUGH.COM\n   Registrar: NameCheap, Inc.\n"


def fake_run(table):
    def run(cmd, **kw):
        return subprocess.CompletedProcess(cmd, 0, stdout=table.get(cmd[-1], ""), stderr="")
    return run


class WhoisParsing(unittest.TestCase):
    def test_free_and_taken(self):
        run = fake_run({"a.com": VERISIGN_FREE, "a.ai": AI_FREE, "b.com": TAKEN_SMALL})
        self.assertEqual(nc.whois("a.com", run)[0], "free")
        self.assertEqual(nc.whois("a.ai", run)[0], "free")
        self.assertEqual(nc.whois("b.com", run), ("taken", "NameCheap, Inc."))

    def test_silence_is_unknown_not_free(self):
        # Rate-limited whois prints nothing. That must never read as available.
        self.assertEqual(nc.whois("x.com", fake_run({}))[0], "unknown")


class Holder(unittest.TestCase):
    def test_brand_registrar_wins_over_page(self):
        self.assertIn("unlikely to sell", nc.holder("taken", "MarkMonitor Inc.", "no site"))

    def test_parked_is_buyable(self):
        self.assertIn("buyable", nc.holder("taken", "NameCheap, Inc.", "parked or for sale"))


class Check(unittest.TestCase):
    def test_dough_like_case(self):
        table = {"dough.com": TAKEN_BRAND, "dough.ai": TAKEN_SMALL, "rundough.com": VERISIGN_FREE,
                 "trydough.com": TAKEN_SMALL, "getdough.com": TAKEN_SMALL, "usedough.com": TAKEN_SMALL,
                 "joindough.com": TAKEN_SMALL, "doughhq.com": VERISIGN_FREE}
        r = nc.check("Dough", run=fake_run(table), fetch=lambda d: "<title>dough</title>")
        self.assertIn("unlikely to sell", r["com"])
        self.assertEqual(r["ai"], "taken")
        self.assertEqual(sorted(r["free_prefix"]), ["doughhq.com", "rundough.com"])
        self.assertIn("tmsearch.uspto.gov", r["uspto"])


if __name__ == "__main__":
    unittest.main()
