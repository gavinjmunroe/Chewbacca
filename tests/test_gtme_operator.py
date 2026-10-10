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
        for k in ("reply", "bounce", "floor", "dry", "credits"):
            self.assertIn(k, kinds)
        for x in items:
            self.assertTrue(x["command"] and x["gate"] and x["why"], x)
        self.assertEqual(items[0]["kind"], "reply")

    def test_report_week_counts_and_markdown(self):
        out = self.tmp / "dl"
        r = run(self.env, "report", "--client", "Northwind Test Co", "--week", "--out", str(out), "--no-pdf")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("| Emails sent | 5", r.stdout)     # 5 leads x one send date inside Mar 14-20
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
                             "Austin TX", "", "2", "yes", "yes"]) + "\n"
        r = run(env, stdin=answers)
        out = r.stdout
        self.assertEqual(r.returncode, 0, r.stderr + out)
        self.assertNotIn("Traceback", r.stderr)
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
