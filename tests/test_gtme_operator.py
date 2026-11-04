"""chewbacca gtme: a stranger reaches an approved plan and a deduped list with
every term explained, and the brief, next and report read a synthetic graph.

Every fixture here is invented: companies at .example domains, workspace ids
in the 9000s, no real client, person or workspace. Nothing touches the
network: GTME_FIXTURES answers every chewbacca clay / chewbacca api /
gtme-signals call, and a missing fixture reads as a failed call (which is how
"no Clay account" is simulated).
"""
from __future__ import annotations

import json
import os
import re
import shlex
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GTME = ROOT / "bin" / "gtme"
sys.path.insert(0, str(ROOT / "tools"))

NOW = "2026-03-20T15:00:00+00:00"
ESCAPES = ["\x1b[2J", "\x1b]8;;http://evil.example\x1b\\", "\x9b", "\x1b]0;pwned\x07"]
MD_LINK = "[click me](http://evil.example)"


def env_for(tmp: Path, **extra) -> dict:
    env = dict(os.environ)
    env.update({
        "HOME": str(tmp), "GTME_HOME": str(tmp / "gtm"), "GTM_CONFIG": str(tmp / "gtm" / "clients.json"),
        "KYBER_OS_GRAPH": str(tmp / "graph.sqlite"), "GTME_FIXTURES": str(tmp / "fx"),
        "GTME_NO_OPEN": "1", "GTME_NOW": NOW, "GTME_CHROME": "/nonexistent",
    })
    env.update(extra)
    (tmp / "fx").mkdir(parents=True, exist_ok=True)
    return env


def run(env: dict, *args, stdin: str = "") -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(GTME), *args], input=stdin, capture_output=True, text=True,
                          env=env, timeout=120)


def fixture(tmp: Path, name: str, body) -> None:
    (tmp / "fx" / f"{name}.json").write_text(json.dumps(body))


# ── a synthetic graph in the shape chewbacca gtm sync writes ──────────────


def make_graph(path: Path, poison: str = "") -> None:
    db = sqlite3.connect(path)
    db.executescript("""
        CREATE TABLE nodes (id TEXT PRIMARY KEY, type TEXT, label TEXT, props TEXT, unresolved INTEGER DEFAULT 0,
                            source TEXT);
        CREATE TABLE edges (src TEXT, verb TEXT, dst TEXT, props TEXT, source TEXT);
        CREATE TABLE gtm_sync (source TEXT PRIMARY KEY, kind TEXT, workspace TEXT, client TEXT, ran_at TEXT,
                               ok INTEGER, note TEXT, report TEXT);
    """)
    node = lambda i, t, l, p: db.execute("INSERT INTO nodes VALUES (?,?,?,?,0,'gtm-clay:9001')",  # noqa: E731
                                         (i, t, l, json.dumps(p)))
    edge = lambda s, v, d, p=None: db.execute("INSERT INTO edges VALUES (?,?,?,?,'gtm-clay:9001')",  # noqa: E731
                                              (s, v, d, json.dumps(p or {})))
    node("client:northwind", "Client", "Northwind Test Co", {"workspaces": ["9001"]})
    node("workspace:clay:9001", "Workspace", "Northwind", {"workspace_id": "9001"})
    edge("client:northwind", "OWNS", "workspace:clay:9001")
    asof = "2026-03-20T09:00:00Z"

    def campaign(cid, name, sent, replies, bounces, leads, step1, created="2026-03-01T00:00:00Z"):
        node(f"campaign:clay:{cid}", "Campaign", name, {
            "campaign_id": cid, "workspace_id": "9001", "status": "active", "name": name, "offer": "Widgets",
            "created_at": created,
            "analytics": {"leads": leads, "sent": sent, "replies": replies, "repliesExcludingOoo": replies,
                          "bounces": bounces}, "steps": [{"step": 1, "sentCount": step1}],
            "analytics_as_of": asof})
        edge(f"campaign:clay:{cid}", "FOR_CLIENT", "client:northwind")

    campaign("cam_bounce", "Bouncy " + poison, 300, 9, 12, 400, 300)    # 4% bounce: pause
    campaign("cam_floor", "Quiet list", 250, 1, 0, 400, 250)            # 0.4% after 250: rework
    campaign("cam_dry", "Nearly empty", 150, 3, 0, 160, 150, created="2026-03-18T00:00:00Z")  # 10 left
    for n in range(5):
        email = f"p{n}@acme{n}.example"
        edge("campaign:clay:cam_floor", "ENROLLED", f"person:{email}",
             {"email": email, "name": f"Pat {n}", "sent_dates": ["2026-03-17", "2026-03-10"],
              "last_sent_at": "2026-03-17"})
    lead = f"lead{poison}@acme.example"
    node("reply:1", "Reply", "r1", {"lead_email": lead, "time": "2026-03-20T12:00:00Z", "latest": True,
                                    "answered": False, "forwarded": False,
                                    "snippet": f"Yes, interested! {poison} send times"})
    edge("reply:1", "IN_CAMPAIGN", "campaign:clay:cam_floor")
    edge(f"person:{lead}", "REPLIED", "reply:1")
    edge("reply:1", "CLASSIFIED_AS", "replyclass:positive", {"by": ["model:test"]})
    node("reply:2", "Reply", "r2", {"lead_email": "q@beta.example", "time": "2026-03-19T12:00:00Z", "latest": True,
                                    "answered": False, "forwarded": False, "snippet": "What does it cost?"})
    edge("reply:2", "IN_CAMPAIGN", "campaign:clay:cam_floor")
    edge("person:q@beta.example", "REPLIED", "reply:2")
    edge("reply:2", "CLASSIFIED_AS", "replyclass:neutral", {"by": ["model:test"]})
    node("reply:3", "Reply", "r3", {"lead_email": "gone@gamma.example", "time": "2026-03-19T12:00:00Z",
                                    "latest": True, "answered": False, "forwarded": False,
                                    "snippet": "Delivery Status Notification (Failure)"})
    edge("reply:3", "IN_CAMPAIGN", "campaign:clay:cam_floor")
    node("reply:4", "Reply", "r4", {"lead_email": "stop@delta.example", "time": "2026-03-19T12:00:00Z",
                                    "latest": True, "answered": False, "forwarded": False,
                                    "snippet": "Remove me from this list"})
    edge("reply:4", "IN_CAMPAIGN", "campaign:clay:cam_floor")
    for src, kind in (("gtm-clay:9001", "clay"), ("gtm-inbox:9001", "inbox"), ("gtm-calendar", "calendar")):
        db.execute("INSERT INTO gtm_sync VALUES (?,?,?,?,?,?,?,?)",
                   (src, kind, "9001" if kind != "calendar" else "", "", "2026-03-20T09:00:00+00:00",
                    1, "", "{}"))
    db.commit()
    db.close()


def write_credits(gtm: Path, rows: list[dict]) -> None:
    gtm.mkdir(parents=True, exist_ok=True)
    (gtm / "credits.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))


class GraphCommands(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.env = env_for(self.tmp)
        make_graph(self.tmp / "graph.sqlite")
        write_credits(self.tmp / "gtm", [{"at": "2026-03-20T08:00:00+00:00", "ws": "9001", "balance": 300,
                                          "used_7d": 700}])

    def test_brief_ranks_positive_reply_then_pause_then_credits(self):
        r = run(self.env, "brief")
        self.assertEqual(r.returncode, 0, r.stderr)
        top = r.stdout.split("Top 3 actions:")[1]
        lines = [x for x in top.splitlines() if re.match(r"\s+\d\. ", x)]
        self.assertIn("positive reply", lines[0])
        self.assertIn("Pause \"Bouncy", lines[1])
        self.assertIn("Top up credits", lines[2])
        self.assertIn("as of 2026-03-20T09:00:00Z", r.stdout)
        self.assertIn("1 bounce notices", r.stdout)          # the mailer-daemon reply is not a reply
        self.assertIn("Level up:", r.stdout)
        self.assertNotIn("Traceback", r.stderr)

    def test_next_lists_every_item_with_command_and_gate(self):
        r = run(self.env, "next", "--json")
        items = json.loads(r.stdout)
        kinds = [x["kind"] for x in items]
        unsub = [x for x in items if x["kind"] == "unsubscribe"]
        self.assertEqual(len(unsub), 1)
        self.assertIn("stop@delta.example", unsub[0]["command"])
        self.assertIn("needs your approval", unsub[0]["gate"])
        self.assertFalse(any("stop@delta.example" in x["do"] for x in items if x["kind"] == "reply"))
        for k in ("reply", "bounce", "floor", "dry", "credits"):
            self.assertIn(k, kinds)
        for x in items:
            self.assertTrue(x["command"] and x["gate"] and x["why"], x)
        self.assertEqual(items[0]["kind"], "reply")

    def test_reply_command_has_real_ids_and_chewbacca_clay_accepts_it(self):
        # gtme next printed "campaign_id=... lead_id=... reply_data=..." until
        # 2026-10-10, which chewbacca clay refuses (lead_id is not a reply arg).
        db = sqlite3.connect(self.tmp / "graph.sqlite")
        row = db.execute("SELECT props FROM nodes WHERE id = 'reply:1'").fetchone()
        props = dict(json.loads(row[0]), workspace_id="9001", campaign_id="4411", lead_id="77",
                     stats_id="st-9f2", message_id="<CAx1@mail.example>")
        db.execute("UPDATE nodes SET props = ? WHERE id = 'reply:1'", (json.dumps(props),))
        db.commit()
        db.close()
        items = json.loads(run(self.env, "next", "--json").stdout)
        cmds = {x["do"].split()[1]: x["command"] for x in items if x["kind"] == "reply"}
        cmd = next(v for k, v in cmds.items() if k.startswith("lead"))
        self.assertNotIn("...", cmd)
        self.assertIn("campaign_id=4411", cmd)
        clay = shlex.split(cmd.split("  then  ")[1])
        self.assertEqual(clay[:3], ["chewbacca", "clay", "reply"])
        data = json.loads(next(a for a in clay if a.startswith("reply_data="))[len("reply_data="):])
        self.assertEqual((data["email_stats_id"], data["reply_message_id"]), ("st-9f2", "<CAx1@mail.example>"))
        env = dict(os.environ, CHEWBACCA_CLAY_FIXTURES=str(self.tmp / "fx"), CLAY_WORKSPACE_ID="9001",
                   CHEWBACCA_CLAY_MEASURED=str(self.tmp / "measured.json"), GTM_CONFIG=str(self.tmp / "none.json"))
        (self.tmp / "measured.json").write_text("{}")
        p = subprocess.run(["node", str(ROOT / "bin" / "chewbacca-clay"), *clay[2:], "--dry-run"],
                           capture_output=True, text=True, env=env, timeout=60)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        # A reply the sync stored no ids for says to sync, never prints a guess.
        self.assertIn("gtm sync --source inbox", cmds["q@beta.example"])

    def test_refill_command_names_the_campaign_for_add_leads(self):
        # add-leads requires campaign= (2026-10-10); the refill suggestion
        # carries it, the base segment and the grade step.
        db = sqlite3.connect(self.tmp / "graph.sqlite")
        db.execute("INSERT INTO edges VALUES (?,?,?,?,'gtm-clay:9001')",
                   ("campaign:clay:cam_dry", "TARGETS", "audience:clay:audseg_dry", "{}"))
        db.commit()
        db.close()
        items = json.loads(run(self.env, "next", "--json").stdout)
        dry = next(x for x in items if x["kind"] == "dry")
        self.assertIn("chewbacca clay add-leads audience=audseg_dry", dry["command"])
        self.assertIn("campaign=cam_dry --allow-writes", dry["command"])
        self.assertIn("gtme-grade --campaign cam_dry --action add-leads", dry["command"])
        late = [{"kind": "refill", "owed_by": "us", "title": "Refill c1", "campaign": "c1",
                 "source_id": "campaign:clay:cam_dry", "late_by_hours": 30}]
        fixture(self.tmp, "memory-overdue", {"late": late, "freshness": {"last_ingest": "2026-03-20T08:00:00Z"}})
        items = json.loads(run(self.env, "next", "--json").stdout)
        dry = next(x for x in items if x["kind"] == "dry")
        self.assertIn("add-leads audience=audseg_dry", dry["command"])
        self.assertIn("campaign=cam_dry", dry["command"])

    def test_rule_is_saved_and_holds_a_recommendation_that_crosses_it(self):
        # 2026-10-09: a week-1 update told the client "we'll narrow every list"
        # against a max-volume ruling nobody's tooling read.
        before = run(self.env, "next", "--json")
        self.assertTrue(any(x["kind"] == "floor" and not x.get("held_by") for x in json.loads(before.stdout)))
        r = run(self.env, "rule", "--client", "Northwind Test Co", "Max volume: send to every list they give us",
                "--who", "Morgan", "--source", "the client thread, 10/5")
        self.assertEqual(r.returncode, 0, r.stderr)
        cfg = json.loads((self.tmp / "gtm" / "clients.json").read_text())
        rul = next(c for c in cfg["clients"] if c["name"] == "Northwind Test Co")["rulings"]
        self.assertEqual(len(rul), 1)
        self.assertEqual({k: rul[0][k] for k in ("rule", "who", "status")},
                         {"rule": "Max volume: send to every list they give us", "who": "Morgan", "status": "active"})
        self.assertRegex(rul[0]["date"], r"^\d{4}-\d{2}-\d{2}$")
        run(self.env, "rule", "--client", "Northwind Test Co", "Max volume: send to every list they give us",
            "--who", "Morgan")
        cfg = json.loads((self.tmp / "gtm" / "clients.json").read_text())
        self.assertEqual(len(next(c for c in cfg["clients"] if c["name"] == "Northwind Test Co")["rulings"]), 1)
        items = json.loads(run(self.env, "next", "--json").stdout)
        floor = next(x for x in items if x["kind"] == "floor")
        self.assertEqual(floor["held_by"]["who"], "Morgan")
        self.assertTrue(floor["do"].startswith("Not recommended: Rework"), floor["do"])
        self.assertIn("Morgan owns changing it", floor["do"])
        self.assertIn("ask Morgan", floor["gate"])
        brief = run(self.env, "brief").stdout
        self.assertIn("Ruling: \"Max volume", brief)
        rep = run(self.env, "report", "--client", "Northwind Test Co", "--no-pdf", "--out", str(self.tmp / "out"))
        body = rep.stdout.split("Left out of the report:")[0]
        self.assertNotIn("Rework", body)
        self.assertIn("Left out of the report: Not recommended: Rework", rep.stdout)

    def test_report_has_the_company_scorecard_and_named_asks(self):
        db = sqlite3.connect(self.tmp / "graph.sqlite")
        row = db.execute("SELECT props FROM nodes WHERE id = 'reply:2'").fetchone()
        db.execute("UPDATE nodes SET props = ? WHERE id = 'reply:2'", (json.dumps(dict(
            json.loads(row[0]), snippet="What does it cost? Send the deck please.")),))
        db.execute("INSERT INTO edges VALUES (?,?,?,?,'gtm-clay:9001')", (
            "campaign:clay:cam_floor", "ENROLLED", "person:q@beta.example",
            json.dumps({"email": "q@beta.example", "name": "Quinn Beta"})))
        db.commit()
        db.close()
        rep = run(self.env, "report", "--client", "Northwind Test Co", "--no-pdf", "--out", str(self.tmp / "out"))
        self.assertEqual(rep.returncode, 0, rep.stderr)
        self.assertIn("## By company", rep.stdout)
        self.assertIn("| Widgets | ", rep.stdout)
        self.assertIn("Quinn Beta (q@beta.example)", rep.stdout)
        self.assertNotIn("Interested replies", rep.stdout)

    def test_client_update_leads_with_true_numbers_and_never_cuts_volume(self):
        # The 2026-10-09 week-1 update, rebuilt on synthetic data: one total
        # that read as a gap, "interested" from a Clay tag, and "we'll narrow
        # every list" against a max-volume ruling. None of it may come back.
        db = sqlite3.connect(self.tmp / "graph.sqlite")
        row = db.execute("SELECT props FROM nodes WHERE id = 'campaign:clay:cam_floor'").fetchone()
        props = dict(json.loads(row[0]), name="Acme | Ivy | Pre-seed investors | Midweek founder story", offer=None,
                     steps=[{"step": 1, "sentCount": 250}, {"step": 2, "sentCount": 120}],
                     reply_categories=[{"name": "Interested", "sentiment": "positive", "leads": 2},
                                       {"name": "Out Of Office", "sentiment": "neutral", "leads": 1}])
        props["analytics"] = dict(props["analytics"], sent=370, replies=2, repliesExcludingOoo=1, bounces=3)
        db.execute("UPDATE nodes SET props = ? WHERE id = 'campaign:clay:cam_floor'", (json.dumps(props),))
        row = db.execute("SELECT props FROM nodes WHERE id = 'reply:2'").fetchone()
        db.execute("UPDATE nodes SET props = ? WHERE id = 'reply:2'", (json.dumps(dict(
            json.loads(row[0]), snippet="Please send over the deck and we will take a look.")),))
        db.execute("INSERT INTO edges VALUES (?,?,?,?,'gtm-clay:9001')", (
            "campaign:clay:cam_floor", "ENROLLED", "person:q@beta.example",
            json.dumps({"email": "q@beta.example", "name": "Quinn Beta"})))
        db.commit()
        db.close()
        run(self.env, "rule", "--client", "Northwind Test Co", "Max volume. Send to every list they give us.",
            "--who", "Morgan")
        rep = run(self.env, "report", "--client", "Northwind Test Co", "--no-pdf", "--out", str(self.tmp / "out"))
        self.assertEqual(rep.returncode, 0, rep.stderr)
        body = rep.stdout.split("Left out of the report:")[0]
        summary = body.split("## Summary")[1].split("## This week")[0].strip().splitlines()
        self.assertIn("first emails plus", summary[0])
        self.assertTrue(summary[0][0].isdigit(), summary[0])
        self.assertIn("Asked for a deck, a call or a meeting: Quinn Beta asked for deck", summary[1])
        self.assertNotRegex(body.lower(), r"\binterested\b")
        self.assertNotIn("Emails sent", body)
        self.assertNotRegex(body, r"(?i)\b(narrow\w*|cut\w*|trim\w*|fewer|rework)\b")
        self.assertIn("Update text for the client, ready to paste:", rep.stdout)

    def test_rulings_from_a_client_repo_decisions_file(self):
        repos = self.tmp / "repos" / "northwind"
        repos.mkdir(parents=True)
        (repos / "DECISIONS.json").write_text(json.dumps({
            "client": "Northwind Test Co", "aliases": ["northwind"],
            "rulings": [{"id": "volume", "rule": "Max volume. Send to every list.", "who": "Sagar",
                         "date": "2026-03-05", "status": "active"},
                        {"id": "old", "rule": "Cut the list to 50", "who": "X", "status": "retired"}]}))
        env = dict(self.env, CHEWBACCA_CLIENT_REPOS=str(self.tmp / "repos"))
        # Security review, 2026-11-03: a DECISIONS.json the client's entry doesn't name
        # is somebody else's file, and naming the client in it loads nothing.
        items = json.loads(run(env, "next", "--json").stdout)
        floor = next(x for x in items if x["kind"] == "floor")
        self.assertIsNone(floor.get("held_by"), "an unconfigured repo's rulings never load")
        (self.tmp / "gtm" / "clients.json").write_text(json.dumps({"clients": [
            {"name": "Northwind Test Co", "workspaces": [], "rulings_path": str(repos / "DECISIONS.json")}]}))
        items = json.loads(run(env, "next", "--json").stdout)
        floor = next(x for x in items if x["kind"] == "floor")
        self.assertEqual(floor["held_by"]["who"], "Sagar")

    def test_classes_the_sync_gave_sort_bounces_and_removals(self):
        # 2026-10-10: the sync now classifies bounce notices and removal asks
        # from sender, subject and text; gtme sorts by that class even when
        # the snippet alone would not give it away.
        db = sqlite3.connect(self.tmp / "graph.sqlite")
        for rid, email, snippet, cls in (("reply:5", "daemon@eps.example", "see the technical details", "bounce"),
                                         ("reply:6", "off@zeta.example", "Thanks. Please take me off.",
                                          "unsubscribe")):
            db.execute("INSERT INTO nodes VALUES (?,?,?,?,0,'gtm-inbox:9001')",
                       (rid, "Reply", rid, json.dumps({"lead_email": email, "time": "2026-03-19T13:00:00Z",
                                                       "latest": True, "answered": False, "forwarded": False,
                                                       "snippet": snippet})))
            db.execute("INSERT INTO edges VALUES (?,?,?,?,'gtm-inbox:9001')",
                       (rid, "IN_CAMPAIGN", "campaign:clay:cam_floor", "{}"))
            db.execute("INSERT INTO edges VALUES (?,?,?,?,'gtm-inbox:9001')",
                       (rid, "CLASSIFIED_AS", f"replyclass:{cls}", json.dumps({"by": ["rule:reply-text"]})))
        db.commit()
        db.close()
        items = json.loads(run(self.env, "next", "--json").stdout)
        replies = " ".join(x["do"] for x in items if x["kind"] == "reply")
        self.assertNotIn("daemon@eps.example", replies)
        self.assertNotIn("off@zeta.example", replies)
        unsub = " ".join(x["command"] for x in items if x["kind"] == "unsubscribe")
        self.assertIn("off@zeta.example", unsub)
        self.assertIn("2 bounce notices and 2 removal asks", run(self.env, "brief").stdout)

    def test_gtm_memory_commitments_replace_recomputed_refills(self):
        late = [{"kind": "refill", "owed_by": "us", "title": f"Refill c{n}", "campaign": f"c{n}",
                 "late_by_hours": 24 * n} for n in range(1, 4)]
        late += [{"kind": "approval_owed", "owed_by": "client", "title": f"Verdict on reply {n}",
                  "late_by_hours": 10} for n in range(2)]
        fixture(self.tmp, "memory-overdue", {"late": late, "freshness": {"last_ingest": "2026-03-20T08:00:00Z"}})
        fixture(self.tmp, "memory-credits-by-table", {"total": 90, "window_days": 30, "as_of": "2026-03-20",
                                                      "rows": [{"table": "Leads A", "credits": 80}]})
        items = json.loads(run(self.env, "next", "--json").stdout)
        dry = [x for x in items if x["kind"] == "dry"]
        self.assertEqual(len(dry), 1)
        self.assertIn("Refill 3 campaigns", dry[0]["do"])
        self.assertIn("gtm-memory", dry[0]["why"])
        owed = [x for x in items if x["kind"] == "owed"]
        self.assertIn("2 reply verdicts from the client", owed[0]["do"])
        brief = run(self.env, "brief").stdout
        self.assertIn("Biggest spender: \"Leads A\", 80 of 90 credits", brief)

    def test_lesson_cites_a_sourced_walkthrough(self):
        r = run(self.env, "brief")
        self.assertRegex(r.stdout, r"Go deeper \(library/learning/clay-navigation/WALKTHROUGHS.md\): W-\d+ ")

    # ── one scoreboard (move 5, 2026-10-13) ──

    def tag_ten_positive_in_clay(self):
        """Clay's categories say 10 positive; the graph's reads say 1 person."""
        db = sqlite3.connect(self.tmp / "graph.sqlite")
        row = db.execute("SELECT props FROM nodes WHERE id = 'campaign:clay:cam_floor'").fetchone()
        props = dict(json.loads(row[0]), reply_categories=[{"name": "Interested", "sentiment": "positive",
                                                            "leads": 10}])
        db.execute("UPDATE nodes SET props = ? WHERE id = 'campaign:clay:cam_floor'", (json.dumps(props),))
        db.commit()
        db.close()

    def test_positives_are_one_number_in_every_table(self):
        self.tag_ten_positive_in_clay()
        rep = run(self.env, "report", "--client", "Northwind Test Co", "--no-pdf", "--out", str(self.tmp / "o"))
        self.assertEqual(rep.returncode, 0, rep.stderr)
        week = [x for x in rep.stdout.splitlines() if x.startswith("| People who replied positive")][0]
        self.assertTrue(week.rstrip().endswith("| 1 |"), week)
        total = [x for x in rep.stdout.splitlines() if x.startswith("| Total |")][0]
        self.assertEqual(total.split("|")[6].strip(), "1", total)
        self.assertIn("1 people replied positive", rep.stdout)
        nums = json.loads(run(self.env, "report", "--client", "Northwind Test Co", "--json").stdout)
        self.assertEqual(nums["positive"]["n"], 1)
        self.assertEqual(nums["totals"]["positive"], 1)

    def test_stale_numbers_are_flagged_and_get_no_pdf(self):
        env = dict(self.env, GTME_NOW="2026-03-21T17:00:00+00:00")   # 32 hours after the sync
        rep = run(env, "report", "--client", "Northwind Test Co", "--out", str(self.tmp / "o"))
        self.assertEqual(rep.returncode, 3, rep.stdout + rep.stderr)
        self.assertIn("STALE: Clay's numbers here are 32 hours old", rep.stdout)
        self.assertIn("PDF: not made", rep.stdout)
        self.assertFalse(list((self.tmp / "o").glob("*.pdf")))
        ok = run(env, "report", "--client", "Northwind Test Co", "--out", str(self.tmp / "o"), "--stale-ok")
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertEqual(json.loads(run(env, "report", "--client", "Northwind Test Co", "--json").stdout)["stale"],
                         True)
        fresh = run(self.env, "report", "--client", "Northwind Test Co", "--no-pdf", "--out", str(self.tmp / "o"))
        self.assertNotIn("STALE", fresh.stdout)

    def test_calendar_meetings_and_mail_bookings_are_two_rows_never_summed(self):
        db = sqlite3.connect(self.tmp / "graph.sqlite")
        db.execute("INSERT INTO nodes VALUES (?,?,?,?,0,'gtm-calendar')", (
            "meeting:1", "Meeting", "Call", json.dumps({"start": "2026-03-19T17:00:00Z"})))
        db.execute("INSERT INTO edges VALUES (?,?,?,?,'gtm-calendar')",
                   ("meeting:1", "BOOKED_FROM", "campaign:clay:cam_floor", "{}"))
        db.execute("INSERT INTO edges VALUES (?,?,?,?,'gtm-calendar')",
                   ("meeting:1", "MEETING_WITH", "person:lead@acme.example", "{}"))
        for n, who in enumerate(("lead@acme.example", "q@beta.example")):
            db.execute("INSERT INTO nodes VALUES (?,?,?,?,0,'gtm-inbox:9001')", (
                f"signal:{n}", "Signal", "Booking", json.dumps({
                    "kind": "booking_signal", "client_id": "client:northwind", "email": who,
                    "status": "confirmed", "credited": True, "message_time": "2026-03-19T12:00:00Z"})))
        db.commit()
        db.close()
        rep = run(self.env, "report", "--client", "Northwind Test Co", "--week", "--no-pdf",
                  "--out", str(self.tmp / "o"))
        self.assertEqual(rep.returncode, 0, rep.stderr)
        self.assertIn("| Meetings on a calendar | 1", rep.stdout)
        self.assertIn("| Bookings confirmed in reply mail | 2", rep.stdout)
        self.assertNotIn("| Meetings booked |", rep.stdout)
        self.assertNotIn("| 3 |", [x for x in rep.stdout.splitlines() if "eeting" in x or "ooking" in x][0])
        self.assertIn("never added together", rep.stdout)
        nums = json.loads(run(self.env, "report", "--client", "Northwind Test Co", "--json").stdout)
        self.assertEqual((nums["meetings"]["calendar"], nums["meetings"]["bookings_confirmed_in_mail"]), (1, 2))

    def test_report_week_counts_and_markdown(self):
        out = self.tmp / "dl"
        r = run(self.env, "report", "--client", "Northwind Test Co", "--week", "--out", str(out), "--no-pdf")
        self.assertEqual(r.returncode, 0, r.stderr)
        # 5 leads, each first emailed Mar 10 and followed up Mar 17: inside
        # Mar 14-20 that is 0 first emails and 5 follow ups, never "5 sent".
        self.assertIn("| First emails | 0", r.stdout)
        self.assertIn("| Follow ups | 5", r.stdout)
        self.assertNotIn("Emails sent", r.stdout)
        self.assertIn("## Next week", r.stdout)
        self.assertIn("Nearly empty", r.stdout)           # launched this week
        md = list((self.tmp / "gtm" / "clients").glob("*/*.md"))
        self.assertEqual(len(md), 1)

    def test_why_explains_last_recommendation(self):
        run(self.env, "brief")
        r = run(self.env, "why")
        self.assertIn("because:", r.stdout)
        self.assertIn("30 minutes", r.stdout)


class Escapes(unittest.TestCase):
    def test_no_escape_or_markdown_link_survives(self):
        tmp = Path(tempfile.mkdtemp())
        env = env_for(tmp)
        poison = "".join(ESCAPES) + MD_LINK
        make_graph(tmp / "graph.sqlite", poison=poison)
        outs = [run(env, "brief").stdout, run(env, "next").stdout,
                run(env, "report", "--client", "Northwind Test Co", "--no-pdf", "--out", str(tmp)).stdout]
        outs += [p.read_text() for p in (tmp / "gtm" / "clients").glob("*/*.md")]
        for text in outs:
            self.assertNotIn("\x1b", text)
            self.assertNotIn("\x9b", text)
            self.assertNotIn("\x07", text)
        report_md = outs[-1]
        self.assertNotIn("](http", report_md)
        self.assertIn("\\[click me\\]", report_md)


class Math(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        os.environ["GTME_HOME"] = str(self.tmp)
        import gtme_operator
        self.g = gtme_operator

    def tearDown(self):
        os.environ.pop("GTME_HOME", None)

    def test_burn_from_usage(self):
        write_credits(self.tmp, [{"at": "2026-03-20T08:00:00+00:00", "ws": "1", "balance": 700, "used_7d": 490}])
        v = self.g.credit_view(["1"])
        self.assertEqual(v["burn_per_day"], 70.0)
        self.assertAlmostEqual(v["days_left"], 10.0)

    def test_burn_from_balance_skips_top_up(self):
        write_credits(self.tmp, [
            {"at": "2026-03-10T00:00:00+00:00", "ws": "1", "balance": 1000},
            {"at": "2026-03-12T00:00:00+00:00", "ws": "1", "balance": 800},
            {"at": "2026-03-13T00:00:00+00:00", "ws": "1", "balance": 2800},   # top-up, not negative spend
            {"at": "2026-03-14T00:00:00+00:00", "ws": "1", "balance": 2600}])
        v = self.g.credit_view(["1"])
        self.assertEqual(v["burn_per_day"], 100.0)                              # 400 spent over 4 days
        self.assertAlmostEqual(v["days_left"], 26.0)

    def test_no_burn_means_no_days_left(self):
        write_credits(self.tmp, [{"at": "2026-03-20T08:00:00+00:00", "ws": "1", "balance": 50}])
        self.assertIsNone(self.g.credit_view(["1"])["days_left"])

    def test_sum_credits_takes_children_when_parent_shows_zero(self):
        tree = {"entities": [{"credits": 0, "subentities": [{"credits": 30}, {"credits": 12.5}]},
                             {"credits": 10, "subentities": []}]}
        self.assertEqual(self.g.sum_credits(tree), 52.5)

    def test_plan_math_follows_playbook(self):
        p = self.g.build_plan({"name": "X", "sell": "audits", "buyer": "owners", "great": "bakeries",
                               "where": "Austin TX", "proof": "", "meetings": "2"})
        self.assertEqual(p["math"]["contacts_per_week"], 800)
        self.assertEqual(p["math"]["emails_per_week"], 2400)
        self.assertEqual(p["math"]["sending_inboxes"], 16)
        self.assertEqual(p["first_test"]["contacts"], 200)
        self.assertEqual(p["sources"][0]["site"], "google-maps")
        self.assertIn("free test", p["offer"]["cta"])

    def test_fresh_multi_step_campaign_is_not_dry(self):
        v = self.g.campaign_view({"analytics": {"leads": 200, "sent": 200}, "status": "active",
                                  "steps": [{"sentCount": 200}, {"sentCount": 0}, {"sentCount": 0}]})
        self.assertEqual(v["leads_left"], 400)

    def test_drop_alarm_ignores_sends_too_new_to_have_replies(self):
        os.environ["GTME_NOW"] = "2026-03-20T12:00:00+00:00"
        try:
            hist = [{"client": "C", "as_of": "2026-03-10T00:00:00+00:00", "sent": 1000, "replies": 40},
                    {"client": "C", "as_of": "2026-03-16T00:00:00+00:00", "sent": 1200, "replies": 42}]
            (self.tmp / "history.jsonl").write_text("".join(json.dumps(h) + "\n" for h in hist))
            # Today's 500 fresh sends with no replies yet must not count.
            d = self.g.history_alarm("C", 1700, 42, "2026-03-20T11:00:00+00:00")
            self.assertIsNotNone(d)                          # 2/200 = 1% vs 4% before: a real drop
            self.assertEqual(d["new_sends"], 200)
            hist[1]["replies"] = 48                          # 8/200 = 4%: no drop
            (self.tmp / "history.jsonl").write_text("".join(json.dumps(h) + "\n" for h in hist))
            self.assertIsNone(self.g.history_alarm("C", 1700, 48, "2026-03-20T11:30:00+00:00"))
        finally:
            os.environ.pop("GTME_NOW", None)

    def test_merge_clients_keeps_fields_and_moves_workspace(self):
        cfg = {"clients": [{"name": "Old", "workspaces": ["1", "2"], "reply_labels": [{"path": "x"}]}]}
        new = self.g.merge_clients(cfg, [{"workspace": "2", "name": "New"}, {"workspace": "3", "name": ""}])
        old = next(c for c in new["clients"] if c["name"] == "Old")
        self.assertEqual(old["workspaces"], ["1"])
        self.assertEqual(old["reply_labels"], [{"path": "x"}])
        self.assertEqual(next(c for c in new["clients"] if c["name"] == "New")["workspaces"], ["2"])
        self.assertFalse(any("3" in c["workspaces"] for c in new["clients"]))


class Setup(unittest.TestCase):
    def test_setup_writes_config_from_workspace_list(self):
        tmp = Path(tempfile.mkdtemp())
        env = env_for(tmp)
        fixture(tmp, "clay-workspaces", {"ok": True, "surface": "fixture",
                                         "data": [{"id": 9101, "name": "Acme Outbound"},
                                                  {"id": 9102, "name": "Sandbox"}]})
        (tmp / "gtm").mkdir()
        (tmp / "gtm" / "clients.json").write_text(json.dumps(
            {"clients": [{"name": "Kept", "workspaces": ["9100"], "do_not_contact": ["x@y.example"]}]}))
        r = run(env, "setup", "--no-sync", stdin="Acme Co\nskip\n")
        self.assertEqual(r.returncode, 0, r.stderr)
        cfg = json.loads((tmp / "gtm" / "clients.json").read_text())
        names = {c["name"]: c for c in cfg["clients"]}
        self.assertEqual(names["Acme Co"]["workspaces"], ["9101"])
        self.assertEqual(names["Kept"]["do_not_contact"], ["x@y.example"])
        self.assertFalse(any("9102" in c["workspaces"] for c in cfg["clients"]))
        again = run(env, "setup", "--no-sync", stdin="\n\n")   # re-runnable: Enter keeps the answer
        cfg2 = json.loads((tmp / "gtm" / "clients.json").read_text())
        self.assertEqual(cfg2, json.loads(json.dumps(cfg2)))
        self.assertEqual({c["name"] for c in cfg2["clients"]} >= {"Acme Co", "Kept"}, True, again.stdout)

    def test_sync_reports_each_source_from_gtm_sync_json(self):
        # gtme sync and setup ran `gtm sync` and let its text lines scroll
        # past; they read `gtm sync --json` now and say per source what was
        # read. A config gtm cannot parse fails every source before any read,
        # which keeps this hermetic.
        tmp = Path(tempfile.mkdtemp())
        env = env_for(tmp)
        (tmp / "gtm").mkdir()
        (tmp / "gtm" / "clients.json").write_text("{not json")
        r = run(env, "sync")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("gtm-clay: not read,", r.stdout)
        self.assertIn("gtm-inbox: not read,", r.stdout)
        self.assertIn("gtm-calendar: not read,", r.stdout)
        self.assertNotIn("SKIPPED", r.stdout)

    def test_no_clay_says_what_clay_is_and_does_not_fail(self):
        tmp = Path(tempfile.mkdtemp())
        r = run(env_for(tmp), "setup")
        self.assertEqual(r.returncode, 0)
        self.assertIn("Clay is a web app", r.stdout)
        self.assertIn("gtme start", r.stdout)


class Stranger(unittest.TestCase):
    """A made-up bakery-supply business, a fresh HOME, no Clay. The person
    must reach an approved plan and a deduped list, and every jargon term
    the output uses must be explained in the same output."""

    def test_onboarding_from_nothing(self):
        tmp = Path(tempfile.mkdtemp())
        env = env_for(tmp)
        fixture(tmp, "api-google-maps-searchPlaces", {"ok": True, "data": [
            {"name": "Crumb Corner", "website": "crumb.example", "address": "1 Main St, Austin TX",
             "category": "Bakery"},
            {"name": "Crumb Corner", "website": "crumb.example", "address": "1 Main St, Austin TX",
             "category": "Bakery"},
            {"name": "Loaf Lab", "website": "loaflab.example", "address": "9 Oak Ave, Austin TX",
             "category": "Bakery"}]})
        answers = "\n".join(["Flourish Supply", "wholesale flour delivered next day",
                             "the bakery owner", "independent bakeries with 1-3 locations",
                             "Austin TX", "", "2", "Never email our current customers; always send volume",
                             "yes", "yes"]) + "\n"
        r = run(env, stdin=answers)
        out = r.stdout
        self.assertEqual(r.returncode, 0, r.stderr + out)
        self.assertNotIn("Traceback", r.stderr)
        self.assertIn("always or never do", out)
        cfg = json.loads((tmp / "gtm" / "clients.json").read_text())
        rul = next(c for c in cfg["clients"] if c["name"] == "Flourish Supply")["rulings"]
        self.assertEqual([x["rule"] for x in rul], ["Never email our current customers", "always send volume"])
        self.assertTrue(all(x["who"] == "the client" and x["status"] == "active" for x in rul))
        plan = json.loads((tmp / "gtm" / "clients" / "flourish-supply" / "plan.json").read_text())
        self.assertTrue(plan["approved"])
        golden = tmp / "gtm" / "clients" / "flourish-supply" / "deduped" / "golden.csv"
        self.assertTrue(golden.exists(), out)
        self.assertEqual(len(golden.read_text().strip().splitlines()) - 1, 2)   # 3 rows, one duplicate
        self.assertIn("Next single action:", out)
        self.assertIn("Cost:", out)
        self.assertIn("Gate:", out)
        import gtme_operator as g
        ours = re.sub(r'"[^"]*"', " ", out)
        for term, rx in g.TERM_RES.items():
            if rx.search(ours):
                self.assertIn(g.GLOSSARY[term], out, f"{term!r} used without being explained")
        # Jargon that is not in the glossary must not appear at all.
        for word in ("ICP fit", "TAM", "SDR", "MQL", "SQL", "catch-all", "spintax", "warmup", "Audiences"):
            self.assertNotIn(word, ours, f"untaught jargon {word!r}")
        learned = json.loads((tmp / "gtm" / "learned.json").read_text())
        self.assertIn("ICP", learned["terms"])
        again = run(env, "start", "--client", "Flourish Supply", stdin="no\n")
        self.assertNotIn(g.GLOSSARY["ICP"], again.stdout)                    # taught once, never again

    def test_explain(self):
        tmp = Path(tempfile.mkdtemp())
        env = env_for(tmp)
        r = run(env, "explain", "waterfall")
        self.assertIn("several data providers", r.stdout)
        self.assertEqual(run(env, "explain", "frobnicate").returncode, 1)


def analytics_campaign(cid, name, sent1, sent2, replies, human, pos, bounces, funnel_bounces=0, status="active"):
    """A campaign in the shape gtm sync stores: stats totals merged into
    analytics, the funnel's steps, and Clay's reply categories with sentiment."""
    return {"id": f"campaign:clay:{cid}", "campaign_id": cid, "name": name, "status": status,
            "analytics": {"leads": sent1, "sent": sent1 + sent2, "replies": replies,
                          "repliesExcludingOoo": human, "bounces": bounces},
            "steps": [{"step": 1, "sentCount": sent1, "bouncedCount": funnel_bounces},
                      {"step": 2, "sentCount": sent2, "bouncedCount": 0}],
            "reply_categories": [{"name": "Information Request", "sentiment": "positive", "leads": pos},
                                 {"name": "Not Interested", "sentiment": "negative", "leads": 3},
                                 {"name": "Out Of Office", "leads": replies - human}]}


class Scorecard(unittest.TestCase):
    def test_rolls_up_by_company_and_skips_inactive(self):
        import gtme_operator as g
        camps = [analytics_campaign("a", "Acme | Ivy | Pre-seed | Wave 2", 100, 40, 6, 5, 1, 2),
                 analytics_campaign("b", "Acme | Ivy | Pre-seed | Midweek", 50, 0, 3, 2, 0, 1),
                 analytics_campaign("c", "Acme | Ivy | Pre-seed | Old", 999, 0, 99, 99, 9, 9, status="paused"),
                 analytics_campaign("d", "Acme | Qube | Seed | Wave 1", 80, 20, 4, 4, 2, 18, funnel_bounces=11)]
        # Positives come from the reply reads (positives()), never Clay's category
        # counts: Ivy's campaigns carry 1 Clay "positive" and it is not counted.
        card = g.scorecard(camps, {"Ivy": 2, "Qube": 1})
        self.assertEqual(card["Ivy"], {"first_emails": 150, "follow_ups": 40, "replies": 9, "human_replies": 7,
                                       "positive": 2, "bounces": 3})
        self.assertEqual(g.scorecard(camps)["Ivy"]["positive"], 0)
        # Bounces from the stats totals (18), never the funnel's bouncedCount (11).
        self.assertEqual(card["Qube"]["bounces"], 18)
        text = "\n".join(g.scorecard_lines(card))
        self.assertIn("| Total | 230 | 60 | 13 | 11 | 3 | 21 |", text)
        self.assertIn("strongest read", text)
        self.assertNotIn("nterested", text.replace("Not Interested", ""))

    def test_real_asks_come_from_the_reply_text(self):
        import gtme_operator as g
        replies = [
            {"email": "pat@fund.example", "class": "positive", "time": "2026-03-19T10:00:00Z", "campaign": "W2",
             "snippet": "<div>Please send over the deck and we will review.</div>"},
            {"email": "lee@fund.example", "class": "neutral", "time": "2026-03-19T11:00:00Z", "campaign": "W2",
             "snippet": "Happy to hop on a call next week."},
            {"email": "ooo@fund.example", "class": "neutral", "time": "2026-03-19T12:00:00Z", "campaign": "W2",
             "snippet": "I am travelling. If urgent, call my cell."},
            {"email": "quoted@fund.example", "class": "neutral", "time": "2026-03-19T13:00:00Z", "campaign": "W2",
             "snippet": "Thanks, not now. On Tue, Mar 17 Sender wrote: would a short call or the deck help?"},
            {"email": "no@fund.example", "class": "negative", "time": "2026-03-19T14:00:00Z", "campaign": "W2",
             "snippet": "No meeting, thanks."},
        ]
        asks = g.real_asks(replies, {"pat@fund.example": "Pat Rivera"})
        self.assertEqual([a["email"] for a in asks], ["lee@fund.example", "pat@fund.example"])
        self.assertEqual(asks[1]["name"], "Pat Rivera")
        self.assertIn("deck", asks[1]["asked"])
        lines = "\n".join(g.asks_lines(asks))
        self.assertIn("Pat Rivera (pat@fund.example)", lines)


class ReplyTextThroughGtmeReply(unittest.TestCase):
    def test_reply_text_and_names_use_gtme_reply(self):
        import gtme_operator as g
        self.assertEqual(g.strip_html("<div>Send the deck.</div><blockquote>On Tue we wrote: a call?</blockquote>"),
                         "Send the deck.")
        self.assertEqual(g.strip_html('Thanks, no.<div style="color:rgb(33, 33'), "Thanks, no.")
        db = sqlite3.connect(":memory:")
        db.execute("CREATE TABLE edges (src TEXT, verb TEXT, dst TEXT, props TEXT)")
        db.execute("INSERT INTO edges VALUES ('c1', 'ENROLLED', 'p1', ?)",
                   (json.dumps({"email": "pat.rivera@fund.example", "name": "Pat Riverae"}),))
        self.assertEqual(g.lead_names(db, ["c1"]), {"pat.rivera@fund.example": "Pat Rivera"})


class RulingSources(unittest.TestCase):
    """Security review, 2026-11-03: rulings came from every ~/code/work/*/DECISIONS.json that
    named a client or one of its aliases, so a stranger's repo could waive a gate."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.saved = {k: os.environ.get(k) for k in ("GTM_CONFIG", "GTME_HOME", "CHEWBACCA_CLIENT_REPOS")}
        os.environ.update({"GTM_CONFIG": str(self.tmp / "gtm" / "clients.json"), "GTME_HOME": str(self.tmp / "gtm"),
                           "CHEWBACCA_CLIENT_REPOS": str(self.tmp / "work")})
        (self.tmp / "gtm").mkdir()
        import gtme_operator
        self.op = gtme_operator

    def tearDown(self):
        for k, v in self.saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def decisions(self, where, client, aliases, rulings):
        where.mkdir(parents=True, exist_ok=True)
        f = where / "DECISIONS.json"
        f.write_text(json.dumps({"client": client, "aliases": aliases, "rulings": rulings}))
        return f

    def config(self, **entry):
        (self.tmp / "gtm" / "clients.json").write_text(json.dumps({"clients": [dict(name="Acme West", **entry)]}))

    WAIVER = {"id": "no-postal-address", "rule": "Send without a postal address.", "who": "Pat", "date": "2026-10-01"}
    PLAIN = {"id": "volume", "rule": "Max volume.", "who": "Pat", "date": "2026-10-01"}

    def test_a_stranger_repo_naming_the_client_loads_nothing(self):
        self.decisions(self.tmp / "work" / "evil", "Acme West", ["acme west"], [self.WAIVER, self.PLAIN])
        self.config(workspaces=[])
        self.assertEqual(self.op.rulings_for("Acme West"), [])
        self.assertEqual(self.op.ruling_inputs("Acme West"), [])

    def test_the_configured_file_loads_and_its_waiver_is_a_signed_input(self):
        f = self.decisions(self.tmp / "work" / "acme", "Acme West", [], [self.WAIVER, self.PLAIN])
        self.config(workspaces=[], rulings_path=str(f))
        self.assertEqual([r["id"] for r in self.op.rulings_for("Acme West")], ["no-postal-address", "volume"])
        self.assertEqual(self.op.ruling_inputs("Acme West"), [str(f)])

    def test_an_alias_match_loads_plain_rulings_but_never_a_waiver(self):
        f = self.decisions(self.tmp / "work" / "acme", "Acme", ["acme west"], [self.WAIVER, self.PLAIN])
        self.config(workspaces=[], rulings_path=str(f))
        self.assertEqual([r["id"] for r in self.op.rulings_for("Acme West")], ["volume"])
        self.assertEqual(self.op.ruling_inputs("Acme West"), [])

    def test_a_shared_ledger_repo_file_loads_without_naming_the_client(self):
        """Firm Foundation's ff-ledger DECISIONS.json names "Firm Foundation" for both regions."""
        repo = self.tmp / "team"
        (repo / ".git").mkdir(parents=True)
        (repo / "ops" / "west").mkdir(parents=True)
        self.decisions(repo, "Acme", ["acme west"], [self.WAIVER, self.PLAIN])
        self.config(workspaces=[], state_dir=str(repo / "ops" / "west"))
        self.assertEqual([r["id"] for r in self.op.rulings_for("Acme West")], ["volume"])

    def test_a_clients_json_waiver_is_hashed_from_clients_json(self):
        self.config(workspaces=[], rulings=[self.WAIVER])
        self.assertEqual(self.op.ruling_inputs("Acme West"), [str(self.tmp / "gtm" / "clients.json")])


class FridayNumbersRuling(unittest.TestCase):
    def state(self):
        return {"name": "Acme", "workspaces": ["1"], "unanswered": [], "campaigns": [], "drop": None,
                "credits": None, "sync": [],
                "rulings": [{"id": "friday", "rule": "Weekly numbers summary to the client lead every Friday.",
                             "who": "Pat", "date": "2026-10-06"}]}

    def kinds(self, day):
        import gtme_operator as g
        os.environ["GTME_TODAY"] = day
        try:
            return [a["kind"] for a in g.actions_for(self.state())]
        finally:
            del os.environ["GTME_TODAY"]

    def test_friday_brief_leads_with_the_report(self):
        self.assertEqual(self.kinds("2026-10-16"), ["report"])

    def test_other_days_stay_quiet(self):
        self.assertEqual(self.kinds("2026-10-14"), [])


class NoAnswers(unittest.TestCase):
    # 2026-10-29: bare `chewbacca gtme` with nothing on stdin saved "My business" on defaults.
    def test_an_interview_with_no_answers_saves_nothing(self):
        tmp = Path(tempfile.mkdtemp())
        r = run(env_for(tmp), stdin="")
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertFalse((tmp / "gtm" / "clients" / "my-business").exists())


class Generalization(unittest.TestCase):
    def test_new_files_name_no_real_client(self):
        banned = re.compile(r"caleb|jonah|zeutara|1372623|maggie|graham|bluemodern|joelnewton", re.IGNORECASE)
        for f in (ROOT / "tools" / "gtme_operator.py", ROOT / "bin" / "gtme", Path(__file__)):
            text = f.read_text()
            if f == Path(__file__):
                text = text.split("banned = re.compile", 1)[0]
            self.assertIsNone(banned.search(text), f"{f.name}: {banned.search(text)}")


if __name__ == "__main__":
    unittest.main(verbosity=1)
