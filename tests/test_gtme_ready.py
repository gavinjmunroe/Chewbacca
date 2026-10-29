#!/usr/bin/env python3
"""gtme ready: READY only when every campaign passes every gate and both checks pass.

The cases are the 2026-10-12 Zeutara miss: a launch called good "until Jonah
responds" with gates NOT CHECKED, an expired pre-send receipt and firm names
carrying "L.P.". Every fixture is synthetic (example.test domains, invented
names, fake ids). Nothing reads Clay. Run: python3 tests/test_gtme_ready.py
"""
import csv
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "tools" / "gtme_ready.py"
sys.path.insert(0, str(ROOT / "tools"))
import gtme_grade  # noqa: E402

# The clean campaign tests/test_gtme_grade.py passes, in the same shapes.
COPY = """Subject: your payments seed checks

{{first_name}}, saw {{signal}} on your fund's site.

Your fund backed three payments teams at seed, and you led two of those rounds yourself.

You would see the 4 investors who joined similar rounds within 30 days, and you would read a one-page summary before any call.

You keep every decision, and you can pass in one line.

Worth a look?

Reply stop and I'll stop.

Jane Doe, Northwind Partners
100 Main Street, Suite 2, Springfield
---
Delay: 3
Thread: yes

{{first_name}}, since {{signal}}, your next check may fit a team of 6 that you could meet in 2 weeks.

Worth a read?

Reply stop and I'll stop.

Jane Doe
100 Main Street, Suite 2, Springfield
"""
LEADS = [
    ["email", "first_name", "company", "title", "verification", "signal", "line_source"],
    ["ann@fundone.example.test", "Ann", "Fund One", "Partner", "valid", "your Ledgerly seed",
     "https://fundone.example.test/portfolio"],
    ["bo@fundtwo.example.test", "Bo", "Fund Two", "General Partner", "valid", "your Paylane round",
     "https://fundtwo.example.test/news"],
    ["cy@fundthree.example.test", "Cy", "Fund Three", "Principal", "valid", "your Coinrail seed",
     "https://fundthree.example.test/team"],
]
SENDERS = [{"id": "s1", "email": "jane@outreach-one.example.test", "displayName": "Jane Doe",
            "warmup_days": 30, "health": 95},
           {"id": "s2", "email": "jane@outreach-two.example.test", "displayName": "Jane Doe",
            "warmup_days": 30, "health": 95}]
SETTINGS = {"trackingSettings": {"trackEmailOpen": False, "trackLinkClick": False},
            "scheduleSettings": {"daysOfWeek": ["mon", "tue", "wed", "thu", "fri"],
                                 "startHour": "09:00", "endHour": "17:00", "timezone": "America/New_York"},
            "autoPauseDomainLeadsOnReply": True, "isHtmlEnabled": False}

fails = 0


def check(name, ok, detail=""):
    global fails
    print(("ok    " if ok else "FAIL  ") + name + ("" if ok else f"\n      {str(detail)[:900]}"))
    fails += 0 if ok else 1


def clay_doc(cid, copy_path):
    camp = gtme_grade.campaign_from_copy(copy_path)

    def para(line):
        nodes = []
        for part in re.split(r"(\{\{\w+\}\})", line):
            m = re.fullmatch(r"\{\{(\w+)\}\}", part)
            if m:
                nodes.append({"type": "leadField", "attrs": {"fieldId": m.group(1), "required": True}})
            elif part:
                nodes.append({"type": "text", "text": part})
        return {"type": "paragraph", "content": nodes} if nodes else {"type": "paragraph"}

    seq = []
    for i, st in enumerate(camp["variants"][0]["steps"]):
        seq.append({"order": i, "delayDays": st["delay"],
                    "emailType": "REPLY_TO_THREAD" if st["thread"] else "NEW_EMAIL_THREAD",
                    "subject": {"type": "doc", "content": [para(st["subject"])]},
                    "body": {"type": "doc", "content": [para(ln) for ln in st["body"].rstrip("\n").split("\n")]}})
    return {"id": cid, "name": "test " + cid, "status": "draft", "sequence": seq,
            "settings": dict(SETTINGS, senderAccountIds=[])}


class World:
    """A HOME with one client, a drafts folder, every input, and fixtures for Clay and the inbox."""

    def __init__(self, cids=("cam_ready1",)):
        self.dir = Path(os.path.realpath(tempfile.mkdtemp()))
        self.home = self.dir / "home"
        self.data = self.home / "data" / "monday"
        (self.data / "leads").mkdir(parents=True)
        (self.data / "reviews").mkdir()
        self.fx = self.home / "fixtures"
        self.fx.mkdir(parents=True)
        (self.dir / "copy.txt").write_text(COPY)
        self.cids = list(cids)
        for cid in self.cids:
            (self.fx / f"{cid}.json").write_text(json.dumps(clay_doc(cid, self.dir / "copy.txt")))
            with open(self.data / "leads" / f"{cid}.csv", "w", newline="") as fh:
                csv.writer(fh).writerows(LEADS)
            self.review(cid)
        (self.data / "drafts.json").write_text(json.dumps(
            [{"company": "Acme", "tier": "A", "campaign": c, "segment": "audseg_x", "leads": 3} for c in self.cids]))
        (self.data / "senders.json").write_text(json.dumps(SENDERS))
        (self.data / "suppress.csv").write_text("email\nold@fundnine.example.test\n")
        self.inbox = self.dir / "inbox.json"
        self.inbox.write_text("[]")
        self.slack = self.dir / "slack.json"
        self.slack.write_text(json.dumps({"D1": []}))
        self.clients = self.dir / "clients.json"
        self.clients.write_text(json.dumps({"clients": [{
            "name": "Acme", "principal": "Jane Doe", "sender_company": "Northwind Partners",
            "workspaces": ["1372623"],
            "client_slack": {"user": "U_CLIENT", "me": ["U_ME"], "conversations": ["D1"]},
            "ready": {"offer": "payments seed rounds", "icp_titles": "partner,principal"}}]}))
        self.presend(fresh=True)

    def review(self, cid, unresolved=()):
        (self.data / "reviews" / f"{cid}.json").write_text(json.dumps(
            {"campaign": cid, "reviewer": "test reviewer", "unresolved": list(unresolved),
             "reviewed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}))

    def presend(self, fresh):
        src = self.home / "presend.csv"
        src.write_text("email\n")
        state = self.home / ".chewbacca" / "state"
        state.mkdir(parents=True, exist_ok=True)
        (state / "send-gate-receipts").mkdir(exist_ok=True)
        (state / "send-gate-receipts" / "acme.json").write_text(json.dumps(
            {"time": int(time.time()) - (0 if fresh else 13 * 3600), "client": "Acme", "full": True,
             "hashes": {str(src): hashlib.sha256(b"email\n").hexdigest()}}))

    def env(self):
        return dict(os.environ, HOME=str(self.home), GTME_CLIENTS=str(self.clients),
                    CHEWBACCA_GTM_CLIENTS=str(self.clients), CHEWBACCA_STATE_DIR="",
                    GTME_GRADE_KEY_FILE=str(self.home / "keys" / "gtme-grade.key"),
                    GTME_GRADE_INPUT_ROOTS=str(self.home), GTME_READY_CAMPAIGN_DIR=str(self.fx))

    def run(self, *extra):
        env = self.env()
        env.pop("CHEWBACCA_STATE_DIR")
        argv = [sys.executable, str(TOOL), "--client", "Acme", "--drafts", str(self.data / "drafts.json"),
                "--inbox", str(self.inbox), "--slack", str(self.slack)] + list(extra)
        return subprocess.run(argv, capture_output=True, text=True, env=env, timeout=180)

    def check_cmd(self):
        env = self.env()
        env.pop("CHEWBACCA_STATE_DIR")
        return subprocess.run([sys.executable, str(TOOL), "--client", "Acme", "--check"],
                              capture_output=True, text=True, env=env, timeout=60)

    def result(self):
        return json.loads((self.home / ".chewbacca" / "state" / "gtme-ready" / "acme.json").read_text())


def last_line(p):
    lines = [ln for ln in p.stdout.splitlines() if ln.strip() and not ln.startswith("Recorded in")]
    return lines[-1] if lines else ""


def never_says_ready(p):
    return not any(re.match(r"^\s*READY\b", ln) for ln in p.stdout.splitlines())


# 1. Everything in place: READY, exit 0, a signed result, --check passes.
w = World(("cam_ready1", "cam_ready2"))
p = w.run()
check("a clean launch with every input prints READY and exits 0",
      p.returncode == 0 and last_line(p).startswith("READY:"), p.stdout + p.stderr)
r = w.result()
check("the result records time, the drafts git blob and every campaign's gates",
      r["verdict"] == "READY" and r["blockers"] == 0 and isinstance(r["time"], int)
      and len(r["drafts"]["git_blob"]) == 40 and len(r["campaigns"]) == 2
      and all(g["status"] == "PASS" for c in r["campaigns"] for g in c["gates"]) and len(r["mac"]) == 64, r)
blob = subprocess.run(["git", "hash-object", str(w.data / "drafts.json")], capture_output=True, text=True).stdout.strip()
check("the drafts git blob matches git hash-object", r["drafts"]["git_blob"] == blob, (r["drafts"], blob))
check("--check passes a fresh signed READY", w.check_cmd().returncode == 0)

# Tampering and drift.
path = w.home / ".chewbacca" / "state" / "gtme-ready" / "acme.json"
body = json.loads(path.read_text())
body["time"] = int(time.time()) - 3 * 3600
path.write_text(json.dumps(body))
check("--check refuses a READY whose time was edited (signature)", w.check_cmd().returncode == 1)
w.run()
with open(w.data / "drafts.json", "a") as fh:
    fh.write("\n")
c = w.check_cmd()
check("--check refuses once the drafts file changes", c.returncode == 1 and "drafts file changed" in c.stdout, c.stdout)

# 2. The exact failure: a gate NOT CHECKED is a blocker, and NOT READY never prints READY.
w = World(("cam_ready1", "cam_ready2"))
(w.data / "reviews" / "cam_ready2.json").unlink()
p = w.run()
r = w.result()
row = next(c for c in r["campaigns"] if c["campaign"] == "cam_ready2")
read = next(g for g in row["gates"] if g["gate"] == 3)
check("a missing recipient read leaves gate 3 NOT CHECKED, not FAIL and not PASS",
      read["status"] == "NOT CHECKED", row)
check("a NOT CHECKED gate alone makes it NOT READY with 1 blocker, exit 1",
      p.returncode == 1 and r["verdict"] == "NOT READY" and r["blockers"] == 1
      and last_line(p).startswith("NOT READY: 1 blockers"), p.stdout)
check("a NOT READY result never prints a READY line", never_says_ready(p), p.stdout)
check("the table names the missing input", "reviews/cam_ready2.json" in p.stdout, p.stdout)
check("the table shows NOT CHECKED in the gate's column", "NOT CHECKED" in p.stdout, p.stdout)
check("--check refuses a NOT READY result", w.check_cmd().returncode == 1)

# 3. An expired pre-send gate receipt blocks, whatever the grades say.
w = World()
w.presend(fresh=False)
p = w.run()
check("an expired pre-send receipt is a blocker",
      p.returncode == 1 and "over 12 hours old" in p.stdout and never_says_ready(p), p.stdout)

# 4. A reply nobody answered blocks.
w = World()
w.inbox.write_text(json.dumps([{"lead_email": "q@fund.example.test", "history": {"history": [
    {"type": "SENT", "time": "2026-10-08T10:00:00Z", "email_body": "Hi"},
    {"type": "REPLY", "time": "2026-10-09T10:00:00Z", "email_body": "What is the round size and who is leading?"}]}}]))
p = w.run()
check("an owed reply is a blocker", p.returncode == 1 and "q@fund.example.test" in p.stdout and never_says_ready(p),
      p.stdout)

# 5. A client with no Slack set up is NOT CHECKED, not clean.
w = World()
cfg = json.loads(w.clients.read_text())
del cfg["clients"][0]["client_slack"]
w.clients.write_text(json.dumps(cfg))
p = w.run()
check("an owed-replies check that could not fully run counts as a blocker",
      p.returncode == 1 and never_says_ready(p), p.stdout)

# 6. A failing grade is FAIL with its first reason.
w = World()
w.review("cam_ready1", unresolved=["the second line reads like a pitch"])
p = w.run()
r = w.result()
check("an unresolved recipient objection is FAIL and NOT READY",
      p.returncode == 1 and r["campaigns"][0]["gates"][2]["status"] == "FAIL" and never_says_ready(p), r)

# 7. Input finding: a tier file split across two drafts is not this draft's list.
import gtme_ready  # noqa: E402
d = Path(tempfile.mkdtemp())
(d / "ivy-tierA-final.csv").write_text("email\n")
entries = [{"company": "Ivy", "tier": "A", "campaign": "cam_a"}, {"company": "Ivy", "tier": "A", "campaign": "cam_b"},
           {"company": "Goldies Good Vibes", "tier": "B", "campaign": "cam_c"}]
(d / "goldies-tierB-final.csv").write_text("email\n")
argv, missing = gtme_ready.resolve(entries[0], str(d), {}, entries)
check("a tier file shared by two signal-split drafts is refused as this draft's leads",
      "--leads" not in argv and any("split across 2 drafts" in m for m in missing), missing)
argv, missing = gtme_ready.resolve(entries[2], str(d), {}, entries)
check("a tier file used by one draft is its leads", "--leads" in argv and
      argv[argv.index("--leads") + 1].endswith("goldies-tierB-final.csv"), argv)
check("missing senders, suppress and recipient read are each named",
      {m.split(":")[0] for m in missing} >= {"senders", "suppress", "recipient read"}, missing)

# 8. The grader fails firm names the copy prints with a legal form or an emoji.
g = gtme_grade.Gate(4, "rendered output")
camp = {"variants": [{"name": "A", "steps": [{"subject": "x", "body": "Hi {{first_name}}, at {{audf_firm}}.\n",
                                              "renders": ["Hi {{first_name}}, at {{audf_firm}}.\n"],
                                              "delay": 0, "thread": False}]}]}
rows = [{"email": "a@x.example.test", "first_name": "Ann", "company": "W Capital Partners, L.P.",
         "audf_firm": "W Capital Partners, L.P."},
        {"email": "b@y.example.test", "first_name": "Bo", "company": "M13 \U0001F680", "audf_firm": "M13 \U0001F680"}]
gtme_grade.gate_render(camp, rows, g, company_fields={"audf_firm"})
text = " ".join(g.fails)
check("a firm name ending in L.P. that the copy prints fails gate 4", "legal form" in text, g.fails)
check("a firm name with an emoji that the copy prints fails gate 4", "emoji" in text, g.fails)
# 2026-10-12: 16 Nordic, Spanish, Italian and French forms passed the first list.
for name in ("Creandum AB", "Vaaka Partners Oy", "Erhvervsinvest Management A/S", "Magnum Industrial Partners, S.L.",
             "VAM Investments s.p.a.", "Antin Infrastructure Partners, S.A.S", "SERGAN Management Sàrl",
             "Capricorn Venture Partners N.V."):
    check(f"legal form caught: {name}", gtme_grade.LEGAL_SUFFIX.search(name) is not None)
for name in ("Accel", "Creandum", "Lab Ventures", "Oyster Capital", "Kasab", "Third Lake Capital"):
    check(f"plain firm name not flagged: {name}", gtme_grade.LEGAL_SUFFIX.search(name) is None)

# 9. Caleb, 2026-10-12: "NEVER DO SMTH SAGAR WOULDNT DO". Sagar's email 1 opens on
# who it is from; GEX's recipient-first checks must not fail it, and a
# recipient-first email that opens on nothing personal still fails.
body = ("Hi {{first_name}},\n\nI'm Jonah Graham, co-founder of Zeutara. We work with founders on fundraising, "
        "engineering and GTM.\n\nA company we work with is a Chicago dating app where singles check into venues. "
        "It has 10,000+ check-ins and is raising a $1M pre-seed SAFE.\n\nWould a short call with the founder be "
        "useful for you?\n\nJonah Graham\nCo-Founder, Zeutara")
step = {"subject": "Chicago dating app pre-seed", "body": body, "renders": [body.replace("{{first_name}}", "Ann")],
        "thread": False}
g = gtme_grade.Gate(2, "copy")
gtme_grade.score_email(step, 0, [{"first_name": "Ann"}], g, "A")
text = " ".join(g.fails)
check("Sagar's sender-first email 1 is not failed on line one", "line one" not in text, g.fails)
check("Sagar's sender-first email 1 is not failed on the 3:1 ratio", "3:1" not in text, g.fails)
check("Sagar's sender-first email 1 is not failed on its score", "scores" not in text, g.fails)
vague = body.replace("I'm Jonah Graham, co-founder of Zeutara. We work with founders on fundraising, engineering and GTM.",
                     "Hope this finds you well.")
step2 = dict(step, body=vague, renders=[vague])
g = gtme_grade.Gate(2, "copy")
gtme_grade.score_email(step2, 0, [{"first_name": "Ann"}], g, "A")
check("an email 1 that opens on nothing personal and not on the sender still fails line one",
      any("line one" in f for f in g.fails), g.fails)

# 2026-10-17: gtme-grade crashed on a field-map column the leads file lacked,
# all five gates went NOT CHECKED, and the table blamed a missing recipient read.
w = World(("cam_ready1", "cam_ready2"))
cfg = json.loads(w.clients.read_text())
cfg["clients"][0]["ready"]["field_map"] = {"signal": "no_such_column"}
w.clients.write_text(json.dumps(cfg))
(w.data / "reviews" / "cam_ready1.json").unlink()
p = w.run()
r = w.result()
row = next(c for c in r["campaigns"] if c["campaign"] == "cam_ready1")
check("a grader crash is the first reason, not the missing input beside it",
      row["first_reason"].startswith("gtme-grade did not run") and "no_such_column" in row["first_reason"], row)
check("the table says how many causes sit behind the blocker count",
      re.search(r"\d+ blockers come from \d+ causes?:", p.stdout) is not None, p.stdout)
check("one shared crash reads as one cause, not one per gate",
      re.search(r"come from 2 causes:", p.stdout) is not None or re.search(r"come from 1 cause:", p.stdout) is not None,
      p.stdout)

# A clients.json path from another folder is named, so last week's files can't grade this week silently.
w = World()
cfg = json.loads(w.clients.read_text())
cfg["clients"][0]["ready"]["suppress"] = str(w.home / "old-week" / "suppress.csv")
w.clients.write_text(json.dumps(cfg))
p = w.run()
check("a suppression file pinned in clients.json outside the drafts folder is flagged",
      "suppress comes from clients.json" in p.stdout, p.stdout)

# 2026-10-29: Firm Foundation sends from its own Gmail, and ready exited "names no
# Clay workspace", so an own-inbox batch had no READY to earn. A {"batch": id}
# entry is graded from the ledger; a clean one is READY with no workspace.
import gtme_solo  # noqa: E402


class Ledger:
    """An own-inbox client: a ledger with one frozen batch, and a fake gws."""

    def __init__(self, verdict="valid", signed_in=True):
        self.dir = Path(os.path.realpath(tempfile.mkdtemp()))
        self.home = self.dir / "home"
        self.led = self.dir / "ledger"
        (self.led / "batches").mkdir(parents=True)
        self.data = self.dir / "drafts"
        (self.data / "reviews").mkdir(parents=True)
        sender = {"name": "Jane Doe", "email": "jane@northwind.example.test", "inbox": "jane@northwind.example.test",
                  "address": "100 Main Street, Springfield"}
        (self.led / "plan.json").write_text(json.dumps({
            "client": "Solo", "answers": {"sender": "Jane"}, "sender": sender, "jev_checks": True, "min_grade": 85,
            "copy": [{"step": 1, "day": 0, "subject": "your site", "body": "Hi {{first_name}}"}]}))
        with open(self.led / "leads.csv", "w", newline="") as fh:
            csv.writer(fh).writerows([["company", "name", "email", "email_verdict"],
                                      ["Fund One", "Ann Lee", "ann@fundone.example.test", verdict]])
        body = ("Hi Ann,\n\nFund One's homepage has no contact form. It's one of 3 fixes we'd suggest.\n\n"
                "Want the full list? I'll send it over, free.\n\n" + gtme_solo.footer(sender))
        mails = [{"to": "ann@fundone.example.test", "step": 1, "subject": "your site", "body": body,
                  "line": "Fund One's homepage has no contact form.", "line_source": "https://fundone.example.test/",
                  "lead": {"company": "Fund One"}}]
        frozen = json.dumps([{k: m[k] for k in ("to", "step", "subject", "body")} for m in mails], sort_keys=True)
        self.bid = hashlib.sha256(frozen.encode()).hexdigest()[:10]
        now = gtme_solo.op.stamp()
        (self.led / "batches" / f"{self.bid}.json").write_text(json.dumps(
            {"id": self.bid, "made_at": now, "client": "Solo", "mails": mails, "held": [],
             "inbox": sender["inbox"]}))
        (self.led / "jev.jsonl").write_text(json.dumps(
            {"to": "ann@fundone.example.test", "step": 1, "held": False, "why": [], "at": now}) + "\n")
        (self.data / "reviews" / f"{self.bid}.json").write_text(json.dumps(
            {"batch": self.bid, "read_as_recipient": True, "reviewer": "test reviewer"}))
        (self.data / "drafts.json").write_text(json.dumps([{"company": "Solo", "batch": self.bid}]))
        self.gws = self.dir / "gws"
        who = "jane@northwind.example.test" if signed_in else ""
        self.gws.write_text("#!/bin/sh\n" + (f"echo '{{\"emailAddress\": \"{who}\"}}'\n" if who
                                            else "echo 'not signed in' >&2; exit 1\n"))
        self.gws.chmod(0o755)
        self.clients = self.dir / "clients.json"
        self.clients.write_text(json.dumps({"clients": [{"name": "Solo", "sender_company": "Northwind",
                                                         "state_dir": str(self.led),
                                                         "no_client": "Northwind runs its own outbound"}]}))
        (self.dir / "inbox.json").write_text("[]")
        (self.dir / "slack.json").write_text(json.dumps({"D1": []}))

    def run(self):
        env = dict(os.environ, HOME=str(self.home), GTME_CLIENTS=str(self.clients),
                   CHEWBACCA_GTM_CLIENTS=str(self.clients), GTM_CONFIG=str(self.clients),
                   CHEWBACCA_GWS_BIN=str(self.gws),
                   GTME_GRADE_KEY_FILE=str(self.home / "keys" / "gtme-grade.key"))
        env.pop("CHEWBACCA_STATE_DIR", None)
        return subprocess.run([sys.executable, str(TOOL), "--client", "Solo", "--drafts",
                               str(self.data / "drafts.json"), "--inbox", str(self.dir / "inbox.json"),
                               "--slack", str(self.dir / "slack.json")],
                              capture_output=True, text=True, env=env, timeout=180)


s = Ledger()
p = s.run()
check("a clean own-inbox batch is READY with no Clay workspace", p.returncode == 0 and "READY:" in p.stdout,
      p.stdout + p.stderr)
s = Ledger(verdict="")
p = s.run()
check("an address with no verifier verdict fails the list gate",
      p.returncode == 1 and "no valid verifier verdict" in p.stdout, p.stdout + p.stderr)
s = Ledger(signed_in=False)
p = s.run()
check("a sending inbox that isn't signed in fails the render gate",
      p.returncode == 1 and "is not signed in" in p.stdout, p.stdout + p.stderr)
s = Ledger()
b = s.led / "batches" / f"{s.bid}.json"
doc = json.loads(b.read_text())
doc["mails"][0]["body"] = doc["mails"][0]["body"].replace("3 fixes", "4 fixes")
b.write_text(json.dumps(doc))
p = s.run()
check("a batch edited after it was built fails the start gate",
      p.returncode == 1 and "was edited after it was built" in p.stdout, p.stdout + p.stderr)
(s.data / "reviews" / f"{s.bid}.json").unlink()
p = s.run()
check("a batch nobody read as the recipient is NOT READY", p.returncode == 1 and "recipient read" in p.stdout,
      p.stdout + p.stderr)

s = Ledger()
(s.data / "drafts.json").write_text(json.dumps([{"company": "Solo", "batch": s.bid, "campaign": "cam_sneaky1"}]))
p = s.run()
check("an entry naming a batch and a campaign is graded as the campaign, never READY on the batch alone",
      p.returncode != 0 and "READY:" not in p.stdout, p.stdout + p.stderr)

print(f"\n{'all passed' if not fails else str(fails) + ' failed'}")
sys.exit(1 if fails else 0)
