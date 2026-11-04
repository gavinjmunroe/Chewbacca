#!/usr/bin/env python3
"""chewbacca platforms: the status rows and the sending-domain planner, with every CLI faked.

The planner's job is the one that bites: on 2026-11-03 three AuraPath domains got MX, SPF and
DMARC written by it on Cloudflare. A second SPF record is a permerror (the same as none), so a
rerun must see what is there and refuse to stack another one."""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import platforms  # noqa: E402

D = "getaurapath.com"


class Plan(unittest.TestCase):
    def test_google_mail_records(self):
        recs = {(r["type"], r["name"]): r for r in platforms.plan(D)}
        self.assertEqual(recs[("MX", D)]["content"], "smtp.google.com")
        self.assertEqual(recs[("MX", D)]["priority"], 1)
        self.assertEqual(recs[("TXT", D)]["content"], "v=spf1 include:_spf.google.com ~all")
        self.assertTrue(recs[("TXT", "_dmarc." + D)]["content"].startswith("v=DMARC1; p=none;"))
        self.assertNotIn(("A", D), recs)  # no redirect asked, no web records

    def test_dkim_verify_redirect_added_only_when_given(self):
        recs = platforms.plan(D, redirect="https://aurapathai.com", dkim="v=DKIM1; k=rsa; p=AAA", verify="tok")
        names = {(r["type"], r["name"]) for r in recs}
        self.assertIn(("TXT", "google._domainkey." + D), names)
        self.assertIn(("A", D), names)
        self.assertIn(("CNAME", "www." + D), names)
        self.assertIn("google-site-verification=tok", [r["content"] for r in recs])

    def test_redirect_keeps_the_path(self):
        rule = platforms.redirect_rules("https://aurapathai.com/")["rules"][0]
        self.assertEqual(rule["action_parameters"]["from_value"]["status_code"], 301)
        self.assertEqual(rule["action_parameters"]["from_value"]["target_url"]["expression"],
                         'concat("https://aurapathai.com", http.request.uri.path)')


class Diff(unittest.TestCase):
    def verdicts(self, existing, **kw):
        return {(r["type"], r["name"], r["content"][:8]): v for r, v in platforms.diff(platforms.plan(D, **kw), existing)}

    def test_empty_zone_creates_everything(self):
        self.assertEqual(set(self.verdicts([]).values()), {"create"})

    def test_rerun_sees_its_own_records(self):
        existing = [{"type": r["type"], "name": r["name"], "content": r["content"]} for r in platforms.plan(D)]
        existing[1]["content"] = '"' + existing[1]["content"] + '"'  # Cloudflare returns TXT quoted
        self.assertEqual(set(self.verdicts(existing).values()), {"exists"})

    def test_never_stacks_a_second_spf_or_mx(self):
        existing = [{"type": "TXT", "name": D, "content": "v=spf1 include:mailgun.org ~all"},
                    {"type": "MX", "name": D, "content": "mx.zoho.com"}]
        v = self.verdicts(existing)
        self.assertTrue(v[("TXT", D, "v=spf1 i")].startswith("refused"))
        self.assertTrue(v[("MX", D, "smtp.goo")].startswith("refused"))
        self.assertEqual(v[("TXT", "_dmarc." + D, "v=DMARC1")], "create")

    def test_a_hostname_already_in_use_is_left_alone(self):
        v = self.verdicts([{"type": "CNAME", "name": D, "content": "site.example.com"}], redirect="https://x.com")
        self.assertTrue(v[("A", D, "192.0.2.")].startswith("refused"))


class Status(unittest.TestCase):
    def test_missing_cli_says_install(self):
        with mock.patch.object(platforms, "run", return_value=(127, "cf not installed")):
            row = platforms.status(["cloudflare"])[0]
        self.assertEqual(row["state"], "missing")
        self.assertIn("npm install -g cf", row["fix"])

    def test_cloudflare_reads_the_email_after_a_banner(self):
        out = 'Using profile default\n{"authenticated": true, "email": "a@b.co", "accounts": []}\nextra'
        with mock.patch.object(platforms, "run", return_value=(0, out)):
            self.assertEqual(platforms.check_cloudflare(), ("ok", "a@b.co"))

    def test_signed_out_is_off_with_the_sign_in_step(self):
        with mock.patch.object(platforms, "run", return_value=(0, '{"authenticated": false}')):
            row = platforms.status(["cloudflare"])[0]
        self.assertEqual((row["state"], row["fix"]), ("off", platforms.BY_KEY["cloudflare"]["auth"]))

    def test_a_timeout_is_unknown_never_signed_out(self):
        with mock.patch.object(platforms, "run", return_value=(124, "timed out")):
            self.assertEqual(platforms.check_supabase()[0], "unknown")

    def test_keyed_platform_reads_env_without_printing_it(self):
        with mock.patch.dict(platforms.os.environ, {"PORKBUN_API_KEY": "pk1_secret"}):
            row = platforms.status(["porkbun"])[0]
        self.assertEqual(row["state"], "ok")
        self.assertNotIn("pk1_secret", str(row))


if __name__ == "__main__":
    unittest.main(verbosity=1)
