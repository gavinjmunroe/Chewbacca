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
                    "FAKE_GWS_THREADS": str(self.threads), "GTME_NOW": "2026-10-12T16:00:00+00:00"}
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

    def tearDown(self):
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
                     "--email", "dana@me.test")
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

    # batch

    def test_no_mailing_address_means_no_batch(self):
        self.run_cli("find", "--client", "Dana Co")
        self.assertEqual(self.run_cli("batch", "--client", "Dana Co"), 2)

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
        self.assertIn("We help owners with bookkeeping", role["body"])

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

    def test_gtme_front_door_routes_here(self):
        self.ready()
        p = subprocess.run([sys.executable, str(ROOT / "tools" / "gtme_operator.py"), "batch", "--client", "Dana Co"],
                           capture_output=True, text=True, env=dict(os.environ))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("Nothing has been sent", p.stdout)


if __name__ == "__main__":
    unittest.main()
