#!/usr/bin/env python3
"""gtme dns: the checks a sending domain needs before its first cold email (AuraPath, 2026-11-02)."""
import datetime as dt
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import gtme_dns as D  # noqa: E402

GOOD = {("d.com", "MX"): ["1 smtp.google.com."],
        ("d.com", "TXT"): ["v=spf1 include:_spf.google.com ~all", "google-site-verification=x"],
        ("google._domainkey.d.com", "TXT"): ["v=DKIM1; k=rsa; p=MIIBIjAN"],
        ("_dmarc.d.com", "TXT"): ["v=DMARC1; p=none"]}
TODAY = dt.date(2026, 11, 20)


def run(records, born=dt.date(2026, 11, 3), up=True):
    return D.check("d.com", today=TODAY, lookup=lambda n, t: records.get((n, t), []),
                   born=lambda d: born, up=lambda d: up)


class Dns(unittest.TestCase):
    def test_a_set_up_domain_past_warmup_is_ready(self):
        self.assertTrue(run(GOOD)["ok"])

    def test_each_missing_record_fails_its_own_check(self):
        for key, name in ((("d.com", "MX"), "mx"), (("google._domainkey.d.com", "TXT"), "dkim"),
                          (("_dmarc.d.com", "TXT"), "dmarc")):
            r = run({k: v for k, v in GOOD.items() if k != key})
            self.assertFalse(r["ok"])
            self.assertFalse(r["checks"][name]["ok"], name)

    def test_two_spf_records_fail(self):
        r = run({**GOOD, ("d.com", "TXT"): ["v=spf1 include:a ~all", "v=spf1 include:b ~all"]})
        self.assertEqual(r["checks"]["spf"]["why"], "more than one SPF record")

    def test_a_domain_bought_this_week_is_not_ready(self):
        r = run(GOOD, born=dt.date(2026, 11, 15))
        self.assertFalse(r["checks"]["age"]["ok"])
        self.assertEqual(r["checks"]["age"]["days"], 5)

    def test_unknown_age_and_dead_site_fail(self):
        r = run(GOOD, born=None, up=False)
        self.assertFalse(r["checks"]["age"]["ok"])
        self.assertFalse(r["checks"]["site"]["ok"])

    def test_registration_date_comes_from_rdap_events(self):
        body = b'{"events": [{"eventAction": "expiration", "eventDate": "2027-10-09T21:21:04Z"},'\
               b' {"eventAction": "registration", "eventDate": "2026-10-09T21:21:04Z"}]}'

        class R:
            def __init__(self, b): self.b = b
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return self.b
        real = D.urllib.request.urlopen
        D.urllib.request.urlopen = lambda *a, **k: R(body)
        try:
            self.assertEqual(D.created("x.tech"), dt.date(2026, 10, 9))
        finally:
            D.urllib.request.urlopen = real

    def test_dispatches_through_gtme(self):
        p = subprocess.run([sys.executable, str(ROOT / "tools" / "gtme_operator.py"), "dns", "--help"],
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("dkim", p.stdout.lower())


if __name__ == "__main__":
    unittest.main()
