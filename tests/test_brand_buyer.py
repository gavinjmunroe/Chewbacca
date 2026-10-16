"""Unit tests for live_chain.py with a fake clay() and a fake Jev. Nothing reaches Clay or Jev.

Run: python3 -I tests/test_brand_buyer.py
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import brand_buyer as L  # noqa: E402

# Placeholder ids for a fake table; real ones come from a client file.
L.WS, L.TABLE, L.VIEW, L.CLIENT_VIEW, L.CREATOR = "1", "t_faketable", "gv_fakeall", "gv_fakeclient", "Noah Rolette (Rawdawg Run Club)"
(L.F_BRAND, L.F_DOMAIN, L.F_CREATOR, L.F_PEOPLE, L.F_PROFILE, L.F_FINDYMAIL, L.F_VERIFY) = (
    "f_brand", "f_domain", "f_creator", "f_people", "f_profile", "f_findymail", "f_verify")

ROW = "r_0tmzfaketestrow00001"
WHY = "f_0tmzwhyfakefield0001"


def person(name, title, url=None, headline=""):
    return {"name": name, "title": title, "headline": headline,
            "url": url or f"https://www.linkedin.com/in/{name.lower().replace(' ', '-')}/"}


class FakeClay:
    """A one-row Clay table. Each run-cells shows the cell as running once, then the result."""

    def __init__(self, people_by_domain, email_by_url=None, verdict_by_email=None, why_exists=False):
        self.people_by_domain = people_by_domain
        self.email_by_url = email_by_url or {}
        self.verdict_by_email = verdict_by_email or {}
        self.cells = {}
        self.stamp = 0
        self.pending = {}
        self.calls = []
        self.balance = 100.0
        self.why_exists = why_exists
        self.limit = '"2"'
        self.added = {}

    def column_list(self):
        cols = [{"id": L.F_PEOPLE, "name": "Find contacts at company",
                 "typeSettings": {"inputsBinding": [{"name": "limit", "formulaText": self.limit}]}}]
        if self.why_exists:
            cols.append({"id": WHY, "name": L.WHY_COLUMN})
        cols += [{"id": fid, "name": name} for name, fid in self.added.items()]
        return cols

    def value(self, field):
        return self.cells.get(field, {}).get("value")

    def __call__(self, op, live, **kw):
        self.calls.append((op, live, kw))
        if op == "credits":
            return {"ok": True, "data": {"balance": self.balance}}
        if op == "columns":
            return {"ok": True, "data": self.column_list()}
        if op == "add-column":
            if kw["name"] == L.WHY_COLUMN:
                self.why_exists = True
            else:
                self.added[kw["name"]] = f"f_0tmzfake{kw['name'].lower()}0001"
            return {"ok": True}
        if op == "update-column":
            ts = json.loads(kw["update"])["typeSettings"]
            self.limit = ts["inputsBinding"][0]["formulaText"]
            return {"ok": True}
        if op == "view-columns":
            return {"ok": True}
        if op == "add-rows":
            for k, v in json.loads(kw["records"])[0].items():
                self.cells[k] = {"status": "success", "value": v}
            self.stamp += 1
            return {"ok": True, "data": {"records": [{"id": ROW}]}, "_ms": 5}
        if op == "update-rows":
            for k, v in json.loads(kw["records"])[0]["cells"].items():
                self.cells[k] = {"status": "success", "value": v}
            self.stamp += 1
            return {"ok": True}
        if op == "run-cells":
            # Like Clay on the Strava rerun: the first read still shows the old cell, the
            # second shows it running, the third has this run's result.
            field = kw["fields"]
            self.pending[field] = [None, {"status": "running"}, self.result(field)]
            return {"ok": True}
        if op == "row":
            for field, steps in list(self.pending.items()):
                step = steps.pop(0)
                if step is not None:
                    self.cells[field] = step
                if not steps:
                    self.stamp += 1
                    del self.pending[field]
            return {"ok": True, "data": {"id": ROW, "updatedAt": str(self.stamp), "cells": dict(self.cells)}}
        raise AssertionError(f"unexpected op {op}")

    def result(self, field):
        if field == L.F_PEOPLE:
            self.balance -= 0.5
            people = self.people_by_domain.get(self.value(L.F_DOMAIN), [])
            return {"status": "success", "fields": {"people": people, "peopleCount": len(people)}}
        if field == L.F_FINDYMAIL:
            self.balance -= 0.5
            return {"status": "success", "fields": {"email": self.email_by_url.get(self.value(L.F_PROFILE))}}
        if field == L.F_VERIFY:
            self.balance -= 0.1
            email = self.cells[L.F_FINDYMAIL]["fields"]["email"]
            return {"status": "success", "fields": {"status": self.verdict_by_email.get(email, "valid")}}
        raise AssertionError(field)

    def ops(self, name):
        return [c for c in self.calls if c[0] == name]


SITES = {"barebells.com": json.load(open(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "fixtures", "next_move", "barebells_home_excerpt.json")))}


def likes_career_site(req):
    """Jev stand-in for the next-move loop: rates highest the move that cites the careers site."""
    return {"answers": {q: {"type": "noul", "noul": 0.9 if "career.vitaminwell" in spec["instructions"] else 0.3}
                        for q, spec in req["questions"].items()}}


def fake_jev(scores, gate=True):
    def rank(people):
        s = [scores[p["name"]] for p in people]
        return sorted(range(len(people)), key=lambda i: -s[i]), s, gate
    return rank


class _Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = (L.clay, L.jev_rank, L.SITE_READ, L.RUN_LOG, L.time.sleep)
        self.saved_next = (L.NEXT_MOVE_JEV, L.NEXT_MOVE_LEDGER)
        # The empty-search loop reads the brand's site; tests hand it the saved Barebells footer
        # or nothing, and a Jev stand-in, and keep its lessons out of the real ledger.
        L.SITE_READ = lambda domain: SITES.get(domain, {"site_text": "", "links": []})
        L.NEXT_MOVE_JEV = likes_career_site
        L.NEXT_MOVE_LEDGER = os.path.join(self.tmp.name, "lessons")
        L.RUN_LOG = os.path.join(self.tmp.name, "runs.jsonl")
        self.saved_rows_file = L.ROWS_FILE
        self.saved_globals = {k: getattr(L, k) for k in list(L.ROLES.values()) + [
            "WS", "TABLE", "VIEW", "CLIENT_VIEW", "CREATOR", "PEOPLE_SEARCH", "CLIENT_FILE", "RUN_LOG"]}
        L.CLIENT_FILE = os.path.join(self.tmp.name, "minimal-client.json")
        with open(L.CLIENT_FILE, "w") as f:
            json.dump({}, f)
        L.ROWS_FILE = os.path.join(self.tmp.name, "rows.json")
        L.time.sleep = lambda s: None

    def tearDown(self):
        L.clay, L.jev_rank, L.SITE_READ, L.RUN_LOG, L.time.sleep = self.saved
        L.NEXT_MOVE_JEV, L.NEXT_MOVE_LEDGER = self.saved_next
        L.ROWS_FILE = self.saved_rows_file
        for k, v in self.saved_globals.items():
            setattr(L, k, v)
        self.tmp.cleanup()

    def run_chain(self, fake, brand, domain, scores, gate=True, argv=()):
        L.clay, L.jev_rank = fake, fake_jev(scores, gate)
        with open(os.devnull, "w") as null:
            out, err = sys.stdout, sys.stderr
            sys.stdout = sys.stderr = null
            try:
                return L.main([brand, domain, "--live", *argv])
            finally:
                sys.stdout, sys.stderr = out, err


class ChainTest(_Base):
    def test_parent_fallback_reruns_on_parent_domain(self):
        """No parents file: the parent comes from barebells.com's own footer through gtme next-move."""
        scout = person("Scout Brown", "US Partnerships Lead")
        fake = FakeClay({"barebells.com": [], "vitaminwell.com": [scout]},
                        email_by_url={scout["url"]: "scout.brown@vitaminwell.com"})
        log = self.run_chain(fake, "Barebells", "barebells.com", {"Scout Brown": 1.9})
        self.assertEqual(fake.value(L.F_DOMAIN), "vitaminwell.com")
        self.assertEqual(len([c for c in fake.ops("run-cells") if c[2]["fields"] == L.F_PEOPLE]), 2)
        hop = next(s for s in log["steps"] if s["step"] == "parent fallback")
        self.assertEqual((hop["from"], hop["to"]), ("barebells.com", "vitaminwell.com"))
        self.assertIn("part of Vitamin Well Group", hop["why"])
        self.assertEqual(next(s for s in log["steps"] if s["step"] == "next move")["decision"], "cleared")
        self.assertEqual(log["result"]["email"], "scout.brown@vitaminwell.com")
        self.assertIn("parent vitaminwell.com, after barebells.com returned no one", fake.value(WHY))
        self.assertAlmostEqual(log["credits_observed"], 1.6)

    def test_no_parent_on_file_stops_without_email_spend(self):
        fake = FakeClay({"gymshark.com": []})
        log = self.run_chain(fake, "Gymshark", "gymshark.com", {})
        self.assertIsNone(log["result"]["person"])
        self.assertFalse([c for c in fake.ops("run-cells") if c[2]["fields"] == L.F_FINDYMAIL])

    def test_ranking_picks_top_score_and_writes_reason(self):
        creator = person("Chase Dinkel", "Content Creator")
        lead = person("Jina Lee", "Global Social Strategist")
        fake = FakeClay({"klarna.com": [creator, lead]}, email_by_url={lead["url"]: "jina.lee@klarna.com"})
        log = self.run_chain(fake, "Klarna", "klarna.com", {"Chase Dinkel": 0.1, "Jina Lee": 1.7})
        self.assertEqual(log["result"]["person"], "Jina Lee")
        self.assertEqual(fake.value(L.F_PROFILE), lead["url"])
        why = fake.value(WHY)
        self.assertTrue(why.startswith("Jina Lee (Global Social Strategist) at klarna.com"))
        self.assertIn("1.7 of 2", why)
        self.assertIn("ahead of Chase Dinkel at 0.1", why)
        self.assertTrue(why.endswith(".") and ". " not in why, why)  # one sentence

    def test_low_top_score_stops_even_when_jev_names_someone(self):
        mentor = person("Kayla Wright", "Mentor")
        fake = FakeClay({"celsius.com": [mentor]})
        log = self.run_chain(fake, "Celsius", "celsius.com", {"Kayla Wright": 0.03}, gate=True)
        self.assertIsNone(log["result"]["person"])
        self.assertFalse([c for c in fake.ops("run-cells") if c[2]["fields"] == L.F_FINDYMAIL])

    def test_status_and_contact_ready_only_when_email_on_brand(self):
        lead = person("Alexa Kinoshita", "Influencer Marketing Associate")
        fake = FakeClay({"gymshark.com": [lead]}, email_by_url={lead["url"]: "alexa.kinoshita@gymshark.com"})
        self.run_chain(fake, "Gymshark", "gymshark.com", {"Alexa Kinoshita": 1.4})
        self.assertEqual(fake.value(fake.added["Status"]), "Ready")
        self.assertTrue(fake.value(fake.added["Contact"]).startswith(
            "Alexa Kinoshita, Influencer Marketing Associate, alexa.kinoshita@gymshark.com. Alexa Kinoshita ("))

    def test_off_domain_reads_needs_work(self):
        ambassador = person("Ryan Shaw", "Social Media Ambassador")
        fake = FakeClay({"gymshark.com": [ambassador]}, email_by_url={ambassador["url"]: "ryan@buckedup.com"})
        self.run_chain(fake, "Gymshark", "gymshark.com", {"Ryan Shaw": 1.1})
        self.assertEqual(fake.value(fake.added["Status"]), "Needs work: off-domain buckedup.com")

    def test_stop_reads_needs_work(self):
        fake = FakeClay({"gymshark.com": []})
        self.run_chain(fake, "Gymshark", "gymshark.com", {})
        self.assertTrue(fake.value(fake.added["Status"]).startswith("Needs work: no people at gymshark.com"))

    def test_second_run_reuses_the_brands_row(self):
        lead = person("John Kevane", "Athlete & Community Partnerships")
        fake = FakeClay({"strava.com": [lead]}, email_by_url={lead["url"]: "jkevane@strava.com"})
        self.run_chain(fake, "Strava", "strava.com", {"John Kevane": 2.0})
        self.run_chain(fake, "Strava", "strava.com", {"John Kevane": 2.0})
        self.assertEqual(len(fake.ops("add-rows")), 1)
        self.assertEqual(L.load_rows(), {"strava": ROW})

    def test_why_column_created_when_missing(self):
        lead = person("John Kevane", "Athlete & Community Partnerships")
        fake = FakeClay({"strava.com": [lead]}, email_by_url={lead["url"]: "jkevane@strava.com"})
        self.run_chain(fake, "Strava", "strava.com", {"John Kevane": 2.0})
        add = fake.ops("add-column")
        self.assertEqual(sorted(c[2]["name"] for c in add),
                         sorted(["Person", "Title", "Status", "Contact", L.WHY_COLUMN]))
        self.assertTrue(all(c[2]["data_type"] == "text" for c in add))
        self.assertIn("the only candidate", fake.value(WHY))
        self.assertEqual(fake.value(fake.added["Person"]), "John Kevane")
        self.assertEqual(fake.value(fake.added["Title"]), "Athlete & Community Partnerships")

    def test_jev_none_stops_before_findymail(self):
        agent = person("Pat Realtor", "Real Estate Agent")
        fake = FakeClay({"asics.com": [agent]})
        log = self.run_chain(fake, "ASICS", "asics.com", {"Pat Realtor": 0.0}, gate=False)
        self.assertIsNone(log["result"]["person"])
        self.assertFalse([c for c in fake.ops("run-cells") if c[2]["fields"] == L.F_FINDYMAIL])
        self.assertEqual(fake.value(WHY), "No one picked: Jev found no creator buyer; no email spend; "
                                          "the search returned Pat Realtor (Real Estate Agent).")

    def test_invalid_retries_runner_up_once(self):
        first = person("Ann First", "Influencer Marketing Manager")
        second = person("Ben Second", "Brand Partnerships Director")
        fake = FakeClay({"asics.com": [first, second]},
                        email_by_url={first["url"]: "ann@asics.com", second["url"]: "ben@asics.com"},
                        verdict_by_email={"ann@asics.com": "invalid"})
        log = self.run_chain(fake, "ASICS", "asics.com", {"Ann First": 1.8, "Ben Second": 1.5})
        self.assertEqual(log["result"]["person"], "Ben Second")
        self.assertEqual(log["result"]["zerobounce"], "valid")
        self.assertEqual(len([c for c in fake.ops("run-cells") if c[2]["fields"] == L.F_FINDYMAIL]), 2)
        self.assertIn("after Ann First's email came back invalid", fake.value(WHY))

    def test_off_domain_email_retries_runner_up(self):
        ambassador = person("Ryan Shaw", "Social Media Ambassador")
        lead = person("Gia Lead", "Influencer Partnerships Manager")
        fake = FakeClay({"gymshark.com": [ambassador, lead]},
                        email_by_url={ambassador["url"]: "ryan@buckedup.com", lead["url"]: "gia@us.gymshark.com"})
        log = self.run_chain(fake, "Gymshark", "gymshark.com", {"Ryan Shaw": 1.1, "Gia Lead": 1.0})
        self.assertEqual(log["result"]["person"], "Gia Lead")
        self.assertIn("Ryan Shaw's email was at buckedup.com, not the brand", fake.value(WHY))

    def test_no_email_retries_runner_up(self):
        top = person("Brenna Tanner", "Influencer Marketing Manager")
        second = person("Ava Paszkiewicz", "Influencer Marketing Coordinator")
        fake = FakeClay({"celsius.com": [top, second]}, email_by_url={second["url"]: "ava@celsius.com"})
        log = self.run_chain(fake, "Celsius", "celsius.com", {"Brenna Tanner": 2.0, "Ava Paszkiewicz": 1.55})
        self.assertEqual(log["result"]["email"], "ava@celsius.com")
        self.assertIn("after Brenna Tanner had no email Findymail could find", fake.value(WHY))
        self.assertNotIn("ahead of Brenna Tanner", fake.value(WHY))

    def test_off_domain_with_no_runner_up_says_do_not_use(self):
        ambassador = person("Ryan Shaw", "Social Media Ambassador")
        fake = FakeClay({"gymshark.com": [ambassador]}, email_by_url={ambassador["url"]: "ryan@buckedup.com"})
        self.run_chain(fake, "Gymshark", "gymshark.com", {"Ryan Shaw": 1.1})
        self.assertIn("buckedup.com, not the brand, so do not use it", fake.value(WHY))

    def test_catch_all_at_brand_retries_and_never_reads_verified(self):
        first = person("Ann First", "Influencer Marketing Manager")
        second = person("Ben Second", "Brand Partnerships Director")
        fake = FakeClay({"asics.com": [first, second]},
                        email_by_url={first["url"]: "ann@asics.com", second["url"]: "ben@asics.com"},
                        verdict_by_email={"ann@asics.com": "catch-all"})
        log = self.run_chain(fake, "ASICS", "asics.com", {"Ann First": 1.8, "Ben Second": 1.5})
        self.assertEqual(log["result"]["person"], "Ben Second")
        self.assertEqual(fake.value(fake.added["Status"]), "Ready")
        self.assertIn("after Ann First's email was catch-all, not verified", fake.value(WHY))

    def test_catch_all_kept_when_runner_up_is_no_better(self):
        first = person("Ann First", "Influencer Marketing Manager")
        second = person("Ben Second", "Brand Partnerships Director")
        fake = FakeClay({"asics.com": [first, second]}, email_by_url={first["url"]: "ann@asics.com"},
                        verdict_by_email={"ann@asics.com": "catch-all"})
        log = self.run_chain(fake, "ASICS", "asics.com", {"Ann First": 1.8, "Ben Second": 1.5})
        self.assertEqual(log["result"]["email"], "ann@asics.com")
        self.assertEqual(fake.value(fake.added["Status"]), "catch-all, unverified, send after the valid ones")
        self.assertIn("ann@asics.com", fake.value(fake.added["Contact"]))

    def test_unknown_verdict_is_not_ready(self):
        lead = person("Cy Third", "Head of Social")
        fake = FakeClay({"asics.com": [lead]}, email_by_url={lead["url"]: "cy@asics.com"},
                        verdict_by_email={"cy@asics.com": "unknown"})
        self.run_chain(fake, "ASICS", "asics.com", {"Cy Third": 1.4})
        self.assertNotEqual(fake.value(fake.added["Status"]), "Ready")

    def test_invalid_twice_stops_after_one_retry(self):
        first = person("Ann First", "Influencer Marketing Manager")
        second = person("Ben Second", "Brand Partnerships Director")
        third = person("Cy Third", "Head of Social")
        fake = FakeClay({"asics.com": [first, second, third]},
                        email_by_url={p["url"]: f"{p['name'].split()[0].lower()}@asics.com" for p in (first, second, third)},
                        verdict_by_email={"ann@asics.com": "invalid", "ben@asics.com": "invalid"})
        log = self.run_chain(fake, "ASICS", "asics.com", {"Ann First": 1.8, "Ben Second": 1.5, "Cy Third": 1.4})
        self.assertEqual(len([c for c in fake.ops("run-cells") if c[2]["fields"] == L.F_FINDYMAIL]), 2)
        self.assertEqual(log["result"]["zerobounce"], "invalid")
        self.assertIn("also invalid, so the chain stopped", fake.value(WHY))

    def test_invalid_with_weak_runner_up_does_not_retry(self):
        first = person("Ann First", "Influencer Marketing Manager")
        creator = person("Chase Dinkel", "Content Creator")
        fake = FakeClay({"asics.com": [first, creator]}, email_by_url={first["url"]: "ann@asics.com"},
                        verdict_by_email={"ann@asics.com": "invalid"})
        log = self.run_chain(fake, "ASICS", "asics.com", {"Ann First": 1.8, "Chase Dinkel": 0.2})
        self.assertEqual(len([c for c in fake.ops("run-cells") if c[2]["fields"] == L.F_FINDYMAIL]), 1)
        self.assertTrue(any(s.get("skipped") for s in log["steps"] if s["step"] == "retry"))

    def test_every_write_carries_live_flag(self):
        lead = person("John Kevane", "Athlete & Community Partnerships")
        fake = FakeClay({"strava.com": [lead]}, email_by_url={lead["url"]: "jkevane@strava.com"})
        self.run_chain(fake, "Strava", "strava.com", {"John Kevane": 2.0})
        for op, live, _ in fake.calls:
            if op in ("add-rows", "update-rows", "run-cells", "update-column", "add-column"):
                self.assertTrue(live, op)

    def test_credits_logged_to_run_log(self):
        lead = person("John Kevane", "Athlete & Community Partnerships")
        fake = FakeClay({"strava.com": [lead]}, email_by_url={lead["url"]: "jkevane@strava.com"})
        self.run_chain(fake, "Strava", "strava.com", {"John Kevane": 2.0})
        with open(L.RUN_LOG) as f:
            entry = json.loads(f.readline())
        self.assertEqual(entry["brand"], "Strava")
        self.assertAlmostEqual(entry["credits_observed"], 1.1)

    def test_people_limit_flag_sets_column_and_refuses_over_cap(self):
        lead = person("John Kevane", "Athlete & Community Partnerships")
        fake = FakeClay({"strava.com": [lead]}, email_by_url={lead["url"]: "jkevane@strava.com"})
        self.run_chain(fake, "Strava", "strava.com", {"John Kevane": 2.0}, argv=["--people-limit", "3"])
        self.assertEqual(fake.limit, '"3"')
        with self.assertRaises(SystemExit):
            self.run_chain(FakeClay({}), "Strava", "strava.com", {}, argv=["--people-limit", "11"])

    def test_stale_success_cell_is_not_read_as_this_run(self):
        # The row already holds a success people cell from an earlier run; the chain must
        # wait for the new run instead of returning those people.
        old = person("Old Person", "Former Partnerships Lead")
        new = person("New Person", "Creator Partnerships Lead")
        fake = FakeClay({"strava.com": [new]}, email_by_url={new["url"]: "new@strava.com"}, why_exists=True)
        fake.cells[L.F_PEOPLE] = {"status": "success", "fields": {"people": [old]}}
        fake.cells[L.F_DOMAIN] = {"status": "success", "value": "strava.com"}
        L.clay = fake
        state, _ = L.run_and_wait(L.F_PEOPLE, ROW)
        self.assertEqual(state["fields"]["people"][0]["name"], "New Person")


class ClientConfigTest(_Base):
    """A second client needs only a client.json: columns are found by name."""

    def client(self, **extra):
        path = os.path.join(self.tmp.name, "client.json")
        cfg = {"ws": "42", "table": "t_other", "client_view": "gv_client", "creator": "Mia Run (Mia Runs)",
               "columns": {"brand": "Brand", "people": "Find contacts at company"}} | extra
        with open(path, "w") as f:
            json.dump(cfg, f)
        return path

    def test_columns_resolve_by_name_and_creator_comes_from_client(self):
        fake = FakeClay({"strava.com": []})
        fake.column_list = lambda: [{"id": "f_newbrand", "name": "Brand"},
                                    {"id": L.F_PEOPLE, "name": "Find contacts at company",
                                     "typeSettings": {"inputsBinding": [{"name": "limit", "formulaText": '"2"'}]}},
                                    {"id": WHY, "name": L.WHY_COLUMN}]
        L.clay, L.jev_rank = fake, fake_jev({})
        with open(os.devnull, "w") as null:
            out = sys.stdout
            sys.stdout = null
            try:
                L.main(["Strava", "strava.com", "--client", self.client()])
            finally:
                sys.stdout = out
        self.assertEqual((L.WS, L.TABLE, L.F_BRAND), ("42", "t_other", "f_newbrand"))
        add = fake.ops("add-rows")[0]
        self.assertEqual(add[2]["table"], "t_other")
        self.assertEqual(json.loads(add[2]["records"])[0]["f_newbrand"], "Strava")
        self.assertIn("Mia Run (Mia Runs)", add[2]["records"])

    def test_slug_resolves_in_clients_dir_and_unknown_roles_are_ignored(self):
        saved = L.CLIENTS_DIR
        L.CLIENTS_DIR = self.tmp.name
        try:
            with open(os.path.join(self.tmp.name, "acme.json"), "w") as f:
                json.dump({"ws": "7", "table": "t_acme", "view": "gv_acme",
                           "columns": {"brand": "Brand", "status": "Status", "email": "Email"}}, f)
            fake = FakeClay({})
            fake.column_list = lambda: [{"id": "f_acmebrand", "name": "Brand"}]
            L.clay = fake
            L.configure(L.load_client("acme"))
        finally:
            L.CLIENTS_DIR = saved
        self.assertEqual((L.TABLE, L.F_BRAND, L.CLIENT_VIEW), ("t_acme", "f_acmebrand", "gv_acme"))

    def test_missing_column_refuses_with_a_fix(self):
        L.clay = FakeClay({})
        with self.assertRaises(SystemExit) as e:
            L.configure(L.load_client(self.client(columns={"brand": "Brand Name"})))
        self.assertIn("run --setup", str(e.exception))

    def test_setup_applies_buyer_search_and_shows_pick_columns(self):
        fake = FakeClay({})
        fake.column_list = lambda: [
            {"id": L.F_PEOPLE, "name": "Find contacts at company", "typeSettings": {"inputsBinding": [
                {"name": "limit", "formulaText": '"1"'}, {"name": "identifiers_only"},
                {"name": "job_title_keywords", "formulaText": '"athlete, ambassador"'},
                {"name": "job_title_exclude_keywords"}]}},
            {"id": "f_dead", "name": "Role"}] + [{"id": fid, "name": n} for n, fid in fake.added.items()] + (
            [{"id": WHY, "name": L.WHY_COLUMN}] if fake.why_exists else [])
        L.clay = fake
        with open(os.devnull, "w") as null:
            out = sys.stdout
            sys.stdout = null
            try:
                L.main(["--setup", "--live", "--client", self.client(hide=["Role"])])
            finally:
                sys.stdout = out
        ts = json.loads(fake.ops("update-column")[0][2]["update"])["typeSettings"]["inputsBinding"]
        got = {b["name"]: b.get("formulaText") for b in ts}
        self.assertEqual(got["identifiers_only"], "true")
        self.assertEqual(got["limit"], '"5"')
        self.assertIn("influencer marketing", got["job_title_keywords"])
        self.assertIn("ambassador", got["job_title_exclude_keywords"])
        view = fake.ops("view-columns")[0][2]
        self.assertEqual(view["view"], "gv_client")
        vis = json.loads(view["columns"])
        self.assertEqual(vis["f_dead"], {"isVisible": False})
        self.assertEqual(len([v for v in vis.values() if v["isVisible"]]), 5)
        self.assertFalse(fake.ops("add-rows"))


class NoLookupTableTest(unittest.TestCase):
    def test_brand_buyer_reads_no_parents_file(self):
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools", "brand_buyer.py")) as f:
            src = f.read()
        self.assertNotIn("parent_domains", src)
        self.assertNotIn('"vitaminwell.com"', src, "no parent domain written into the code")


if __name__ == "__main__":
    unittest.main()
