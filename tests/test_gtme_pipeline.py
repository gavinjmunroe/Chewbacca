"""gtme list, list-verify and outreach run a founder's pipeline from its client json.

Every site is a fixture under GTME_FIXTURES on .example hosts, every person
invented. Jev is either a fake passed to build() or switched off with an
AMBER_ROOT that holds no consent, so nothing leaves the machine.
"""
from __future__ import annotations

import csv
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import gtme_pipeline as gp  # noqa: E402

REGISTRY = """<html><body>
<p><a href="https://www.acme-it.example/">Acme IT</a> made the list.</p>
<p><a href="https://linkedin.com/in/x">Acme IT</a></p>
<table>
<tr><td>Rank</td><td>Company</td><td>Top Executive</td><td>City</td><td>Country</td></tr>
<tr><td>201</td><td>Acme IT</td><td>Dana Ruiz</td><td>Austin TX</td><td>United States</td></tr>
<tr><td>202</td><td>Beta Networks</td><td>Lee Park</td><td>Dallas TX</td><td>United States</td></tr>
<tr><td>203</td><td>Gamma Tech</td><td>Sam Cole</td><td>Toronto</td><td>Canada</td></tr>
<tr><td>204</td><td>Current Customer</td><td>Pat Kim</td><td>Boise ID</td><td>United States</td></tr>
<tr><td>205</td><td>Acme IT</td><td>Dana Ruiz</td><td>Austin TX</td><td>United States</td></tr>
</table></body></html>"""

SITES = {
    "registry.example_list": REGISTRY,
    "acme-it.example_": "<html><head><title>Acme IT | Managed IT</title></head><body>Acme IT keeps Austin running."
                        "<img alt='ConnectWise partner' src='cw.png'></body></html>",
    "acme-it.example_about": "<html><body><h2>Dana Ruiz</h2><p>Chief Executive Officer</p>"
                             "<p>Write to dana@acme-it.example or help@acme-it.example</p></body></html>",
}

BLOCK = {
    "sources": [{"name": "Registry 2026", "urls": ["https://registry.example/list"],
                 "extract": {"kind": "table", "where": {"country": ["United States"]}}},
                {"name": "each firm's own site"}],
    "titles": ["Owner", "Chief Executive Officer", "CEO"],
    "exclude": ["Current Customer"],
    "pages": ["", "/about"],
    "hook": {"words": ["ConnectWise", "Autotask"],
             "line": "Congrats on {company} making the list at #{rank}. Your site mentions {hook}."},
    "judge": {"question": "Is this a US MSP?"},
    "outreach": {"sender": "Reed", "company": "Junto",
                 "linkedin": "Hi {first_name}, {line} I'm {sender} at {sender_company}. Open to connecting?",
                 "email": {"subject": "{company} tickets", "body": "Hi {first_name},\n\n{line}"},
                 "text": "Hey {first_name}, {line}"},
}


def yes(states, question):
    return [0.9 for _ in states]


class PipelineTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        (self.tmp / "fx" / "sites").mkdir(parents=True)
        for name, body in SITES.items():
            (self.tmp / "fx" / "sites" / f"{name}.html").write_text(body)
        self.env = {"GTME_FIXTURES": str(self.tmp / "fx"), "GTME_CLIENTS_DIR": str(self.tmp / "clients"),
                    "GTME_HOME": str(self.tmp / "gtm"), "PEOPLE_DIR": str(self.tmp / "people"),
                    "AMBER_ROOT": str(self.tmp / "no-consent"), "CHEWBACCA_NO_SEND": "1"}
        self._old = {k: os.environ.get(k) for k in self.env}
        os.environ.update(self.env)

    def tearDown(self):
        for k, v in self._old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self._tmp.cleanup()

    def write_client(self, **over):
        (self.tmp / "clients").mkdir(exist_ok=True)
        cfg = {"client": "Acme Client", "client_slug": "acmeclient", "contact": "Reed Wolf, Founder (reed@junto.example)",
               "source": "UCLA Draper Showcase 2026", "motion": "customers first, investors second",
               "customers": dict(BLOCK, out=str(self.tmp / "out" / "list.csv"))}
        cfg.update(over)
        (self.tmp / "clients" / "acmeclient.json").write_text(json.dumps(cfg))
        return cfg

    def cli(self, *args):
        return subprocess.run([sys.executable, str(ROOT / "bin" / "gtme"), *args], capture_output=True, text=True,
                              env={**os.environ, **self.env}, timeout=120)

    # ── config ──

    def test_motion_reads_a_list_or_a_sentence_in_order(self):
        self.assertEqual(gp.motions_of({"motion": "customers first, investors second"}), ["customers", "investors"])
        self.assertEqual(gp.motions_of({"motion": "retail buyers before Nov 10, investors second"}),
                         ["customers", "investors"])
        self.assertEqual(gp.motions_of({"motion": "CPAs and referral partners, then customers"}),
                         ["channel_partners", "customers"])
        self.assertEqual(gp.motions_of({"motion": ["investors"]}), ["investors"])
        with self.assertRaises(gp.Refused):
            gp.motions_of({"motion": ["donors"]})

    def test_pricing_shape_needs_a_known_shape_and_need_means_unpicked(self):
        self.assertEqual(gp.pricing_of({"pricing_shape": "[NEED: set before the call]"}), {"shape": None, "price": None})
        self.assertEqual(gp.pricing_of({"pricing_shape": {"pick": "one_time_list", "price": 900}}),
                         {"shape": "one_time_list", "price": 900})
        with self.assertRaises(gp.Refused):
            gp.pricing_of({"pricing_shape": "lifetime deal"})

    def test_package_takes_motion_and_pricing_from_the_client_config(self):
        self.write_client(pricing_shape={"pick": "one_time_list", "price": 900})
        plan_dir = self.tmp / "gtm" / "clients" / "acmeclient"
        plan_dir.mkdir(parents=True)
        (plan_dir / "plan.json").write_text(json.dumps({"client": "Acme Client"}))
        proc = self.cli("package", "--client", "acmeclient", "--json")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        out = json.loads(proc.stdout)
        self.assertEqual((out["shape"], out["price_usd"], out["motion"]), ("one_time_list", 900, ["customers", "investors"]))
        self.assertEqual(out["mailboxes_usd"], 0, "a one-time list sends from their inboxes, not ours")
        proc = self.cli("package", "--client", "acmeclient", "--motion", "investors,customers", "--json")
        self.assertEqual(json.loads(proc.stdout)["motion"], ["investors", "customers"], "the plan's own order wins")
        proc = self.cli("package", "--client", "acmeclient", "--motion", "donors")
        self.assertNotEqual(proc.returncode, 0)

    # ── list ──

    def test_the_method_runs_from_config(self):
        rows, report = gp.build(BLOCK, ask=yes)
        by = {r["company"]: r for r in rows}
        self.assertEqual(sorted(by), ["Acme IT", "Beta Networks"], "Canada filtered, the customer excluded, dupes once")
        self.assertEqual(report["dropped"]["same company twice"], 1)
        acme = by["Acme IT"]
        self.assertEqual(acme["domain"], "acme-it.example", "the registry's own link, not the LinkedIn one")
        self.assertEqual((acme["title_confirmed"], acme["title_source"]), ("yes", "https://acme-it.example/about"))
        self.assertEqual(acme["email"], "dana@acme-it.example")
        self.assertEqual(acme["company_inbox"], "help@acme-it.example")
        self.assertEqual(acme["hook"], "ConnectWise", "found in a logo's alt text")
        self.assertIn("#201", acme["line"])
        self.assertIn("https://registry.example/list", acme["line_source"], "the rank's own page backs the line")
        self.assertEqual(acme["tier"], "A")
        beta = by["Beta Networks"]
        self.assertEqual(beta["domain"], "")
        self.assertIn("add its domain", beta["gaps"])
        self.assertEqual(rows[0]["company"], "Acme IT", "strongest first")

    def test_unjudged_rows_are_held_and_a_no_is_left_out(self):
        rows, _ = gp.build(BLOCK, ask=lambda s, q: [None] * len(s))
        self.assertTrue(all(r["tier"] == "hold" for r in rows))
        rows, report = gp.build(BLOCK, ask=lambda s, q: [0.1] * len(s))
        self.assertEqual((rows, report["judged_no"]), ([], 2))

    def test_an_email_is_kept_only_when_it_is_the_persons_own(self):
        self.assertEqual(gp.person_email(["help@x.example", "dana.ruiz@x.example"], "Dana Ruiz"), "dana.ruiz@x.example")
        self.assertEqual(gp.person_email(["lee@x.example"], "Dana Ruiz"), "")

    def test_cli_writes_the_list_and_a_report_and_verifies(self):
        self.write_client()
        proc = self.cli("list", "--client", "acmeclient", "--seed", "1")
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        out = self.tmp / "out" / "list.csv"
        rows = list(csv.DictReader(out.open()))
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r["tier"] == "hold" for r in rows), "no Jev, so nobody is tiered")
        report = json.loads(out.with_suffix(".report.json").read_text())
        self.assertEqual(report["verify"]["failed"], [])
        self.assertGreater(report["verify"]["checked"], 0)
        self.assertIn("registry rows", proc.stdout)

    def test_a_client_with_no_sources_falls_back_to_the_old_list(self):
        self.assertEqual(gp.cmd_list(type("A", (), {"client": "nobody", "motion": None})()), gp.LEGACY)

    # ── verify ──

    def test_verify_fails_a_fact_that_is_not_on_its_page(self):
        rows = [{"company": "Acme IT", "title": "Chief Executive Officer", "title_source": "https://acme-it.example/about",
                 "email": "nobody@acme-it.example", "email_source": "https://acme-it.example/about"}]
        res = gp.verify(rows, sample=1, seed_n=1)
        self.assertEqual(res["passed"], 1)
        self.assertEqual([f["field"] for f in res["failed"]], ["email"])
        dead = gp.verify([{"company": "X", "title": "CEO", "title_source": "https://gone.example/"}], sample=1)
        self.assertEqual((dead["checked"], len(dead["unreachable"])), (0, 1), "a dead page is not a pass")

    def test_verify_reads_an_existing_hand_built_list(self):
        rows = [{"company": "Acme IT", "full_name": "Dana Ruiz", "person_source": "https://registry.example/list",
                 "psa_rmm": "ConnectWise; Autotask", "psa_rmm_source": "https://acme-it.example/"}]
        res = gp.verify(rows, sample=1)
        self.assertEqual(res["checked"], 3)
        self.assertEqual([f["value"] for f in res["failed"]], ["Autotask"])

    def test_registry_pages_are_read_whole_and_site_pages_are_capped(self):
        # 2026-10-26: a 1.27 MB registry read at the 400 KB site cap lost two true names.
        seen = []
        os.environ.pop("GTME_FIXTURES")
        os.environ["GTME_LIST_CACHE"] = str(self.tmp / "cache")
        real = gp.solo.fetch
        gp.solo.fetch = lambda url, limit=gp.solo.FETCH_BYTES: seen.append((url, limit)) or ""
        try:
            gp.seed({"sources": [{"urls": ["https://registry.example/big"]}]})
            gp.page("https://site.example/about")
            gp.verify([{"company": "X", "title": "CEO", "title_source": "https://registry.example/big"}], sample=1)
        finally:
            gp.solo.fetch = real
            os.environ["GTME_FIXTURES"] = self.env["GTME_FIXTURES"]
            os.environ.pop("GTME_LIST_CACHE")
        self.assertEqual(seen, [("https://registry.example/big", gp.REGISTRY_BYTES),
                                ("https://site.example/about", gp.solo.FETCH_BYTES),
                                ("https://registry.example/big", gp.REGISTRY_BYTES)])
        self.assertGreater(gp.REGISTRY_BYTES, 1_270_000)

    def test_title_abbreviations_count(self):
        self.assertTrue(gp.on_page("Chief Executive Officer", "<p>Dana Ruiz, CEO</p>"))
        self.assertFalse(gp.on_page("Chief Operating Officer", "<p>Dana Ruiz, CEO</p>"))

    # ── outreach ──

    def test_lead_drafts_never_cut_a_sentence_and_count_the_cap(self):
        long = {"tier": "A", "full_name": "Dana Ruiz", "first_name": "Dana", "company": "Acme IT",
                "line": "First sentence is fine. " + "x" * 280 + ".", "line_source": "https://a.example/"}
        drafts = gp.lead_drafts([long], BLOCK, {"client": "Junto"}, queue=False)
        self.assertLessEqual(drafts[0]["linkedin_chars"], gp.LINKEDIN_CAP)
        self.assertIn("First sentence is fine.", drafts[0]["linkedin"])
        self.assertNotIn("xxx", drafts[0]["linkedin"])
        one = dict(long, line="y" * 320 + ".")
        drafts = gp.lead_drafts([one], BLOCK, {"client": "Junto"}, queue=False)
        self.assertTrue(any("over LinkedIn" in h for h in drafts[0]["held"]))
        held = gp.lead_drafts([dict(long, tier="hold")], BLOCK, {"client": "Junto"}, queue=False)
        self.assertEqual(held, [], "a held row gets no draft")

    def test_dashes_blanks_and_need_markers_hold_a_draft(self):
        self.assertTrue(gp.held("Hi — there"))
        self.assertTrue(gp.held("Hi {first_name}"))
        self.assertTrue(gp.held("At [NEED: address]"))
        self.assertEqual(gp.held("Hi Dana, congrats."), [])

    def test_a_text_is_drafted_only_for_someone_already_known_and_never_sent(self):
        import sqlite3
        (self.tmp / "people").mkdir()
        con = sqlite3.connect(self.tmp / "people" / "people.db")
        con.execute("CREATE TABLE people (id INTEGER, name TEXT, deleted_at TEXT)")
        con.execute("INSERT INTO people VALUES (1, 'Dana Ruiz', NULL)")
        con.commit(); con.close()
        log = self.tmp / "people.log"
        fake = self.tmp / "people-bin"
        fake.write_text(f"#!/bin/sh\necho \"$@\" >> {log}\necho 'Draft #7 added'\n")
        fake.chmod(0o755)
        os.environ["GTME_PEOPLE_BIN"] = str(fake)
        try:
            rows = [{"tier": "A", "full_name": "Dana Ruiz", "first_name": "Dana", "company": "Acme IT",
                     "line": "Congrats on the list.", "line_source": "https://a.example/"},
                    {"tier": "A", "full_name": "Lee Park", "first_name": "Lee", "company": "Beta",
                     "line": "Congrats too.", "line_source": "https://b.example/"}]
            drafts = gp.lead_drafts(rows, BLOCK, {"client": "Junto"}, queue=True)
        finally:
            os.environ.pop("GTME_PEOPLE_BIN")
        self.assertEqual(drafts[0]["text_status"], "queued as text draft #7")
        self.assertNotIn("text", drafts[1], "a stranger gets no text")
        called = log.read_text()
        self.assertIn("texts drafts add Dana Ruiz", called)
        self.assertNotIn("send", called.replace("--why=gtme outreach", ""))

    def test_founder_notes_name_what_was_built_and_skip_who_is_excluded(self):
        self.write_client(call="our call Wed 10/28 at 1:30pm PT")
        out = self.tmp / "out" / "list.csv"
        out.parent.mkdir(parents=True)
        out.write_text("company\nA\nB\nC\n")
        drafts = gp.founder_drafts("UCLA Draper", [], queue=False, me="Caleb")
        self.assertEqual(len(drafts), 1)
        d = drafts[0]
        self.assertEqual(d["to"], "Reed Wolf")
        self.assertIn("a list of 3 customers", d["linkedin"])
        self.assertNotIn("not_built", d, "investors has no block in this config, so nothing is missing")
        self.assertLessEqual(d["linkedin_chars"], gp.LINKEDIN_CAP)
        self.assertEqual(d["email"]["to"], "reed@junto.example")
        self.assertIn("Confirming our call Wed 10/28", d["email"]["body"])
        self.assertEqual(gp.founder_drafts("UCLA Draper", ["acmeclient"], queue=False, me="Caleb"), [])
        self.assertEqual(gp.founder_drafts("Other Event", [], queue=False, me="Caleb"), [])

    def test_outreach_cli_writes_md_and_json_and_sends_nothing(self):
        self.write_client()
        self.assertEqual(self.cli("list", "--client", "acmeclient", "--no-verify").returncode, 0)
        rows = list(csv.DictReader((self.tmp / "out" / "list.csv").open()))
        for r in rows:
            r["tier"] = "A"
        with (self.tmp / "out" / "list.csv").open("w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)
        proc = self.cli("outreach", "--client", "acmeclient")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Nothing sent", proc.stdout)
        md = next((self.tmp / "out").glob("*outreach-drafts.md"))
        self.assertIn("Drafts only. Nothing here was sent.", md.read_text())

    def test_the_tool_names_no_client(self):
        src = (ROOT / "tools" / "gtme_pipeline.py").read_text().lower()
        for word in ("zeutara", "junto", "sabo", "firebox", "optra", "/users/"):
            self.assertNotIn(word, src, word)


if __name__ == "__main__":
    unittest.main(verbosity=1)
