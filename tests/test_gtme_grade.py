"""gtme-grade: each of the five gates fails on purpose, and only a clean campaign passes.

Every fixture is synthetic: example.test domains, invented names, fake ids.
Nothing reads Clay. Run: python3 tests/test_gtme_grade.py
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
TOOL = ROOT / "tools" / "gtme_grade.py"

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


def clay_doc(copy_path, settings):
    """The fixture copy in the shape `chewbacca clay campaign` returns."""
    sys.path.insert(0, str(ROOT / "tools"))
    import gtme_grade
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
    return {"id": "cam_test1", "name": "test", "status": "draft", "sequence": seq,
            "settings": dict(settings, senderAccountIds=[])}


class Case:
    def __init__(self):
        # resolved: macOS temp dirs sit behind the /var -> /private/var symlink
        self.dir = Path(os.path.realpath(tempfile.mkdtemp()))
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

    def run(self, mode="clay"):
        d = self.dir
        (d / "copy.txt").write_text(self.copy)
        (d / "campaign.json").write_text(json.dumps(clay_doc(d / "copy.txt", self.settings)))
        write_csv(d / "leads.csv", self.leads)
        write_csv(d / "senders.csv", self.senders)
        write_csv(d / "suppress.csv", self.suppress)
        (d / "settings.json").write_text(json.dumps(self.settings))
        (d / "review.json").write_text(json.dumps(self.review))
        src = ({"--campaign-json": d / "campaign.json", "--action": "launch"} if mode == "clay" else
               {"--copy": d / "copy.txt", "--name": "test-campaign", "--settings": d / "settings.json"})
        args = {**src, "--leads": d / "leads.csv",
                "--senders": d / "senders.csv", "--suppress": d / "suppress.csv",
                "--review": d / "review.json",
                "--icp-titles": "partner,principal",
                "--sender-company": "Northwind Partners", "--offer": "payments seed rounds"}
        argv = [sys.executable, str(TOOL), "--json"]
        for k, v in args.items():
            if k not in self.drop:
                argv += [k, str(v)]
        argv += self.extra
        env = dict(os.environ, HOME=str(self.home), GTME_CLIENTS=str(d / "clients.json"),
                   GTME_GRADE_KEY_FILE=str(self.home / "keys" / "gtme-grade.key"),
                   GTME_GRADE_INPUT_ROOTS=os.path.realpath(str(d)))
        self.env = env
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


# 1. a clean campaign passes all five gates and writes a signed receipt bound to
#    the workspace, the campaign, the action, every input and the campaign state
c = Case()
rc, out = c.run()
gdir = c.home / ".chewbacca" / "state" / "gtme-grade"
receipt = gdir / "1372623-cam_test1-launch.json"
detail = json.dumps([g for g in out.get("gates", []) if not g["pass"]], indent=1)[:1500] or out
check("clean campaign passes every gate", rc == 0 and out.get("pass") is True, detail)
check("a pass writes a receipt named for workspace, campaign and action", receipt.is_file(),
      list(gdir.glob("*")) if gdir.exists() else "no dir")
if receipt.is_file():
    r = json.loads(receipt.read_text())
    check("the receipt binds action, campaign, workspace, inputs, state and a signature",
          r["action"] == "launch" and r["campaign"] == "cam_test1" and r["workspace"] == "1372623"
          and {Path(p).name for p in r["inputs"]} >= {"campaign.json", "leads.csv", "senders.csv",
                                                        "suppress.csv", "review.json"}
          and len(r["campaign_state"]) == 64 and len(r["mac"]) == 64
          and r["expires"] - r["time"] == 12 * 3600, r)
    check("the receipt is readable by its owner only", receipt.stat().st_mode & 0o077 == 0)
    key = c.home / "keys" / "gtme-grade.key"
    check("the key is created 0600, outside the repo", key.is_file() and key.stat().st_mode & 0o777 == 0o600)
    fx = c.dir / "fixtures"
    fx.mkdir()
    (fx / "cam_test1.json").write_text((c.dir / "campaign.json").read_text())
    venv = dict(c.env, GTME_GRADE_CLAY_FIXTURE_DIR=str(fx))
    # --verify also wants the client's full pre-send gate receipt.
    presend_in = c.home / "presend.csv"
    presend_in.write_text("email\n")
    (c.home / ".chewbacca" / "state" / "send-gate-receipt.json").write_text(json.dumps(
        {"time": int(time.time()), "full": True,
         "hashes": {str(presend_in): hashlib.sha256(b"email\n").hexdigest()}}))

    def verify(action="launch", campaign="cam_test1", ws="1372623"):
        return subprocess.run([sys.executable, str(TOOL), "--verify", "--ws", ws, "--campaign", campaign,
                               "--action", action], capture_output=True, text=True, env=venv, timeout=60)

    v = verify()
    check("--verify passes the exact action, campaign and workspace", v.returncode == 0, v.stderr)
    check("--verify refuses another action", verify(action="resume").returncode == 2)
    check("--verify refuses another workspace", verify(ws="42").returncode == 2)
    with open(c.dir / "leads.csv", "a") as fh:
        fh.write("dan@fundfour.example.test,Dan,Fund Four,Partner,valid,x,https://x.example.test\n")
    v = verify()
    check("--verify refuses once a graded input changes", v.returncode == 2 and "changed" in v.stderr, v.stderr)

c = Case()
c.run()
real = c.dir / "leads.real.csv"
(c.dir / "leads.csv").rename(real)
(c.dir / "leads.csv").symlink_to(real)
for f in (c.home / ".chewbacca" / "state" / "gtme-grade").glob("*"):
    f.unlink()
rc, out = c.run()
check("a symlinked input gets no receipt", rc == 2 and
      not any((c.home / ".chewbacca" / "state" / "gtme-grade").glob("*.json")), (rc, out))

c = Case()
c.run()
for f in (c.home / ".chewbacca" / "state" / "gtme-grade").glob("*"):
    f.unlink()
# The inputs live in c.dir; allowing only c.home puts every one of them outside.
p = subprocess.run([sys.executable, str(TOOL), "--campaign-json", str(c.dir / "campaign.json"),
                    "--action", "launch", "--leads", str(c.dir / "leads.csv"), "--senders",
                    str(c.dir / "senders.csv"), "--suppress", str(c.dir / "suppress.csv"),
                    "--review", str(c.dir / "review.json"), "--icp-titles", "partner,principal",
                    "--sender-company", "Northwind Partners", "--offer", "payments seed rounds"],
                   capture_output=True, text=True, timeout=60,
                   env=dict(c.env, GTME_GRADE_INPUT_ROOTS=str(c.home)))
check("an input outside the allowed roots gets no receipt",
      p.returncode == 2 and "outside the allowed input roots" in p.stderr, p.stderr[:200])

c = Case()
rc, out = c.run(mode="copy")
check("local copy can pass but never writes a receipt that could unlock a Clay campaign",
      rc == 0 and out.get("pass") is True and not out.get("receipt")
      and not (c.home / ".chewbacca" / "state" / "gtme-grade").exists(), out.get("receipt"))


def expect_fail(name, gate_no, mutate, needle):
    c = Case()
    mutate(c)
    rc, out = c.run()
    if "gates" not in out:
        check(name, False, out)
        return
    g = gate(out, gate_no)
    text = " ".join(g["fails"] + g["not_checked"])
    gdir = c.home / ".chewbacca" / "state" / "gtme-grade"
    check(name, rc == 1 and not g["pass"] and needle.lower() in text.lower()
          and not (gdir.exists() and any(gdir.iterdir())), text[:300])


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


def big_good_list(c):
    rows = [c.leads[0]]
    for i in range(120):
        rows.append([f"p{i}@firm{i}.example.test", "Pat", f"Firm {i}", "Partner", "valid",
                     f"your seed {i}", f"https://firm{i}.example.test"])
    c.leads = rows
    c.drop.add("--icp-titles")


# 2026-10-11: an unchecked dimension scored 0 and turned a clean list into a "D".
c = Case()
big_good_list(c)
rc, out = c.run()
g1 = gate(out, 1) if "gates" in out else {"fails": ["no gates"], "not_checked": [], "pass": True}
check("gate 1: an unchecked title match stays NOT CHECKED and never fakes a low score",
      not g1["pass"] and any("title match" in x for x in g1["not_checked"])
      and not any("below B" in x for x in g1["fails"]), g1)

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

# 2026-10-11, three Vertocol leads loaded for Monday: UTF-8 read as Mac Roman
# ("Mittelst√§ndische"), as Mac Cyrillic (a Russian LLC), and as cp1252 ("Oâ€™Neill").
expect_fail("gate 4: a first name garbled through Mac Roman refuses", 4,
            lambda c: c.leads[1].__setitem__(1, "Mittelst√§ndische"), "garbled text")
expect_fail("gate 4: a first name garbled through Mac Cyrillic refuses", 4,
            lambda c: c.leads[1].__setitem__(1, "–Ю–Ю–Ю"), "garbled text")
expect_fail("gate 4: a merge field garbled through cp1252 refuses", 4,
            lambda c: c.leads[2].__setitem__(5, "Oâ€™Neill's seed"), "garbled text")


def with_full_names(c, bad):
    c.leads[0].append("full_name")
    for row, name in zip(c.leads[1:], ["Ann Lee", "Bo Park", "Cy Diaz"]):
        row.append(name)
    c.leads[2][-1] = bad


expect_fail("gate 4: a company loaded as the person refuses", 4,
            lambda c: with_full_names(c, "Mittelständische Beteiligungsgesellschaft Sachsen"),
            "name is a company")
expect_fail("gate 4: a garbled Russian LLC loaded as the person refuses", 4,
            lambda c: with_full_names(c, "–Ю–Ю–Ю ¬Ђ–£—А–∞–ї-–Ш–љ–≤–µ—Б—В-–Ъ–∞–њ–Є—В–∞–ї¬ї"),
            "name is a company")

# A real accented name is not garbled text and not a company.
c = Case()
c.leads[1][1] = "José"
with_full_names(c, "Zoë Brontë")
rc, out = c.run()
g4 = gate(out, 4) if "gates" in out else {"fails": ["no gates"]}
check("gate 4: José and Zoë Brontë render clean, no garbled or company flag",
      not any("garbled" in x or "company" in x for x in g4["fails"]), g4["fails"])

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

# Sagar's review, folded into gates 1 and 2. The subjects are the real ones from
# 2026-10-11: Zeutara shipped "Question" from 9/28 until the subjects were re-cut
# to his stacked nouns, "Chicago dating app pre-seed" among them.
def subject(s):
    return lambda c: setattr(c, "copy", c.copy.replace("Subject: your payments seed checks",
                                                       f"Subject: {s}"))


def lines(out, n, kind):
    g = gate(out, n) if "gates" in out else {"fails": [], "warnings": [], "not_checked": []}
    return [x for x in g[kind] if "Sagar" in x or kind == "not_checked"]


for bad in ("Question", "Quick question", "Hi", "Intro"):
    expect_fail(f"Sagar: subject \"{bad}\" refuses", 2, subject(bad), "names no offer")
expect_fail("Sagar: a one-word subject refuses even when it is a noun", 2, subject("Payments"),
            "one word cannot stack")

c = Case()
subject("Chicago dating app pre-seed")(c)
c.extra += ["--offer", "Chicago dating app pre-seed round"]
c.drop.add("--offer")
rc, out = c.run()
check("Sagar: subject \"Chicago dating app pre-seed\" passes every gate",
      rc == 0 and out.get("pass") is True and not lines(out, 2, "fails"),
      json.dumps([g for g in out.get("gates", []) if not g["pass"]])[:600])

expect_fail("Sagar: a subject about something other than the offer refuses", 2,
            subject("Chicago dating app raise"), "shares no word with the offer")
expect_fail("Sagar: email 1 that never names the offer refuses", 2,
            lambda c: c.extra.extend(["--offer", "mortgage underwriting software"])
            or c.drop.add("--offer"), "never names the offer")
expect_fail("Sagar: no --offer is NOT CHECKED, never a pass", 2, lambda c: c.drop.add("--offer"),
            "NOT CHECKED what is sold")
expect_fail("Sagar: email 1 that never names its company refuses", 2,
            lambda c: setattr(c, "copy", c.copy.replace("Jane Doe, Northwind Partners", "Jane Doe", 1)),
            "never names the company")
expect_fail("Sagar: no sender company anywhere is NOT CHECKED", 2,
            lambda c: c.drop.add("--sender-company"), "NOT CHECKED email 1 sender company")
expect_fail("Sagar: email 1 that never names the sender refuses", 2,
            lambda c: setattr(c, "copy", c.copy.replace("Jane Doe, Northwind Partners", "Northwind Partners", 1)),
            "never says who it is from")


def no_signal(c):
    c.copy = c.copy.replace("{{first_name}}, saw {{signal}} on your fund's site.",
                            "{{first_name}}, saw your fund's site.", 1)
    for row in c.leads:
        del row[5]


c = Case()
no_signal(c)
rc, out = c.run()
check("Sagar: no signal field and no per-lead line in email 1 warns 'signals leading messaging'",
      any("signals leading messaging" in x for x in lines(out, 2, "warnings")), lines(out, 2, "warnings"))
c = Case()
no_signal(c)
c.leads[0][5] = "segment"
for i, row in enumerate(c.leads[1:]):
    row[5] = "backs payments seed"
rc, out = c.run()
check("Sagar: a list cut by a segment field does not warn on signals",
      not any("signals leading" in x for x in lines(out, 2, "warnings")), lines(out, 2, "warnings"))
c = Case()
rc, out = c.run()
check("Sagar: a per-lead line in email 1 does not warn on signals",
      not any("signals leading" in x for x in lines(out, 2, "warnings")), lines(out, 2, "warnings"))
c = Case()
no_signal(c)
c.drop.add("--leads")
rc, out = c.run()
check("Sagar: no leads and no per-lead line leaves signals NOT CHECKED",
      any("signals leading messaging" in x for x in gate(out, 2)["not_checked"]), gate(out, 2)["not_checked"])

c = Case()
c.copy = c.copy.replace("You keep every decision", "Our consulting services and solutions mean you keep every decision")
rc, out = c.run()
check("Sagar: abstract offer words in email 1 warn", any("abstractions" in x for x in lines(out, 2, "warnings")),
      lines(out, 2, "warnings"))


def relation(c, value):
    c.leads[0].append("relationship")
    for row in c.leads[1:]:
        row.append("cold")
    c.leads[2][-1] = value


expect_fail("Sagar: a lead the sender knows directly refuses (text them instead)", 1,
            lambda c: relation(c, "1st"), "known to the sender")
c = Case()
relation(c, "2nd")
rc, out = c.run()
check("Sagar: second-degree and cold leads pass the relationship check",
      rc == 0 and not lines(out, 1, "fails") and not any("relationship" in x for x in lines(out, 1, "warnings")),
      lines(out, 1, "fails") + lines(out, 1, "warnings"))
c = Case()
rc, out = c.run()
check("Sagar: no relationship column warns", any("relationship-to-sender" in x for x in lines(out, 1, "warnings")),
      lines(out, 1, "warnings"))


def last_sent(c):
    c.leads[0].append("zeutara_last_sent")
    for row in c.leads[1:]:
        row.append("")
    c.leads[1][-1] = "2026-10-06"


expect_fail("Sagar: a lead with a last-sent date refuses", 1, last_sent, "last-sent date")
c = Case()
c.leads.append(["dee@fundone.example.test", "Dee", "Fund One", "Partner", "valid", "your Ledgerly seed",
                "https://fundone.example.test/portfolio"])
rc, out = c.run()
check("Sagar: two leads at one company warn (dedupe at the company level)",
      any("company level" in x for x in lines(out, 1, "warnings")), lines(out, 1, "warnings"))

sys.path.insert(0, str(ROOT / "tools"))
import gtme_grade as G  # noqa: E402

check("Sagar: subject_problem passes the 10-11 Zeutara subjects",
      not any(G.subject_problem(s) for s in ("Chicago dating app pre-seed", "Payments identity seed round",
                                             "Medtech regulatory AI pre-seed", "Mushroom coffee brand raise")),
      [G.subject_problem(s) for s in ("Chicago dating app pre-seed", "Payments identity seed round")])
check("Sagar: subject_problem refuses what shipped before",
      all(G.subject_problem(s) for s in ("Question", "Quick question", "Hi", "Intro", "Re: Question",
                                         "Quick thought for you")))

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
