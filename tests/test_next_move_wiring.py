"""Every blocked path in the creator GTM chain emits a blocker record and asks gtme next-move,
for the made-up second client (Hearthside), with no network and nothing run on next-move's say.

  brand_buyer    the provider raising NotWired, or a credit-allowance refusal
  follow_buyers  a past buyer's job change with no reachable email
  spend_now      a brand with no dated creator-spend evidence
  deliver        a ledger post that fails, and a record stamp that fails after the post landed

Run: python3 -I tests/test_next_move_wiring.py
"""
import datetime as dt
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import test_creator_gtm_second_client as H  # noqa: E402
from test_creator_gtm_second_client import D, F, L, P, SN  # noqa: E402
from test_brand_buyer import fake_jev  # noqa: E402
import next_move as N  # noqa: E402


def says(cls):
    """Jev stand-in: noul 0.6 for progress, `cls` for any agent-move class question."""
    def evaluate(req):
        return {"answers": {q: ({"type": "choice", "choice": cls, "probabilities": {cls: 0.9}}
                                if spec["type"] == "choice" else {"type": "noul", "noul": 0.6})
                            for q, spec in req["questions"].items()}}
    return evaluate


class Wiring(H.SecondClientTest):
    # The parent's own tests run in their own file.
    test_whole_chain_for_a_second_client = None
    test_tools_name_no_client = None

    def setUp(self):
        super().setUp()
        self.saved_default = N.DEFAULT_EVALUATE
        N.DEFAULT_EVALUATE = says("read")

    def tearDown(self):
        N.DEFAULT_EVALUATE = self.saved_default
        super().tearDown()

    def blockers(self):
        path = os.path.join(self.tmp.name, "hearthside.blockers.jsonl")
        if not os.path.exists(path):
            return []
        with open(path) as f:
            return [json.loads(line) for line in f if line.strip()]

    def assert_fail_closed(self, rec):
        nxt = rec.get("next")
        self.assertTrue(nxt is None or nxt["action_class"] in ("read", "ask", "paid_write", "write"), rec)
        self.assertFalse(any(d["move"].startswith(("send", "launch", "delete")) for d in rec["ranked"]), rec)

    # ── brand_buyer: provider errors ──
    def test_provider_not_wired_is_a_blocker_not_a_crash(self):
        def unwired(self, ref, domain, filters=None):
            raise P.NotWired("fake provider: people_search is not wired yet")
        saved = H.FakeProvider.people_search
        H.FakeProvider.people_search = unwired
        try:
            log = self.buyer("Copperleaf Cookware", "copperleafcookware.com")
        finally:
            H.FakeProvider.people_search = saved
        self.assertIsNone(log["result"]["person"])
        self.assertEqual(log["result"]["blocked"]["step"], "provider_unwired")
        self.assertIn("not wired", log["result"]["reason"])
        recs = self.blockers()
        self.assertEqual([r["step"] for r in recs], ["provider_unwired"])
        self.assertEqual(recs[0]["client"], "hearthside")
        self.assertEqual(recs[0]["decision"], "ask", "nothing in the evidence to rerun, so a person decides")
        self.assertTrue(any("provider-down" in d["rules"] for d in recs[0]["dropped"]), recs[0]["dropped"])
        self.assert_fail_closed(recs[0])
        self.assertEqual(self.records()["copperleafcookware"]["contact"]["status"][:10], "Needs work")

    def test_credit_allowance_refusal_drops_every_paid_move(self):
        def broke(self, ref, domain, filters=None):
            raise L.ClayFailed("BLOCKED: ws_hearthside_demo has spent 50 of its 50-credit daily allowance today")
        saved = H.FakeProvider.people_search
        H.FakeProvider.people_search = broke
        try:
            log = self.buyer("Copperleaf Cookware", "copperleafcookware.com")
        finally:
            H.FakeProvider.people_search = saved
        rec = log["result"]["blocked"]
        self.assertEqual(rec["step"], "credit_budget")
        self.assertFalse(any(r["move"].startswith(("org_hop", "retry", "persona_swap", "loosen_filter"))
                             for r in rec["ranked"]), rec)

    def test_an_unrelated_failure_still_raises(self):
        def boom(self, ref, domain, filters=None):
            raise L.ClayFailed("people search: not JSON")
        saved = H.FakeProvider.people_search
        H.FakeProvider.people_search = boom
        try:
            with self.assertRaises(L.ClayFailed):
                self.buyer("Copperleaf Cookware", "copperleafcookware.com")
        finally:
            H.FakeProvider.people_search = saved

    # ── follow_buyers: no reachable email ──
    def test_past_buyer_with_no_reachable_email(self):
        saved = dict(H.EMAILS)
        H.EMAILS.pop(H.DANA_URL)
        try:
            L.jev_rank = fake_jev(H.SCORES)
            out = self.quiet(F.main, ["--client", self.path, "--live", "--only", "Dana Whitfield"])
        finally:
            H.EMAILS.clear()
            H.EMAILS.update(saved)
        dana = out[0]
        self.assertIn("needs work", dana["result"]["status"])
        self.assertIsNotNone(dana["result"]["next_move"])
        recs = [r for r in self.blockers() if r["step"] == "email_find"]
        self.assertEqual(len(recs), 1)
        self.assertIn("Dana Whitfield", recs[0]["failure"])
        # Kai is on the same team and untried: his email is on the list, next to free reads, and
        # nothing reaches out to anyone.
        self.assertIn("next_person:Kai Moreno", [r["move"] for r in recs[0]["ranked"]])
        self.assertIn(recs[0]["next"]["action_class"], ("read", "paid_write"))
        self.assert_fail_closed(recs[0])

    # ── spend_now: no evidence ──
    def test_brand_with_no_spend_evidence(self):
        cfg = SN.load_client(self.path)
        today = dt.date(2026, 10, 16)
        ev = SN.load_evidence(cfg)
        report = [(b, *SN.brand_result(ev, b, today, cfg)[::2]) for b in cfg["spend_now"]["brands"]]
        stuck = SN.blocked_brands(cfg, report, evaluate=says("read"))
        self.assertEqual(set(stuck), set(cfg["spend_now"]["brands"]), "no evidence at all: every brand is blocked")
        rec = stuck["Saltmarsh Pantry"]
        self.assertEqual(rec["step"], "spend_evidence")
        self.assertEqual(rec["next"]["action_class"], "read", "a free read of the brand's own pages goes first")
        self.assertEqual(len([r for r in self.blockers() if r["step"] == "spend_evidence"]), 3)
        self.assert_fail_closed(rec)

    def test_brand_with_evidence_is_not_blocked(self):
        cfg = SN.load_client(self.path)
        today = dt.date(2026, 10, 16)
        item = SN.validate_item(cfg, {"brand": "Ember and Oak Grills", "kind": "launch", "date": "2026-09-20",
                                      "url": "https://emberandoak.test/launch", "text": "launch with paid creators"}, today)
        SN.append_evidence(cfg, [item])
        SN.check(cfg, today, jev=H.spend_jev)
        ev = SN.load_evidence(cfg)
        report = [(b, *SN.brand_result(ev, b, today, cfg)[::2]) for b in cfg["spend_now"]["brands"]]
        self.assertNotIn("Ember and Oak Grills", SN.blocked_brands(cfg, report, evaluate=says("read")))

    # ── deliver: a failed write ──
    def handed_records(self):
        L.jev_rank = fake_jev(H.SCORES)
        self.buyer("Copperleaf Cookware", "copperleafcookware.com")
        self.buyer("Ember and Oak Grills", "emberandoakgrills.com")
        with open(self.path) as f:
            return json.load(f)

    def test_failed_ledger_post_is_blocked_and_the_batch_goes_on(self):
        cfg = self.handed_records()
        posted = []

        def flaky(p):
            if p["brand"] == "Copperleaf Cookware":
                raise ConnectionError("ledger timed out")
            posted.append(p["brand"])
            return {"delivered_on": "2026-10-16", "delivered_for": p["delivered_for"], "seq": 1, "hash": "a" * 64}, True

        report = D.deliver_records(cfg, D.records_path(cfg, self.path), True, flaky)
        self.assertEqual(posted, ["Ember and Oak Grills"])
        self.assertEqual([b["brand"] for b in report["blocked"]], ["Copperleaf Cookware"])
        rec = [r for r in self.blockers() if r["step"] == "deliver_write"][0]
        self.assertIn("ledger timed out", rec["failure"])
        self.assertIn(rec["decision"], ("run", "ask"))
        self.assertNotIn("delivered", self.records()["copperleafcookware"], "nothing is stamped that didn't land")
        self.assert_fail_closed(rec)

    def test_ledger_refusal_does_not_kill_the_batch(self):
        """deliver.Failed is a SystemExit; a refusal for one brand used to end the whole run."""
        cfg = self.handed_records()

        def refuse(p):
            if p["brand"] == "Copperleaf Cookware":
                raise D.Failed("ledger refused Copperleaf Cookware: duplicate")
            return {"delivered_on": "2026-10-16", "delivered_for": p["delivered_for"], "seq": 3, "hash": "d" * 64}, True

        report = D.deliver_records(cfg, D.records_path(cfg, self.path), True, refuse)
        self.assertEqual([b["brand"] for b in report["blocked"]], ["Copperleaf Cookware"])
        self.assertEqual([r["brand"] for r in report["recorded"]], ["Ember and Oak Grills"])

    def test_stamp_failure_after_a_landed_post_says_the_ledger_has_it(self):
        cfg = self.handed_records()
        import provider as PV
        real = PV.save_record

        def no_stamp(path, key, record):
            if "delivered" in record:
                raise OSError("disk full")
            return real(path, key, record)

        PV.save_record = no_stamp
        try:
            report = D.deliver_records(cfg, D.records_path(cfg, self.path), True,
                                       lambda p: ({"delivered_on": "2026-10-16", "delivered_for": p["delivered_for"],
                                                   "seq": 7, "hash": "b" * 64}, True))
        finally:
            PV.save_record = real
        self.assertEqual(len(report["blocked"]), 2)
        self.assertTrue(all(b["ledger"] == 7 for b in report["blocked"]))
        self.assertTrue(all("ledger has it as #7" in r["failure"] for r in self.blockers() if r["step"] == "deliver_write"))


if __name__ == "__main__":
    unittest.main()
