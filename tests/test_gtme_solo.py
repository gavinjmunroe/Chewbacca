#!/usr/bin/env python3
"""The own-inbox outbound path (tools/gtme_solo.py), end to end against a fake
gws and fake websites. Nothing here can reach Gmail or the network: GWS is a
script in a temp dir that logs its arguments, and GTME_FIXTURES serves the sites."""
import base64
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import gtme_solo  # noqa: E402

FAKE_GWS = r'''#!/usr/bin/env python3
import json, os, sys
log = os.environ["FAKE_GWS_LOG"]
with open(log, "a") as f:
    f.write(json.dumps(sys.argv[1:]) + "\n")
args = sys.argv[1:]
if args[:4] == ["gmail", "users", "messages", "send"]:
    n = sum(1 for _ in open(log))
    print(json.dumps({"id": f"m{n}", "threadId": f"t{n}"}))
elif args[:4] == ["gmail", "users", "messages", "get"]:
    print(json.dumps({"payload": {"headers": [{"name": "Message-ID", "value": "<abc@mail.gmail.com>"}]}}))
elif args[:4] == ["gmail", "users", "threads", "get"]:
    tid = json.loads(args[5])["id"]
    replies = json.load(open(os.environ["FAKE_GWS_THREADS"])).get(tid, [])
    msgs = [{"id": "sent-" + tid, "labelIds": ["SENT"], "payload": {"headers": [{"name": "From", "value": "dana@me.test"}]}}]
    for i, (frm, text) in enumerate(replies):
        msgs.append({"id": f"r{tid}{i}", "labelIds": ["INBOX"], "payload": {
            "mimeType": "text/plain", "headers": [{"name": "From", "value": frm}],
            "body": {"data": __import__("base64").urlsafe_b64encode(text.encode()).decode()}}})
    print(json.dumps({"messages": msgs}))
else:
    print("{}")
'''

SITES = {
    "crumbcorner.test": '<html><head><title>Crumb Corner | Austin bakery</title><meta name="description" '
                        'content="Sourdough and pastries baked fresh every morning on South Congress."></head>'
                        '<body>Hi</body></html>',
    "crumbcorner.test_contact": '<a href="mailto:maria@crumbcorner.test">Maria</a> or info@crumbcorner.test, '
                                'logo@2x.png, noreply@crumbcorner.test, someone@gmail.com',
    "rollhouse.test": '<title>Roll House</title><p>Email us: hello@rollhouse.test</p>',
    "nomail.test": '<title>No Mail Cafe</title>',
}


class Solo(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        fx = self.tmp / "fx" / "sites"
        fx.mkdir(parents=True)
        for name, body in SITES.items():
            (fx / f"{name}.html").write_text(body)
        gws = self.tmp / "gws"
        gws.write_text(FAKE_GWS)
        gws.chmod(0o755)
        self.log = self.tmp / "gws.log"
        self.threads = self.tmp / "threads.json"
        self.threads.write_text("{}")
        self.env = {"GTME_HOME": str(self.tmp / "home"), "GTME_FIXTURES": str(self.tmp / "fx"),
                    "CHEWBACCA_GWS_BIN": str(gws), "FAKE_GWS_LOG": str(self.log),
                    "FAKE_GWS_THREADS": str(self.threads), "GTME_NOW": "2026-10-12T16:00:00+00:00",
                    "GTME_CLIENTS": str(self.tmp / "clients.json")}
        self.old = {k: os.environ.get(k) for k in list(self.env) + ["CHEWBACCA_NO_SEND"]}
        os.environ.update(self.env)
        os.environ.pop("CHEWBACCA_NO_SEND", None)
        import gtme_operator as op
        self.op = op
        plan = op.build_plan({"name": "Dana Co", "sell": "bookkeeping for small bakeries", "buyer": "the owner",
                              "great": "bakeries", "where": "Austin", "proof": "", "meetings": "1",
                              "sender": "Dana"})
        d = op.client_dir("Dana Co")
        op.write_json(d / "plan.json", plan)
        with (d / "list-raw.csv").open("w") as f:
            f.write("company,website,name,title,linkedin,email,location,source,why\n"
                    "Crumb Corner,crumbcorner.test,,,,,Austin,google-maps,\n"
                    "Roll House,https://www.rollhouse.test,,,,,Austin,google-maps,\n"
                    "No Mail Cafe,nomail.test,,,,,Austin,google-maps,\n"
                    "Local Trap,127.0.0.1,,,,,Austin,google-maps,\n")
        self.d = d
        # Jev is a network call; each test says what it scored.
        self._jev = gtme_solo.jev_says_yes
        gtme_solo.jev_says_yes = lambda text: 0.95

    def tearDown(self):
        gtme_solo.jev_says_yes = self._jev
        for k, v in self.old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def run_cli(self, *argv):
        return gtme_solo.main(list(argv))

    def sends(self):
        if not self.log.exists():
            return []
        return [a for a in map(json.loads, self.log.read_text().splitlines()) if a[:4] == ["gmail", "users", "messages", "send"]]

    def ready(self):
        self.run_cli("sender", "--client", "Dana Co", "--name", "Dana Ruiz", "--address", "12 Main St, Austin TX",
                     "--address-kind", "business", "--email", "dana@me.test")
        self.run_cli("find", "--client", "Dana Co")

    def batch(self, *extra):
        # Only a file this call wrote: a batch id is a hash of its text, so an
        # identical rebuild rewrites the same file rather than adding one.
        before = {p: p.stat().st_mtime_ns for p in (self.d / "batches").glob("*.json")}
        self.run_cli("batch", "--client", "Dana Co", *extra)
        new = [p for p in (self.d / "batches").glob("*.json") if before.get(p) != p.stat().st_mtime_ns]
        return json.loads(new[0].read_text()) if new else None

    # find

    def test_find_takes_only_emails_the_company_printed_on_its_own_site(self):
        self.ready()
        rows = {r.split(",")[0]: r for r in (self.d / "leads.csv").read_text().splitlines()[1:]}
        self.assertIn("maria@crumbcorner.test", rows["Crumb Corner"])  # a person beats info@
        self.assertNotIn("gmail.com", rows["Crumb Corner"])
        self.assertIn("hello@rollhouse.test", rows["Roll House"])
        self.assertNotIn("@", rows["No Mail Cafe"])

    def test_a_listing_pointing_at_a_private_address_is_never_fetched(self):
        os.environ.pop("GTME_FIXTURES")
        self.assertFalse(gtme_solo.public_host("127.0.0.1"))
        self.assertFalse(gtme_solo.public_host("10.0.0.5"))
        self.assertEqual(gtme_solo.fetch("http://127.0.0.1/"), "")

    def test_a_gzipped_page_reads_as_text(self):
        import gzip
        page = "<title>Python</title> psf@python.org"
        self.assertEqual(gtme_solo.decode_body(gzip.compress(page.encode()), "", "utf-8"), page)
        self.assertEqual(gtme_solo.decode_body(gzip.compress(page.encode()), "gzip", "utf-8"), page)
        self.assertEqual(gtme_solo.decode_body(page.encode(), "", "utf-8"), page)

    def test_a_gzip_bomb_stops_at_the_page_limit(self):
        import gzip
        bomb = gzip.compress(b"a" * (gtme_solo.PAGE_CHARS * 20))
        self.assertLess(len(bomb), gtme_solo.FETCH_BYTES)
        self.assertEqual(len(gtme_solo.decode_body(bomb, "gzip", "utf-8")), gtme_solo.PAGE_CHARS)

    def test_the_connect_uses_the_address_that_was_vetted(self):
        for host in ("127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "localhost"):
            with self.assertRaises(OSError):
                gtme_solo.vetted_address(host, 443)

    # batch

    def test_no_mailing_address_means_no_batch(self):
        self.run_cli("find", "--client", "Dana Co")
        self.assertEqual(self.run_cli("batch", "--client", "Dana Co"), 2)

    # 2026-10-29, Firm Foundation SoCal: a family home sat in the footer, a .edu
    # was a candidate sender, "this month" was about to go out in November, and
    # 11-day-old lines had drifted on 2 of 15 sites.
    def test_an_address_with_no_kind_means_no_batch(self):
        self.ready()
        plan = json.loads((self.d / "plan.json").read_text())
        plan["sender"].pop("address_kind")
        (self.d / "plan.json").write_text(json.dumps(plan))
        self.assertEqual(self.run_cli("batch", "--client", "Dana Co"), 2)

    def test_sender_refuses_an_address_without_its_kind(self):
        self.assertEqual(self.run_cli("sender", "--client", "Dana Co", "--address", "1 Home Rd"), 2)

    def test_sender_refuses_a_school_address(self):
        self.assertEqual(self.run_cli("sender", "--client", "Dana Co", "--email", "dana@school.edu"), 2)

    def test_setting_the_email_moves_the_inbox(self):
        self.ready()
        self.run_cli("sender", "--client", "Dana Co", "--email", "dana@newco.test")
        self.assertEqual(json.loads((self.d / "plan.json").read_text())["sender"]["inbox"], "dana@newco.test")

    def test_copy_that_says_this_month_is_held(self):
        mail = {"subject": "your site", "body": "We checked 50 sites this month.\n\n" + gtme_solo.OPT_OUT}
        self.assertTrue(any("this month" in p for p in gtme_solo.problems(mail)))
        mail["body"] = "We checked 50 sites in October.\n\n" + gtme_solo.OPT_OUT
        self.assertFalse(any("goes stale" in p for p in gtme_solo.problems(mail)))

    def test_a_line_checked_over_a_week_ago_is_held(self):
        self.ready()
        lines = {"maria@crumbcorner.test": {"line": "Crumb Corner's menu has no prices.",
                                         "source": "https://crumbcorner.test/", "checked": "2026-10-01 audit"}}
        (self.d / "lines.json").write_text(json.dumps(lines))
        b = self.batch()
        held = [h for h in (b or {}).get("held", []) if h["to"] == "maria@crumbcorner.test"]
        self.assertTrue(held and any("days ago" in w for w in held[0]["held_for"]), b)

    def test_weekend_holds_the_batch(self):
        self.ready()
        os.environ["GTME_NOW"] = "2026-10-11T16:00:00+00:00"
        self.assertEqual(self.run_cli("batch", "--client", "Dana Co"), 2)

    def test_batch_carries_name_address_and_opt_out_and_no_blanks(self):
        self.ready()
        b = self.batch()
        self.assertEqual(len(b["mails"]), 2)
        for m in b["mails"]:
            self.assertIn("12 Main St, Austin TX", m["body"])
            self.assertIn(gtme_solo.OPT_OUT, m["body"])
            self.assertNotIn("{{", m["body"] + m["subject"])
        role = next(m for m in b["mails"] if m["to"] == "hello@rollhouse.test")
        self.assertIn("Roll House team", role["body"])
        self.assertIn("At Dana Co, we help owners with bookkeeping", role["body"])
        self.assertEqual(role["subject"], "bookkeeping for small bakeries")

    # Sagar's first-email review, the same one gtme-grade runs on a campaign.
    # "Question" is the subject a real campaign shipped until 2026-10-11.
    def set_subject(self, subject):
        plan = json.loads((self.d / "plan.json").read_text())
        plan["copy"][0]["subject"] = subject
        (self.d / "plan.json").write_text(json.dumps(plan))

    def test_a_question_subject_refuses_the_whole_batch(self):
        self.ready()
        for subject in ("Question", "Quick question", "{{company}} question"):
            self.set_subject(subject)
            self.assertEqual(self.run_cli("batch", "--client", "Dana Co"), 2, subject)
            self.assertFalse(list((self.d / "batches").glob("*.json")), subject)
        self.set_subject("bakery bookkeeping")
        self.assertIsNotNone(self.batch())

    def test_a_first_email_that_never_names_its_company_refuses_the_batch(self):
        self.ready()
        plan = json.loads((self.d / "plan.json").read_text())
        plan["copy"][0]["body"] = plan["copy"][0]["body"].replace("At Dana Co, we", "We")
        (self.d / "plan.json").write_text(json.dumps(plan))
        self.assertEqual(self.run_cli("batch", "--client", "Dana Co"), 2)
        self.run_cli("sender", "--client", "Dana Co", "--company", "Crumb Books")
        self.assertEqual(self.run_cli("batch", "--client", "Dana Co"), 2)
        plan = json.loads((self.d / "plan.json").read_text())
        plan["copy"][0]["body"] = plan["copy"][0]["body"].replace("We help", "At Crumb Books, we help")
        (self.d / "plan.json").write_text(json.dumps(plan))
        self.assertIsNotNone(self.batch())

    def test_the_sender_company_comes_from_clients_json_for_any_client(self):
        self.ready()
        (self.tmp / "clients.json").write_text(json.dumps(
            {"clients": [{"name": "Dana Co", "sender_company": "Crumb Books"}]}))
        self.assertEqual(self.run_cli("batch", "--client", "Dana Co"), 2)

    def test_copy_refuses_a_link_in_email_1(self):
        seq = self.tmp / "seq.json"
        seq.write_text(json.dumps([{"step": 1, "day": 0, "subject": "{{company}} bakery bookkeeping",
                                    "body": "Hi {{first_name}}. Dana Co does bookkeeping for small bakeries. "
                                            "See who we are at danaco.tech/team."}]))
        self.assertEqual(self.run_cli("copy", "--client", "Dana Co", "--file", str(seq)), 2)

    def _ranked_leads(self):
        cols = ["company", "website", "name", "title", "email", "email_verdict", "dated_score"]
        rows = [["Fine Site Church", "fine.test", "Ann", "Office Administrator", "ann@fine.test", "valid", "2"],
                ["Old Site Church", "old.test", "Bo", "Executive Pastor", "bo@old.test", "valid", "4"],
                ["St Mary Parish", "mary.test", "Cy", "Business Manager", "cy@mary.test", "valid", "5"]]
        with (self.d / "leads.csv").open("w") as f:
            f.write(",".join(cols) + "\n" + "\n".join(",".join(r) for r in rows) + "\n")

    def test_rank_puts_a_dated_site_and_a_buyer_first(self):
        self._ranked_leads()
        self.assertEqual(self.run_cli("rank", "--client", "Dana Co"), 2)  # no customer seeds, no ranking
        self.assertEqual(self.run_cli("rank", "--client", "Dana Co", "--seeds", "durangovineyard.com"), 0)
        first = (self.d / "leads.csv").read_text().splitlines()[1]
        self.assertTrue(first.startswith("Old Site Church"), first)
        plan = json.loads((self.d / "plan.json").read_text())
        self.assertEqual(plan["targeting"]["seeds"], ["durangovineyard.com"])

    def test_stress_asks_calebs_own_questions(self):
        self.ready()
        self._ranked_leads()
        asked = {rule.split('":')[0]: v for v, rule, _ in gtme_solo.stress("Dana Co") if rule.startswith("Caleb asked")}
        self.assertEqual(next(v for k, v in asked.items() if "monkey see" in k), "FAIL")
        self.run_cli("rank", "--client", "Dana Co", "--seeds", "durangovineyard.com")
        asked = {rule.split('":')[0]: v for v, rule, _ in gtme_solo.stress("Dana Co") if rule.startswith("Caleb asked")}
        self.assertEqual(next(v for k, v in asked.items() if "monkey see" in k), "PASS")
        # The fine-looking site still sits in the next 15, so "aint even that bad" fails.
        self.assertEqual(next(v for k, v in asked.items() if "aint even that bad" in k), "FAIL")

    def test_line_freshness_only_counts_the_leads_that_send_soon(self):
        # 2026-11-03: FF's next 15 were re-audited that night and stress still
        # failed on leads 16 to 50, which wouldn't send for weeks.
        rows = [f"Church {i},c{i}.test,Pat,Executive Pastor,pat@c{i}.test,valid,4" for i in range(20)]
        (self.d / "leads.csv").write_text("company,website,name,title,email,email_verdict,dated_score\n"
                                          + "\n".join(rows) + "\n")
        lines = {f"pat@c{i}.test": {"line": "Times sit on the 3rd screen.", "source": f"https://c{i}.test/",
                                    "checked": "2026-10-12 audit" if i < 15 else "2026-09-01 audit"}
                 for i in range(20)}
        (self.d / "lines.json").write_text(json.dumps(lines))
        rows = {rule: v for v, rule, _ in gtme_solo.stress("Dana Co")}
        self.assertEqual(next(v for r, v in rows.items() if "re-checked in the last" in r), "PASS")

    def test_a_new_question_is_asked_on_every_run(self):
        path = self.tmp / "challenges.json"
        path.write_text(json.dumps({"challenges": []}))
        real = gtme_solo.CHALLENGES
        self.addCleanup(setattr, gtme_solo, "CHALLENGES", real)
        gtme_solo.CHALLENGES = path
        self.assertEqual(self.run_cli("challenge", "--text", "would a pastor forward this?"), 0)
        self.assertEqual(json.loads(path.read_text())["challenges"][0]["asked"], "would a pastor forward this?")
        self.ready()
        rows = gtme_solo.stress("Dana Co")
        self.assertIn(("NOT CHECKED", 'Caleb asked "would a pastor forward this?": no check answers this yet', rows[-1][2]),
                      rows)

    def test_stress_reads_the_campaign_against_the_playbooks(self):
        self.ready()
        real = gtme_solo.email_listing
        self.addCleanup(setattr, gtme_solo, "email_listing", real)
        gtme_solo.email_listing = lambda: "  dana@me.test  (not signed in: chewbacca email add dana@me.test)\n"
        plan = json.loads((self.d / "plan.json").read_text())
        plan["copy"] = [{"step": 1, "day": 0, "subject": "{{company}} bakery bookkeeping",
                         "body": "Hi {{first_name}}. Dana Co does bookkeeping. www.danaco.tech"}]
        (self.d / "plan.json").write_text(json.dumps(plan))
        (self.d / "lines.json").write_text(json.dumps(
            {"maria@crumbcorner.test": {"line": "Your hours page is gone.", "source": "https://crumbcorner.test/",
                                        "checked": "2026-10-01 audit"}}))
        rows = {rule: v for v, rule, _ in gtme_solo.stress("Dana Co")}
        self.assertEqual(rows["email 1 has no links"], "FAIL")
        self.assertEqual(rows["the sending inbox dana@me.test is signed in"], "FAIL")
        self.assertEqual(next(v for r, v in rows.items() if "addresses verified" in r), "FAIL")
        self.assertEqual(next(v for r, v in rows.items() if "re-checked in the last" in r), "FAIL")
        self.assertIn("NOT CHECKED", rows.values())
        self.assertEqual(self.run_cli("stress", "--client", "Dana Co"), 1)

    def test_copy_refuses_a_question_subject(self):
        seq = self.tmp / "seq.json"
        seq.write_text(json.dumps([{"step": 1, "day": 0, "subject": "Question",
                                    "body": "Hi {{first_name}}, Dana Co does bookkeeping for small bakeries."}]))
        self.assertEqual(self.run_cli("copy", "--client", "Dana Co", "--file", str(seq)), 2)

    def test_a_personal_line_without_a_source_link_is_held(self):
        self.ready()
        lines = self.tmp / "lines.json"
        lines.write_text(json.dumps({"maria@crumbcorner.test": {"line": "Loved the sourdough."}}))
        b = self.batch("--lines", str(lines))
        self.assertEqual([m["to"] for m in b["held"]], ["maria@crumbcorner.test"])

    def test_first_week_sends_at_most_five_a_day(self):
        self.ready()
        self.assertEqual(gtme_solo.today_cap("Dana Co"), 5)

    # send

    def test_send_needs_the_exact_batch_and_dry_run_sends_nothing(self):
        self.ready()
        b = self.batch()
        self.assertEqual(self.run_cli("send", "--client", "Dana Co", "--batch", "0000000000"), 2)
        self.assertEqual(self.run_cli("send", "--client", "Dana Co", "--batch", b["id"], "--dry-run"), 0)
        self.assertEqual(self.sends(), [])

    def test_no_send_env_refuses(self):
        self.ready()
        b = self.batch()
        os.environ["CHEWBACCA_NO_SEND"] = "1"
        self.assertEqual(self.run_cli("send", "--client", "Dana Co", "--batch", b["id"], "--gap", "0"), 2)
        self.assertEqual(self.sends(), [])

    def test_an_edited_or_stale_batch_refuses(self):
        self.ready()
        b = self.batch()
        path = self.d / "batches" / f"{b['id']}.json"
        edited = json.loads(path.read_text())
        edited["mails"][0]["body"] += " P.S. extra"
        path.write_text(json.dumps(edited))
        self.assertEqual(self.run_cli("send", "--client", "Dana Co", "--batch", b["id"], "--gap", "0"), 2)
        b = self.batch()
        os.environ["GTME_NOW"] = "2026-10-12T18:30:00+00:00"
        self.assertEqual(self.run_cli("send", "--client", "Dana Co", "--batch", b["id"], "--gap", "0"), 2)
        self.assertEqual(self.sends(), [])

    def test_send_then_follow_up_threads_under_the_first_email(self):
        self.ready()
        b = self.batch()
        self.assertEqual(self.run_cli("send", "--client", "Dana Co", "--batch", b["id"], "--gap", "0"), 0)
        self.assertEqual(len(self.sends()), 2)
        self.assertEqual(self.run_cli("send", "--client", "Dana Co", "--batch", b["id"], "--gap", "0"), 2)
        os.environ["GTME_NOW"] = "2026-10-15T16:00:00+00:00"
        b2 = self.batch()
        steps = sorted(m["step"] for m in b2["mails"])
        self.assertEqual(steps, [2, 2])
        self.assertIn("most owners we talk to", b2["mails"][0]["body"])
        self.assertEqual(self.run_cli("send", "--client", "Dana Co", "--batch", b2["id"], "--gap", "0"), 0)
        last = json.loads(self.sends()[-1][7])
        self.assertTrue(last["threadId"].startswith("t"))
        raw = base64.urlsafe_b64decode(last["raw"]).decode()
        self.assertIn("In-Reply-To: <abc@mail.gmail.com>", raw)
        self.assertIn("Subject: Re: ", raw)

    def test_a_rerun_of_a_half_sent_batch_never_emails_anyone_twice(self):
        self.ready()
        b = self.batch()
        self.run_cli("send", "--client", "Dana Co", "--batch", b["id"], "--gap", "0")
        path = self.d / "batches" / f"{b['id']}.json"
        killed = json.loads(path.read_text())
        killed.pop("sent_at")
        path.write_text(json.dumps(killed))
        self.run_cli("send", "--client", "Dana Co", "--batch", b["id"], "--gap", "0")
        self.assertEqual(len(self.sends()), 2)

    def test_two_batches_in_one_day_never_pass_the_daily_cap(self):
        self.ready()
        rows = (self.d / "leads.csv").read_text().splitlines()
        extra = [f"Shop {i},shop{i}.test,,,,shop{i}@shop{i}.test,Austin,google-maps,,,,," for i in range(8)]
        (self.d / "leads.csv").write_text("\n".join(rows + extra) + "\n")
        b1 = self.batch()
        # A second, different batch the same morning: drop Maria so the next
        # lead in line joins it. Without the cap check at send, 6 go out.
        (self.d / "leads.csv").write_text("\n".join(r for r in rows + extra if "maria@" not in r) + "\n")
        b2 = self.batch()
        self.assertNotEqual(b1["id"], b2["id"])
        self.assertEqual(len(b1["mails"]), 5)
        self.run_cli("send", "--client", "Dana Co", "--batch", b1["id"], "--gap", "0")
        self.run_cli("send", "--client", "Dana Co", "--batch", b2["id"], "--gap", "0")
        self.assertEqual(len(self.sends()), 5)

    def test_a_plan_that_requires_a_line_holds_every_lead_without_one(self):
        self.ready()
        plan = json.loads((self.d / "plan.json").read_text())
        plan["require_line"] = True
        (self.d / "plan.json").write_text(json.dumps(plan))
        lines = self.tmp / "lines.json"
        lines.write_text(json.dumps({"maria@crumbcorner.test": {
            "line": "Your plan a visit page has no form.", "source": "https://crumbcorner.test/visit"}}))
        b = self.batch("--lines", str(lines))
        self.assertEqual([m["to"] for m in b["mails"]], ["maria@crumbcorner.test"])
        self.assertIn("hello@rollhouse.test", [m["to"] for m in b["held"]])

    def test_the_ledgers_own_lines_json_is_read_without_the_flag(self):
        # 10/12: every Firm Foundation lead was held for "no personal line"
        # because lines.json sat in the ledger and batch only read --lines.
        self.ready()
        plan = json.loads((self.d / "plan.json").read_text())
        plan["require_line"] = True
        (self.d / "plan.json").write_text(json.dumps(plan))
        (self.d / "lines.json").write_text(json.dumps({"maria@crumbcorner.test": {
            "line": "Your plan a visit page has no form.", "source": "https://crumbcorner.test/visit"}}))
        b = self.batch()
        self.assertEqual([m["to"] for m in b["mails"]], ["maria@crumbcorner.test"])
        self.assertIn("Your plan a visit page has no form.", b["mails"][0]["body"])

    def test_jev_checks_hold_an_email_jev_flags(self):
        import gtme_jev
        self.ready()
        plan = json.loads((self.d / "plan.json").read_text())
        plan["jev_checks"] = True
        (self.d / "plan.json").write_text(json.dumps(plan))
        real = gtme_jev.review
        gtme_jev.review = lambda m, rulings, **kw: ["the opener reads vague or harsh to Jev (0.20)"] \
            if m["to"] == "maria@crumbcorner.test" else []
        try:
            b = self.batch()
        finally:
            gtme_jev.review = real
        self.assertNotIn("maria@crumbcorner.test", [m["to"] for m in b["mails"]])
        self.assertIn("maria@crumbcorner.test", [m["to"] for m in b["held"]])

    def add_second_contact(self):
        rows = (self.d / "leads.csv").read_text().splitlines()
        rows.append("Crumb Corner,crumbcorner.test,,,,pastor@crumbcorner.test,Austin,google-maps,,,,,")
        (self.d / "leads.csv").write_text("\n".join(rows) + "\n")

    def test_the_next_person_at_a_church_waits_three_days_and_a_reply_stops_them(self):
        self.ready()
        self.add_second_contact()
        b = self.batch()
        to = [m["to"] for m in b["mails"]]
        self.assertIn("maria@crumbcorner.test", to)
        self.assertNotIn("pastor@crumbcorner.test", to)
        self.run_cli("send", "--client", "Dana Co", "--batch", b["id"], "--gap", "0")
        os.environ["GTME_NOW"] = "2026-10-13T16:00:00+00:00"
        b2 = self.batch()
        self.assertNotIn("pastor@crumbcorner.test", [m["to"] for m in (b2 or {}).get("mails", [])])
        os.environ["GTME_NOW"] = "2026-10-15T16:00:00+00:00"
        self.assertIn("pastor@crumbcorner.test", [m["to"] for m in self.batch()["mails"]])

    def test_a_reply_from_anyone_at_the_church_stops_the_next_contact(self):
        self.ready()
        self.add_second_contact()
        b = self.batch()
        self.run_cli("send", "--client", "Dana Co", "--batch", b["id"], "--gap", "0")
        thread = {json.loads(x)["email"]: json.loads(x)["thread"]
                  for x in (self.d / "sent.jsonl").read_text().splitlines()}["maria@crumbcorner.test"]
        self.threads.write_text(json.dumps({thread: [["maria@crumbcorner.test", "Not right now, thanks."]]}))
        self.run_cli("inbox", "--client", "Dana Co", "--json")
        os.environ["GTME_NOW"] = "2026-10-15T16:00:00+00:00"
        b2 = self.batch()
        self.assertNotIn("pastor@crumbcorner.test", [m["to"] for m in (b2 or {}).get("mails", [])])

    # inbox

    def test_opt_out_is_suppressed_and_a_reply_stops_follow_ups(self):
        self.ready()
        b = self.batch()
        self.run_cli("send", "--client", "Dana Co", "--batch", b["id"], "--gap", "0")
        sent = {json.loads(x)["email"]: json.loads(x)["thread"] for x in (self.d / "sent.jsonl").read_text().splitlines()}
        self.threads.write_text(json.dumps({
            sent["maria@crumbcorner.test"]: [["maria@crumbcorner.test", "Please remove me from your list."]],
            sent["hello@rollhouse.test"]: [["hello@rollhouse.test", "Sure, send me more details, sounds useful."]],
        }))
        self.assertEqual(self.run_cli("inbox", "--client", "Dana Co", "--json"), 0)
        self.assertIn("maria@crumbcorner.test", gtme_solo.suppressed("Dana Co"))
        os.environ["GTME_NOW"] = "2026-10-15T16:00:00+00:00"
        self.assertIsNone(self.batch())
        # a second inbox read doesn't log the same reply twice
        self.run_cli("inbox", "--client", "Dana Co", "--json")
        self.assertEqual(len((self.d / "replies.jsonl").read_text().splitlines()), 2)

    def test_a_form_reply_names_this_clients_sender_never_jonah(self):
        # Until 2026-10-13 every own-inbox client's form reply read "Fill out
        # their form as Jonah", Zeutara's principal.
        self.ready()
        b = self.batch()
        self.run_cli("send", "--client", "Dana Co", "--batch", b["id"], "--gap", "0")
        sent = {json.loads(x)["email"]: json.loads(x)["thread"] for x in (self.d / "sent.jsonl").read_text().splitlines()}
        self.threads.write_text(json.dumps({
            sent["maria@crumbcorner.test"]: [["maria@crumbcorner.test",
                                              "Please fill out our intake form at https://crumbcorner.test/form"]],
        }))
        self.assertEqual(self.run_cli("inbox", "--client", "Dana Co", "--json"), 0)
        row = json.loads((self.d / "replies.jsonl").read_text().splitlines()[0])
        self.assertEqual(row["kind"], "form")
        self.assertIn("as Dana", row["next"])
        self.assertNotIn("Jonah", row["next"])

    # autosend

    def sent_threads(self):
        return {json.loads(x)["email"]: json.loads(x)["thread"]
                for x in (self.d / "sent.jsonl").read_text().splitlines()}

    def test_an_interested_reply_gets_the_saved_answer_in_its_thread_and_a_question_waits(self):
        self.ready()
        self.assertEqual(self.run_cli("autosend", "--client", "Dana Co", "--interested",
                                      "Great to hear. Does Tuesday or Wednesday afternoon work for a short call?"), 0)
        b = self.batch()
        self.run_cli("send", "--client", "Dana Co", "--batch", b["id"], "--gap", "0")
        sent = self.sent_threads()
        self.threads.write_text(json.dumps({
            sent["maria@crumbcorner.test"]: [["maria@crumbcorner.test", "Yes, I'm interested. Let's chat."]],
            sent["hello@rollhouse.test"]: [["hello@rollhouse.test", "How much does this cost per month?"]],
        }))
        before = len(self.sends())
        self.assertEqual(self.run_cli("inbox", "--client", "Dana Co", "--json"), 0)
        new = self.sends()[before:]
        self.assertEqual(len(new), 1)
        body = json.loads(new[0][7])
        self.assertEqual(body["threadId"], sent["maria@crumbcorner.test"])
        raw = base64.urlsafe_b64decode(body["raw"]).decode()
        self.assertIn("To: maria@crumbcorner.test", raw)
        self.assertIn("Tuesday or Wednesday", raw)
        # a second read never answers the same yes twice
        self.run_cli("inbox", "--client", "Dana Co", "--json")
        self.assertEqual(len(self.sends()), before + 1)

    def test_the_saved_booking_link_rides_under_the_answer(self):
        self.ready()
        self.assertEqual(self.run_cli("autosend", "--client", "Dana Co", "--interested",
                                      "Want to grab a time this week?", "--link", "http://cal.test/dana"), 2)
        self.assertEqual(self.run_cli("autosend", "--client", "Dana Co", "--interested",
                                      "Want to grab a time this week?", "--link", "https://cal.test/dana"), 0)
        b = self.batch()
        self.run_cli("send", "--client", "Dana Co", "--batch", b["id"], "--gap", "0")
        sent = self.sent_threads()
        self.threads.write_text(json.dumps({
            sent["maria@crumbcorner.test"]: [["maria@crumbcorner.test", "Yes, I'm interested. Let's chat."]]}))
        before = len(self.sends())
        self.run_cli("inbox", "--client", "Dana Co", "--json")
        raw = base64.urlsafe_b64decode(json.loads(self.sends()[before][7])["raw"]).decode()
        self.assertIn("Want to grab a time this week?", raw)
        self.assertIn("https://cal.test/dana", raw)

    def test_autosend_refuses_an_answer_with_a_link_or_number_and_no_send_holds_it(self):
        self.ready()
        self.assertEqual(self.run_cli("autosend", "--client", "Dana Co", "--interested",
                                      "Book here: https://cal.test/dana"), 2)
        self.assertEqual(self.run_cli("autosend", "--client", "Dana Co", "--interested",
                                      "Want to grab a time this week?"), 0)
        b = self.batch()
        self.run_cli("send", "--client", "Dana Co", "--batch", b["id"], "--gap", "0")
        sent = self.sent_threads()
        self.threads.write_text(json.dumps({
            sent["maria@crumbcorner.test"]: [["maria@crumbcorner.test", "Yes, I'm interested. Let's chat."]]}))
        os.environ["CHEWBACCA_NO_SEND"] = "1"
        before = len(self.sends())
        self.run_cli("inbox", "--client", "Dana Co", "--json")
        self.assertEqual(len(self.sends()), before)

    def test_a_yes_jev_doubts_or_cant_score_waits_for_a_person(self):
        self.ready()
        self.run_cli("autosend", "--client", "Dana Co", "--interested", "Want to grab a time this week?")
        b = self.batch()
        self.run_cli("send", "--client", "Dana Co", "--batch", b["id"], "--gap", "0")
        sent = self.sent_threads()
        for score in (0.4, None):
            gtme_solo.jev_says_yes = lambda text, s=score: s
            self.threads.write_text(json.dumps({
                sent["maria@crumbcorner.test"]: [["maria@crumbcorner.test", f"Yes, I'm interested. ({score})"]]}))
            before = len(self.sends())
            self.run_cli("inbox", "--client", "Dana Co", "--json")
            self.assertEqual(len(self.sends()), before, score)

    def test_a_yes_from_someone_we_never_emailed_waits_for_a_person(self):
        self.ready()
        self.run_cli("autosend", "--client", "Dana Co", "--interested", "Want to grab a time this week?")
        b = self.batch()
        self.run_cli("send", "--client", "Dana Co", "--batch", b["id"], "--gap", "0")
        sent = self.sent_threads()
        self.threads.write_text(json.dumps({
            sent["maria@crumbcorner.test"]: [["stranger@elsewhere.test", "Yes, I'm interested. Let's chat."]]}))
        before = len(self.sends())
        self.run_cli("inbox", "--client", "Dana Co", "--json")
        self.assertEqual(len(self.sends()), before)

    # share

    def git(self, cwd, *args):
        return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, check=True)

    def test_a_shared_ledger_commits_and_pushes_only_its_own_folder(self):
        remote = self.tmp / "remote.git"
        subprocess.run(["git", "init", "-q", "--bare", str(remote)], check=True)
        repo = self.tmp / "ff"
        subprocess.run(["git", "clone", "-q", str(remote), str(repo)], check=True, capture_output=True)
        for k, v in (("user.name", "t"), ("user.email", "t@t.test")):
            self.git(repo, "config", k, v)
        (repo / "README.md").write_text("ff\n")
        (repo / "unrelated.txt").write_text("not mine\n")
        self.git(repo, "add", "README.md")
        self.git(repo, "commit", "-q", "-m", "init")
        self.git(repo, "push", "-q", "origin", "HEAD")
        (repo / "README.md").write_text("ff, edited by someone else\n")
        self.assertEqual(self.run_cli("share", "--client", "Dana Co", "--dir", str(repo / "ops" / "gtme" / "dana")), 0)
        self.assertEqual(self.op.client_dir("Dana Co"), (repo / "ops" / "gtme" / "dana").resolve())
        self.assertIn("*.jsonl merge=union", (repo / ".gitattributes").read_text())
        self.ready()
        log = self.git(remote, "log", "--name-only", "--format=%s").stdout
        self.assertIn("ops/gtme/dana/plan.json", log)
        self.assertIn(".gitattributes", log)
        self.assertNotIn("README.md\n", log.split("init")[0])
        self.assertNotIn("unrelated.txt", log)

    def test_a_shared_repo_carries_the_teams_rulings_with_no_copy_elsewhere(self):
        repo = self.tmp / "team"
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        self.assertEqual(self.run_cli("share", "--client", "Dana Co", "--dir", str(repo / "ops" / "dana")), 0)
        rules = json.loads((repo / "DECISIONS.json").read_text())
        rules["rulings"].append({"id": "local", "rule": "Austin bakeries only.", "who": "Dana", "date": "2026-10-11",
                                 "source": "test", "status": "active"})
        (repo / "DECISIONS.json").write_text(json.dumps(rules))
        os.environ["CHEWBACCA_CLIENT_REPOS"] = str(self.tmp / "nowhere")
        try:
            self.assertIn("Austin bakeries only.", [r["rule"] for r in self.op.rulings_for("Dana Co")])
        finally:
            os.environ.pop("CHEWBACCA_CLIENT_REPOS", None)

    def test_copy_saves_a_clean_sequence_and_refuses_a_broken_one(self):
        seq = self.tmp / "seq.json"
        seq.write_text(json.dumps([{"step": 1, "day": 0, "subject": "{{company}} hours", "body": "Hi {{first_name}}."},
                                   {"step": 2, "day": 3, "subject": "", "body": "One more \u2014 note."}]))
        self.assertEqual(self.run_cli("copy", "--client", "Dana Co", "--file", str(seq)), 2)
        seq.write_text(json.dumps([{"step": 1, "day": 0, "subject": "{{company}} bakery bookkeeping",
                                    "body": "Hi {{first_name}}. Dana Co does bookkeeping for small bakeries."},
                                   {"step": 2, "day": 3, "subject": "", "body": "One more note."}]))
        self.assertEqual(self.run_cli("copy", "--client", "Dana Co", "--file", str(seq), "--require-line"), 0)
        plan = json.loads((self.d / "plan.json").read_text())
        self.assertEqual([c["day"] for c in plan["copy"]], [0, 3])
        self.assertTrue(plan["require_line"])

    def test_week_counts_sends_replies_and_holds_from_the_ledger(self):
        self.ready()
        b = self.batch()
        self.run_cli("send", "--client", "Dana Co", "--batch", b["id"], "--gap", "0")
        sent = self.sent_threads()
        self.threads.write_text(json.dumps({
            sent["maria@crumbcorner.test"]: [["maria@crumbcorner.test", "Please remove me from your list."]]}))
        self.run_cli("inbox", "--client", "Dana Co", "--json")
        self.assertEqual(self.run_cli("week", "--client", "Dana Co", "--out", str(self.tmp)), 0)
        md = next(self.tmp.glob("Dana Co week *.md")).read_text()
        self.assertIn("First emails sent: 2, to 2 organizations", md)
        self.assertIn("Replies: 1 (50% of first emails)", md)
        self.assertIn("Never emailing again: 1", md)

    def test_a_meeting_counts_only_for_someone_we_emailed_and_shows_per_100(self):
        # AuraPath, 11/2: a head-to-head is judged on meetings per contact, and nothing recorded them
        self.ready()
        b = self.batch()
        self.run_cli("send", "--client", "Dana Co", "--batch", b["id"], "--gap", "0")
        self.assertEqual(self.run_cli("meeting", "--client", "Dana Co", "--email", "stranger@nowhere.test"), 2)
        self.assertEqual(self.run_cli("meeting", "--client", "Dana Co", "--email", "maria@crumbcorner.test",
                                      "--when", "Tue 2pm"), 0)
        self.assertEqual(self.run_cli("week", "--client", "Dana Co", "--out", str(self.tmp)), 0)
        md = next(self.tmp.glob("Dana Co week *.md")).read_text()
        self.assertIn("Meetings booked: 1", md)
        self.assertIn("Per 100 people emailed: 0.0 positive replies, 50.0 meetings", md)

    # 2026-11-03: 16 of FF's next 32 were office@ inboxes greeted "Hi <full church name>
    # team," on copy written for a named pastor, and variant B sat unused in plan.json.
    def add_versions(self, role_body=None, b_body=None):
        plan = json.loads((self.d / "plan.json").read_text())
        one = plan["copy"][0]
        if role_body is not None:
            plan["copy_role_inbox"] = [dict(one, body=role_body)]
        if b_body is not None:
            plan["copy_variant_b"] = dict(one, body=b_body)
        (self.d / "plan.json").write_text(json.dumps(plan))
        return one

    def test_a_role_inbox_gets_its_own_first_email(self):
        self.ready()
        one = self.add_versions(role_body="Hi there,\n\n" + json.loads((self.d / "plan.json").read_text())
                                ["copy"][0]["body"].split("\n", 1)[1] + "\n\nCould you pass this along?")
        b = self.batch()
        role = next(m for m in b["mails"] if m["to"] == "hello@rollhouse.test")
        named = next(m for m in b["mails"] if m["to"] == "maria@crumbcorner.test")
        self.assertEqual(role["variant"], "role")
        self.assertIn("Could you pass this along?", role["body"])
        self.assertNotIn("Roll House team", role["body"])
        self.assertEqual(named["variant"], "a")
        self.assertNotIn("Could you pass this along?", named["body"])
        self.assertIn("At Dana Co", one["body"])

    def test_variant_b_splits_by_address_and_stays_put(self):
        self.ready()
        plan = json.loads((self.d / "plan.json").read_text())
        self.add_versions(b_body=plan["copy"][0]["body"] + "\n\nVersion B here.")
        lead = {"email": "maria@crumbcorner.test"}
        want = "b" if int(gtme_solo.hashlib.sha256(b"maria@crumbcorner.test").hexdigest(), 16) % 2 else "a"
        plan = json.loads((self.d / "plan.json").read_text())
        self.assertEqual(gtme_solo.first_copy(plan, lead, "maria@crumbcorner.test")[0], want)
        self.assertEqual(gtme_solo.first_copy(plan, lead, "MARIA@crumbcorner.test")[0], want)
        picks = {gtme_solo.first_copy(plan, {}, f"p{i}@x.test")[0] for i in range(20)}
        self.assertEqual(picks, {"a", "b"})

    def test_a_version_that_fails_review_falls_back_to_email_1_a(self):
        self.ready()
        self.add_versions(role_body="Hi there,\n\nCould you pass this along?")
        b = self.batch()
        role = next(m for m in b["mails"] if m["to"] == "hello@rollhouse.test")
        self.assertEqual(role["variant"], "a")
        self.assertTrue(any("email 1 role fails Sagar's review" in w for w in b["warnings"]))

    def test_the_variant_rides_into_the_send_ledger(self):
        self.ready()
        b = self.batch()
        self.assertEqual(self.run_cli("send", "--client", "Dana Co", "--batch", b["id"], "--gap", "0"), 0)
        rows = [json.loads(x) for x in (self.d / "sent.jsonl").read_text().splitlines()]
        self.assertTrue(rows and all(r["variant"] == "a" for r in rows))

    def test_greeting_skips_a_title(self):
        # 2026-11-03: "Pastor Eduardo Bueno" on leads.csv became "Hi Pastor,".
        for name, want in (("Pastor Eduardo Bueno", "Hi Eduardo,"), ("Rev. Dr. Ann Lee", "Hi Ann,"),
                           ("Fr. John Ortiz", "Hi John,"), ("Cynthia Wagner", "Hi Cynthia,"),
                           ("Pastor", "Hi Pastor,")):
            self.assertEqual(gtme_solo.fill("Hi {{first_name}},", {"name": name}), want, name)

    def test_gtme_front_door_routes_here(self):
        self.ready()
        p = subprocess.run([sys.executable, str(ROOT / "tools" / "gtme_operator.py"), "batch", "--client", "Dana Co"],
                           capture_output=True, text=True, env=dict(os.environ))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("Nothing has been sent", p.stdout)
        # On 2026-11-02 stress landed in gtme_solo but this door didn't list it,
        # so `chewbacca gtme stress` answered "invalid choice".
        p = subprocess.run([sys.executable, str(ROOT / "tools" / "gtme_operator.py"), "stress", "--client", "Dana Co"],
                           capture_output=True, text=True, env=dict(os.environ))
        self.assertIn("not checked.", p.stdout, p.stderr)


if __name__ == "__main__":
    unittest.main()
