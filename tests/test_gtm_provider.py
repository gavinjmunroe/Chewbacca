"""The creator GTM provider contract: the brand buyer chain runs end to end with no Clay at all.

A fake provider stands in for the vendor and clay() is replaced by a tripwire, so any Clay call
fails the test. Run: python3 -I tests/test_gtm_provider.py
"""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from test_brand_buyer import ROW, FakeClay, _Base, fake_jev, person  # noqa: E402
import brand_buyer as L  # noqa: E402
from creator_gtm import provider as P  # noqa: E402


def no_clay(op, *a, **kw):
    raise AssertionError(f"Clay was called ({op}) on a non-Clay provider")


def fake_provider(people_by_domain, email_by_url=None, verdict_by_email=None):
    """A provider class with canned answers; each call costs a made-up number of cents."""
    class Fake(P.Provider):
        name, label = "fake", "Fake"
        calls = []

        def people_search(self, ref, domain, filters=None):
            self.calls.append(("people_search", ref, domain))
            self.record("people_search", cents=1.0)
            return list(people_by_domain.get(domain, []))

        def find_email(self, ref, person):
            self.calls.append(("find_email", ref, person["url"]))
            self.record("find_email", cents=0.5)
            return (email_by_url or {}).get(person["url"])

        def verify_email(self, ref, email):
            self.calls.append(("verify_email", ref, email))
            self.record("verify_email", cents=0.2)
            return (verdict_by_email or {}).get(email, "valid")
    return Fake


class _ProviderBase(_Base):
    def setUp(self):
        super().setUp()
        self.saved_providers = dict(P.PROVIDERS)

    def tearDown(self):
        P.PROVIDERS.clear()
        P.PROVIDERS.update(self.saved_providers)
        super().tearDown()

    def client(self, **cfg):
        path = os.path.join(self.tmp.name, "acme.json")
        with open(path, "w") as f:
            json.dump({"client_slug": "acme", "creator": "Mia Run (Mia Runs)",
                       "records": "acme.records.json"} | cfg, f)
        return path

    def records(self):
        return P.load_records(os.path.join(self.tmp.name, "acme.records.json"))["brands"]

    def run_main(self, argv, scores):
        L.jev_rank = fake_jev(scores)
        with open(os.devnull, "w") as null:
            out, err = sys.stdout, sys.stderr
            sys.stdout = sys.stderr = null
            try:
                return L.main(argv)
            finally:
                sys.stdout, sys.stderr = out, err


class FakeProviderChainTest(_ProviderBase):
    def test_brand_buyer_chain_end_to_end_without_clay(self):
        """Barebells: empty brand search, next-move hops to the parent, pick, find, verify, record."""
        scout = person("Scout Brown", "US Partnerships Lead")
        P.PROVIDERS["fake"] = fake_provider({"barebells.com": [], "vitaminwell.com": [scout]},
                                            {scout["url"]: "scout.brown@vitaminwell.com"})
        L.clay = no_clay
        log = self.run_main(["Barebells", "barebells.com", "--live", "--client", self.client(provider="fake")],
                            {"Scout Brown": 1.9})
        self.assertEqual(log["provider"], "fake")
        self.assertEqual(log["result"]["email"], "scout.brown@vitaminwell.com")
        self.assertEqual(log["result"]["status"], "Ready")
        self.assertEqual([c[0] for c in L.prov().calls],
                         ["people_search", "people_search", "find_email", "verify_email"])
        self.assertEqual(L.prov().calls[1][2], "vitaminwell.com")
        rec = self.records()["barebells"]
        self.assertEqual(rec["provider"], "fake")
        self.assertEqual(rec["contact"]["email"], "scout.brown@vitaminwell.com")
        self.assertIn("parent vitaminwell.com", rec["contact"]["why"])
        self.assertEqual(rec["candidates"], [["Scout Brown", "US Partnerships Lead"]])
        self.assertEqual(log["cost"], {"credits": None, "cents": 2.7})

    def test_retry_and_stop_logic_is_the_same_off_clay(self):
        first = person("Ann First", "Influencer Marketing Manager")
        second = person("Ben Second", "Brand Partnerships Director")
        P.PROVIDERS["fake"] = fake_provider({"asics.com": [first, second]},
                                            {first["url"]: "ann@asics.com", second["url"]: "ben@asics.com"},
                                            {"ann@asics.com": "invalid"})
        L.clay = no_clay
        log = self.run_main(["ASICS", "asics.com", "--live", "--client", self.client(provider="fake")],
                            {"Ann First": 1.8, "Ben Second": 1.5})
        self.assertEqual(log["result"]["person"], "Ben Second")
        self.assertIn("after Ann First's email came back invalid", self.records()["asics"]["contact"]["why"])

    def test_no_pick_is_recorded_with_its_reason(self):
        P.PROVIDERS["fake"] = fake_provider({"gymshark.com": []})
        L.clay = no_clay
        self.run_main(["Gymshark", "gymshark.com", "--live", "--client", self.client(provider="fake")], {})
        rec = self.records()["gymshark"]
        self.assertIsNone(rec["contact"]["person"])
        self.assertTrue(rec["contact"]["status"].startswith("Needs work: no people at gymshark.com"))

    def test_dry_run_spends_nothing(self):
        P.PROVIDERS["fake"] = fake_provider({"klarna.com": [person("Jina Lee", "Social Lead")]})
        L.clay = no_clay
        self.run_main(["Klarna", "klarna.com", "--client", self.client(provider="fake")], {})
        self.assertEqual(L.prov().calls, [])

    def test_setup_refuses_without_a_table(self):
        P.PROVIDERS["fake"] = fake_provider({})
        L.clay = no_clay
        with self.assertRaises(SystemExit) as e:
            self.run_main(["--setup", "--client", self.client(provider="fake")], {})
        self.assertIn("fake provider has none", str(e.exception))


class ClayAdapterTest(_ProviderBase):
    def test_clay_is_the_default_and_records_credits_and_cents_per_call(self):
        lead = person("John Kevane", "Athlete & Community Partnerships")
        fake = FakeClay({"strava.com": [lead]}, email_by_url={lead["url"]: "jkevane@strava.com"})
        L.clay = fake
        log = self.run_main(["Strava", "strava.com", "--live", "--client",
                             self.client(provider={"name": "clay", "cents_per_credit": 2.0})], {"John Kevane": 2.0})
        self.assertEqual(log["provider"], "clay")
        self.assertEqual([(c["op"], c["credits"], c["cents"]) for c in log["costs"]],
                         [("people_search", 0.5, 1.0), ("find_email", 0.5, 1.0), ("verify_email", 0.1, 0.2)])
        self.assertAlmostEqual(log["credits_observed"], 1.1)
        rec = self.records()["strava"]
        self.assertEqual((rec["provider"], rec["view_row"]), ("clay", ROW))
        self.assertEqual(rec["contact"]["email"], "jkevane@strava.com")
        # The view holds what the record holds.
        status_id = fake.added["Status"]
        self.assertEqual(fake.value(status_id), rec["contact"]["status"])

    def test_reused_row_searches_the_brand_not_the_last_hop(self):
        """A rerun on a row a past hop left at the parent searches the brand's own domain first."""
        lead = person("Bea Brand", "Influencer Partnerships Lead")
        fake = FakeClay({"barebells.com": [lead]}, email_by_url={lead["url"]: "bea@barebells.com"})
        fake.cells[L.F_DOMAIN] = {"status": "success", "value": "vitaminwell.com"}
        L.clay = fake
        log = self.run_main(["Barebells", "barebells.com", "--live", "--row", ROW, "--client", self.client()],
                            {"Bea Brand": 1.8})
        self.assertEqual(log["result"]["email"], "bea@barebells.com")
        self.assertEqual(log["result"]["status"], "Ready")

    def test_cents_stay_unknown_without_a_rate(self):
        lead = person("John Kevane", "Athlete & Community Partnerships")
        L.clay = FakeClay({"strava.com": [lead]}, email_by_url={lead["url"]: "jkevane@strava.com"})
        log = self.run_main(["Strava", "strava.com", "--live", "--client", self.client()], {"John Kevane": 2.0})
        self.assertEqual(log["cost"], {"credits": 1.1, "cents": None})


class TregStubTest(_ProviderBase):
    def test_treg_run_lands_as_blocked_before_any_spend(self):
        # Since 6b478168 a NotWired step becomes a blocker record and a next-move pick, not a raise.
        L.clay = no_clay
        log = self.run_main(["Strava", "strava.com", "--live", "--client", self.client(provider="treg")], {})
        self.assertIsNone(log["result"]["person"])
        self.assertEqual(log["result"]["blocked"]["step"], "provider_unwired")
        self.assertIn("treg provider: people_search is not wired yet", json.dumps(log["result"]["blocked"]))
        self.assertEqual(log["costs"], [])

    def test_every_paid_step_is_unwired_and_job_boards_still_read(self):
        t = P.for_client({"provider": "treg"})
        for call in (lambda: t.people_search("r", "x.com"), lambda: t.find_email("r", {"url": "u"}),
                     lambda: t.verify_email("r", "a@x.com"), lambda: t.person_posts({"url": "u"})):
            with self.assertRaises(P.NotWired):
                call()
        jobs = t.company_signals({"ats": {"greenhouse": "acme"}}, fetch=lambda url: {"jobs": [
            {"first_published": "2026-10-01", "title": "Creator Partnerships Lead",
             "location": {"name": "LA"}, "absolute_url": "https://x/1"}]})
        self.assertEqual(jobs[0]["title"], "Creator Partnerships Lead")
        self.assertEqual(t.costs[-1]["cents"], 0.0)

    def test_unknown_provider_names_the_known_ones(self):
        with self.assertRaises(P.NotWired) as e:
            P.for_client({"provider": "apollo"})
        self.assertIn("clay", str(e.exception))


if __name__ == "__main__":
    unittest.main()
