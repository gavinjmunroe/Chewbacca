"""gtme-grade: each of the five gates fails on purpose, and only a clean campaign passes.

Every fixture is synthetic: example.test domains, invented names, fake ids.
Nothing reads Clay. Run: python3 tests/test_gtme_grade.py
"""
import csv
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "tools" / "gtme_grade.py"

COPY = """Subject: your payments seed checks

{{first_name}}, saw {{signal}} on your fund's site.

Your fund backed three payments teams at seed, and you led two of those rounds yourself.

You would see the 4 investors who joined similar rounds within 30 days, and you would read a one-page summary before any call.

You keep every decision, and you can pass in one line.

Worth a look?

Reply stop and I'll stop.

Jane Doe
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
SENDERS = [
    ["id", "email", "displayName", "warmup_days", "health"],
    ["s1", "jane@outreach-one.example.test", "Jane Doe", "30", "95"],
    ["s2", "jane@outreach-two.example.test", "Jane Doe", "30", "95"],
]
SETTINGS = {"trackingSettings": {"trackEmailOpen": False, "trackLinkClick": False},
            "scheduleSettings": {"daysOfWeek": ["mon", "tue", "wed", "thu", "fri"],
                                 "startHour": "09:00", "endHour": "17:00", "timezone": "America/New_York"},
            "autoPauseDomainLeadsOnReply": True, "isHtmlEnabled": False}


def write_csv(path, rows):
    with open(path, "w", newline="") as fh:
        csv.writer(fh).writerows(rows)


class Case:
    def __init__(self):
        self.dir = Path(tempfile.mkdtemp())
        self.home = self.dir / "home"
        self.home.mkdir()
        self.copy = COPY
        self.leads = [r[:] for r in LEADS]
        self.senders = [r[:] for r in SENDERS]
        self.settings = json.loads(json.dumps(SETTINGS))
        self.review = {"campaign": None, "reviewer": "test reviewer",
                       "reviewed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                       "unresolved": []}
        self.suppress = [["email"], ["old@fundnine.example.test"]]
        self.extra = []
        self.drop = set()

    def run(self):
        d = self.dir
        (d / "copy.txt").write_text(self.copy)
        write_csv(d / "leads.csv", self.leads)
        write_csv(d / "senders.csv", self.senders)
        write_csv(d / "suppress.csv", self.suppress)
        (d / "settings.json").write_text(json.dumps(self.settings))
        (d / "review.json").write_text(json.dumps(self.review))
        args = {"--copy": d / "copy.txt", "--name": "test-campaign", "--leads": d / "leads.csv",
                "--senders": d / "senders.csv", "--suppress": d / "suppress.csv",
                "--settings": d / "settings.json", "--review": d / "review.json",
                "--icp-titles": "partner,principal"}
        argv = [sys.executable, str(TOOL), "--json"]
        for k, v in args.items():
            if k not in self.drop:
                argv += [k, str(v)]
        argv += self.extra
        env = dict(os.environ, HOME=str(self.home), GTME_CLIENTS=str(d / "clients.json"))
        p = subprocess.run(argv, capture_output=True, text=True, env=env, timeout=60)
        try:
            out = json.loads(p.stdout)
        except ValueError:
            out = {"error": p.stderr}
        return p.returncode, out


def gate(out, n):
    return next(g for g in out["gates"] if g["gate"] == n)


results = []


def check(name, cond, detail=""):
    results.append(cond)
    print(f"{'ok  ' if cond else 'FAIL'} {name}" + ("" if cond else f"  {detail}"))


# 1. a clean campaign passes all five gates and writes a receipt with hashes
c = Case()
rc, out = c.run()
receipt = c.home / ".chewbacca" / "state" / "gtme-grade" / "test-campaign.json"
detail = json.dumps([g for g in out.get("gates", []) if not g["pass"]], indent=1)[:1500] or out
check("clean campaign passes every gate", rc == 0 and out.get("pass") is True, detail)
check("a pass writes a receipt", receipt.is_file())
if receipt.is_file():
    r = json.loads(receipt.read_text())
    check("the receipt hashes every input", len(r["hashes"]) >= 6 and r["pass"] is True, r)


def expect_fail(name, gate_no, mutate, needle):
    c = Case()
    mutate(c)
    rc, out = c.run()
    if "gates" not in out:
        check(name, False, out)
        return
    g = gate(out, gate_no)
    text = " ".join(g["fails"] + g["not_checked"])
    receipt = c.home / ".chewbacca" / "state" / "gtme-grade" / "test-campaign.json"
    check(name, rc == 1 and not g["pass"] and needle.lower() in text.lower()
          and not receipt.exists(), text[:300])


# Gate 1, the list
expect_fail("gate 1: an unverified row refuses", 1,
            lambda c: c.leads[1].__setitem__(4, "catch-all"), "not verified")
expect_fail("gate 1: a duplicate address refuses", 1,
            lambda c: c.leads.append(c.leads[1][:]), "duplicate")
expect_fail("gate 1: a suppressed address refuses", 1,
            lambda c: c.suppress.append([c.leads[2][0]]), "suppression list")
expect_fail("gate 1: no suppression file is NOT CHECKED, never a pass", 1,
            lambda c: c.drop.add("--suppress"), "NOT CHECKED suppression")
expect_fail("gate 1: a role inbox refuses", 1,
            lambda c: c.leads[3].__setitem__(0, "info@fundthree.example.test"), "role inboxes")


def big_list(c):
    rows = [c.leads[0]]
    for i in range(120):
        rows.append([f"p{i}@firm{i}.example.test", "Pat", f"Firm {i}", "Executive Assistant", "valid",
                     f"your seed {i}", f"https://firm{i}.example.test"])
    c.leads = rows


expect_fail("gate 1: 120 assistants score under B and refuse", 1, big_list, "never upload below B")

# Gate 2, the copy
expect_fail("gate 2: an em dash refuses", 2,
            lambda c: setattr(c, "copy", c.copy.replace("Worth a look?", "Worth a look — or not?")),
            "em dash")
expect_fail("gate 2: a spam-list word refuses", 2,
            lambda c: setattr(c, "copy", c.copy.replace("on your fund's site", "on your new site")),
            "spam-list")
expect_fail("gate 2: a sender-first opener refuses", 2,
            lambda c: setattr(c, "copy", c.copy.replace("{{first_name}}, saw {{signal}} on your fund's site.",
                                                          "I'm Jane, and we run a fund network.", 1)),
            "line one carries no recipient-specific signal")
expect_fail("gate 2: two questions refuse", 2,
            lambda c: setattr(c, "copy", c.copy.replace("Worth a look?", "Worth a look? Is Tuesday free?")),
            "questions")
expect_fail("gate 2: a follow-up pointing back refuses", 2,
            lambda c: setattr(c, "copy", c.copy.replace("{{first_name}}, since {{signal}}",
                                                          "One more thing: since {{signal}}")),
            "pointing at the earlier email")

# Gate 3, the recipient read
expect_fail("gate 3: no recorded read is NOT CHECKED", 3, lambda c: c.drop.add("--review"),
            "NOT CHECKED recipient read")
expect_fail("gate 3: an unresolved objection refuses", 3,
            lambda c: c.review.__setitem__("unresolved", ["no proof the fund led those rounds"]),
            "unresolved")
expect_fail("gate 3: a read older than 12 hours refuses", 3,
            lambda c: c.review.__setitem__("reviewed_at", "2020-01-01T00:00:00Z"), "12 hours")

# Gate 4, the rendered output
expect_fail("gate 4: a blank merge field refuses", 4,
            lambda c: c.leads[2].__setitem__(5, ""), "empty on 1 leads")
expect_fail("gate 4: an enrichment leak refuses", 4,
            lambda c: c.leads[2].__setitem__(5, "NONE"), "enrichment leak")
expect_fail("gate 4: an unsourced line refuses", 4,
            lambda c: c.leads[1].__setitem__(6, "from my notes"), "no public source")
expect_fail("gate 4: a zero-day follow-up refuses", 4,
            lambda c: setattr(c, "copy", c.copy.replace("Delay: 3", "Delay: 0")), "zero-day")
expect_fail("gate 4: a raw CRM first name refuses", 4,
            lambda c: c.leads[1].__setitem__(1, "BO SMITH"), "raw CRM")

# Gate 5, infrastructure and the start
expect_fail("gate 5: open tracking refuses", 5,
            lambda c: c.settings["trackingSettings"].__setitem__("trackEmailOpen", True), "tracking")
expect_fail("gate 5: no opt-out refuses", 5,
            lambda c: setattr(c, "copy", c.copy.replace("Reply stop and I'll stop.\n", "")), "opt-out")
expect_fail("gate 5: a young inbox refuses", 5,
            lambda c: c.senders[1].__setitem__(3, "5"), "warmup")
expect_fail("gate 5: missing warmup data is NOT CHECKED", 5,
            lambda c: [r.__setitem__(3, "") for r in c.senders[1:]] and None, "NOT CHECKED warmup")


def crowded(c):
    for i in range(6):
        c.senders.append([f"x{i}", f"j{i}@outreach-one.example.test", "Jane Doe", "30", "95"])


expect_fail("gate 5: six inboxes on one domain refuse", 5, crowded, "more than 5 inboxes")


def refused(c):
    c.extra += ["--refuse-sender", r"@outreach-two\."]


expect_fail("gate 5: a client-refused inbox refuses", 5, refused, "refused")
expect_fail("gate 5: the primary domain refuses", 5,
            lambda c: c.extra.extend(["--primary-domain", "outreach-one.example.test"]), "primary domain")

# The Clay document shape converts: spintax, lead fields, threading
doc = {"id": "cam_test", "name": "t", "settings": SETTINGS, "sequence": [
    {"order": 0, "delayDays": 0, "emailType": "NEW_EMAIL_THREAD",
     "subject": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "a b"}]}]},
     "body": {"type": "doc", "content": [{"type": "paragraph", "content": [
         {"type": "spintax", "attrs": {"variants": ["Hi", "Hello"]}}, {"type": "text", "text": " "},
         {"type": "leadField", "attrs": {"fieldId": "first_name"}}]}]}}]}
sys.path.insert(0, str(ROOT / "tools"))
import gtme_grade  # noqa: E402

camp = gtme_grade.campaign_from_clay(doc)
st = camp["variants"][0]["steps"][0]
check("Clay doc: spintax renders every option and lead fields become tokens",
      st["renders"] == ["Hi {{first_name}}\n", "Hello {{first_name}}\n"] and st["subject"] == "a b", st)

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
