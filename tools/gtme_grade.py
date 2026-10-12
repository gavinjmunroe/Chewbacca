#!/usr/bin/env python3
"""gtme-grade: run the playbook's five pre-send gates on one campaign, and refuse.

THE FAILURE THIS EXISTS FOR. By 2026-10-09 the kit held about a hundred sourced
outbound rules, a five-gate grading section and forty GTM skills, and none of
it had touched a live campaign. Applied to Zeutara on 2026-10-10 it found, among
other things, 362 of 1,778 messages sent from 30 inboxes the pre-send gate had
never seen (two of them on domains the client refused on 10-04), because the
gate read a sender file and the campaigns carried their own sender list. A rule
that is only written down does not run. This runs them before Caleb presses
Start in Clay, and `chewbacca clay` refuses add-leads without a pass from here.

    gtme-grade --campaign cam_x --action launch --leads send.csv --suppress sent.csv \\
               --senders sender-accounts.json --warmup-start 2026-10-02 \\
               --icp-titles partner,principal --review review.json
    gtme-grade --campaign-json saved.json ...      a saved `chewbacca clay campaign` answer
    gtme-grade --copy copy.txt --name launch-1 ... local copy, no Clay at all

The five gates, in the playbook's order
(skills/gtm-engineering/references/demand-gen-playbooks.md, "Grading a
campaign before it goes out"):

  1 list       Growth Engine X's eight-dimension scorecard plus Instantly's
               blocking rules: every row verified, no duplicates, nothing
               suppressed, no role inboxes, at most 3 per domain.
  2 copy       Growth Engine X's 0-100 rubric per email (85 ships) and its QA
               list, the spam-word list, one CTA, follow-ups that stand alone.
               The rubric's judgement items are scored from text features, so
               a score here is a floor for gate 3's read, never a substitute.
  3 read       a recipient read recorded in --review with nothing unresolved.
  4 render     every variant and step rendered against every lead (lastlook).
  5 start      tracking, schedule, opt-out, the senders the campaign actually
               carries, mailboxes per domain, warmup age, live bounce rate.

Sagar Tiwari's review runs inside gates 1 and 2, each line cited "[Sagar <date>
<source>]": the subject is stacked concrete nouns about the offer, never
"Question"; email 1 says who it is from (person and company) and what is sold;
signals lead messaging; warm relationships get a text, not a cold email; nobody
is emailed twice. --sender-name, --sender-company, --offer and --signal supply
what the copy alone cannot show, and --client fills the first two from
clients.json (principal, sender_company or name). His rules that are judgement,
not data, live with their quotes in
skills/gtm-engineering/references/sagar.md.

Every check that could not run prints NOT CHECKED and fails its gate, because a
skipped rule never counts as a pass (lastlook, same section). Exit 0 only when
all five gates pass, 1 when any fails, 2 on bad arguments.

A pass with --action (launch, resume or add-leads) on a Clay campaign writes
~/.chewbacca/state/gtme-grade/<workspace>-<campaign>-<action>.json, 0600: the
workspace, campaign and action, a 12-hour expiry, a sha256 of every input file
and of the campaign's own state (sequence, variants, settings, senders), all
signed with an HMAC key kept 0600 outside the repo and outside ~/.chewbacca
(~/Library/Application Support/chewbacca/gtme-grade.key, made on first use).
`--verify` re-checks one receipt against the current files and a fresh read of
the campaign. `chewbacca clay` calls it on an add-leads request's own
workspace, campaign and audience, after the person approves and before it
sends, and refuses on any mismatch or error. A campaign START is never sent by
the kit: Caleb runs this, reads the verdict, and presses Start in Clay himself.
Local --copy grades never write a receipt, since nothing ties them to a Clay
campaign. Nothing else is written. This never sends, never edits a
campaign and never spends a credit: Clay is only read through `chewbacca clay`.
"""
import argparse
import csv
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
STATE = Path(os.path.expanduser("~/.chewbacca/state/gtme-grade"))
PLAYBOOK = "demand-gen-playbooks.md"
GEX_LIST = "GEX list-quality-scorecard"
GEX_COPY = "GEX campaign-copywriting"
GEX_SPAM = "GEX spam-word-checker"
GEX_LAUNCH = "GEX 12-launch-checklist"
INSTANTLY = "Instantly list-quality-scorecard"
LASTLOOK = "lastlook README"

VERIFIED = {"valid", "verified", "deliverable", "ok", "safe", "safe_to_send"}
CATCH_ALL = {"catch-all", "catch_all", "catchall", "accept_all", "accept-all", "risky"}
ROLE = re.compile(r"^(info|contact|admin|hello|hi|team|office|support|sales|enquiries|inquiries|"
                  r"ir|investors|invest|deals|dealflow|pitch|careers|jobs|hr|press|media|"
                  r"marketing|billing|accounts|noreply|no-reply)@", re.I)
FREE = {"gmail.com", "googlemail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com",
        "me.com", "aol.com", "live.com", "msn.com", "proton.me", "protonmail.com"}
BAD_TITLE = re.compile(r"\b(intern|assistant|coordinator|student|part[- ]time|retired)\b", re.I)
COMMUNITY = re.compile(r"\b(pavilion|exit five)\b", re.I)

# GEX spam-word-checker (MIT), copied as data. Single words match on the root,
# so "cash-cycle" still counts as "cash", which is the skill's own rule.
SPAM_WORDS = ("get bank credit access open compare problem now billing deal finance financial "
              "claims insurance mortgage soon new performance freedom home sales medical urgent "
              "life marketing investment diagnostics friend cash invoice extra purchase").split()
SPAM_PHRASES = [
    "off chance", "one time", "all good", "following up here", "last note from me here",
    "great fit", "bumping this once", "just following up once", "circle back",
    "one more quick follow-up", "keep this open", "compare notes", "appreciate the reply",
    "act now", "apply now", "click here", "free consultation", "free trial", "limited time",
    "special offer", "guaranteed", "risk-free", "no obligation", "increase revenue",
    "increase sales", "make money", "today", "immediately", "the best", "amazing", "promise",
    "i hope this email finds you well", "i wanted to reach out", "i hope you're doing well",
    "just wanted to touch base", "our solution", "would love to schedule", "let's hop on a call",
    "can i get 15 minutes",
]
# Silence must never stop the sequence (spam-word-checker, closeout rules).
SILENCE_STOP = re.compile(r"(take silence as|no reply as a pass|no response means|if i don'?t hear "
                          r"back,? i('| wi)ll (leave|let|stop))", re.I)
# Follow-ups must stand alone (campaign-copywriting hard rule 5, playbook GEX pack).
WEAK_FOLLOWUP = re.compile(r"^\W*(\w+\W+){0,3}?(following up|just checking in|checking in|one more "
                           r"(thought|fact|thing|note)|quick one|bumping|circling back|as i mentioned|"
                           r"my (last|previous) (note|email))", re.I)
CALENDAR_ASK = re.compile(r"(\b\d+\s*(min|minute)s?\b|calendar|schedule a|this week|next week|"
                          r"hop on a call|book a time)", re.I)
YES_NO = re.compile(r"^(would|is|are|do|does|worth|open|could|can|should|want|any|interested|"
                    r"make sense|mind)\b", re.I)
SENDER_FIRST = re.compile(r"^(i'm|i am|my name|we |we're|our |i work|i run|i co-?founded)", re.I)
ADDRESS = re.compile(r"\b\d{1,6}\s+[A-Z][\w.]*(\s[\w.]+){0,4}\s(st|street|ave|avenue|rd|road|blvd|"
                     r"suite|ste|drive|dr|lane|way|place|pl)\b", re.I)
OPT_OUT = re.compile(r"(unsubscribe|opt[- ]out|say the word|tell me to stop|i'?ll stop|remove you|"
                     r"step out of your inbox|rather i stopped)", re.I)
LEAK = re.compile(r"(\bnone\b|\bn/?a\b|\bnull\b|\bundefined\b|couldn'?t find|could not find|"
                  r"not available|no information|unknown|\{\{|\}\}|\[\w)", re.I)
INVISIBLE = re.compile("[​‌‍⁠﻿­]")
ORG_AS_PERSON = re.compile(r"\b(llc|l\.l\.c|inc|ltd|limited|gmbh|corp|corporation|holdings|capital|ventures|"
                           r"partners|fund|group|mbh|ооо|оао|зао|пао)\b|gesellschaft|[«»]", re.I)


def repair(text):
    """The text as its writer typed it, when an export re-read UTF-8 as a one-byte
    code page. On 2026-10-11 a Vertocol lead was loaded with its name as UTF-8
    Cyrillic read as Mac Roman, so the first name rendered as garbage. A real name
    like "José" never survives this round trip, so a clean repair means the value
    was garbled. Returns None when the text is fine."""
    if not text or text.isascii():
        return None
    for enc in ("mac_roman", "mac_cyrillic", "cp1252", "latin-1"):
        try:
            fixed = text.encode(enc).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        if fixed != text:
            return fixed
    return None
PLACEHOLDER = re.compile(r"(\[[A-Z][^\]]*\]|\bXXX\b|lorem ipsum|\bTODO\b|(?<!\{)\{(first|company)\w*\}(?!\}))", re.I)
URL = re.compile(r"^https?://\S+\.\S+", re.I)
BASE_FIELDS = {"first_name", "last_name", "full_name", "company", "company_name", "email"}

# 20 seconds read aloud: the pack gives no reading rate. At 4.5 words a second
# its own 90-word ceiling takes exactly 20 seconds, the only rate at which the
# QA line and the 50-90 word target agree, so that is the rate used.
READ_ALOUD_WORDS = 90
# Freshness of a recorded recipient read, same window as launch-guard: lists
# and copy change overnight.
REVIEW_MAX_AGE_S = 12 * 3600
# Mailboxes per domain: about 3, 5 at most (Clay W-070, W-171; Instantly's done-
# for-you API caps Google at 5). Warmup: three weeks (Clay W-070, W-171;
# Instantly 2-3+ weeks).
INBOX_WARN, INBOX_MAX = 3, 5
WARMUP_DAYS = 21


# ---------------------------------------------------------------------- input

def read_csv(path):
    with open(path, newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    return [{(k or "").strip().lower(): (v or "").strip() for k, v in r.items()} for r in rows]


def col(rows, *names):
    if not rows:
        return None
    keys = rows[0].keys()
    for n in names:
        if n in keys:
            return n
    return None


def clay(op, **args):
    """A read through `chewbacca clay`. Reads only: no write op is ever named here."""
    cmd = ["bash", str(REPO / "bin/chewbacca"), "clay", op] + [f"{k}={v}" for k, v in args.items()]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    try:
        doc = json.loads(out.stdout)
    except ValueError:
        raise SystemExit(f"gtme-grade: chewbacca clay {op} returned no JSON: {out.stderr[:200]}")
    if not doc.get("ok"):
        raise SystemExit(f"gtme-grade: chewbacca clay {op} failed: {doc.get('reason', '')[:200]}")
    return doc["data"]


def doc_text(node, pick=0):
    """Flatten a Clay message document to text. Spintax renders its first option
    (or option `pick`); a lead field renders as {{field_id}}."""
    if node is None:
        return ""
    t = node.get("type")
    if t == "text":
        return node.get("text", "")
    if t == "hardBreak":
        return "\n"
    if t == "spintax":
        opts = node.get("attrs", {}).get("variants") or [""]
        return opts[min(pick, len(opts) - 1)]
    if t == "leadField":
        return "{{" + node.get("attrs", {}).get("fieldId", "?") + "}}"
    if t == "senderField":
        return "{{sender_" + node.get("attrs", {}).get("option", "name") + "}}"
    inner = "".join(doc_text(c, pick) for c in node.get("content", []) or [])
    if t == "paragraph":
        return inner + "\n"
    return inner


def spintax_nodes(node, out=None, para=None):
    out = [] if out is None else out
    if node.get("type") == "paragraph":
        para = node
    if node.get("type") == "spintax":
        out.append((node.get("attrs", {}).get("variants") or [], para))
    for c in node.get("content", []) or []:
        spintax_nodes(c, out, para)
    return out


def steps_from_clay(seq):
    steps = []
    for s in sorted(seq, key=lambda s: s.get("order", 0)):
        body = s.get("body") or {}
        opts = max((len(v) for v, _ in spintax_nodes(body)), default=1)
        renders = [doc_text(body, i) for i in range(opts)]
        spun_cta = any(p is not None and "?" in doc_text(p) for v, p in spintax_nodes(body))
        steps.append({"subject": doc_text(s.get("subject")).strip(), "body": renders[0],
                      "renders": renders, "delay": s.get("delayDays", 0),
                      "thread": s.get("emailType") == "REPLY_TO_THREAD",
                      "spun_cta": spun_cta})
    return steps


def campaign_from_clay(data):
    """{name, variants: [{name, steps}], settings, sender_ids}."""
    variants = [{"name": v.get("name", f"variant {i}"), "steps": steps_from_clay(v.get("sequence") or [])}
                for i, v in enumerate(data.get("variants") or []) if not v.get("deleted")]
    if not variants:
        variants = [{"name": "A", "steps": steps_from_clay(data.get("sequence") or [])}]
    settings = data.get("settings") or {}
    return {"id": data.get("id"), "name": data.get("name", ""), "status": data.get("status"),
            "variants": variants, "settings": settings,
            "sender_ids": list(settings.get("senderAccountIds") or [])}


def campaign_from_copy(path):
    """Plain copy file: steps separated by a line of three dashes. Optional
    header lines per step: `Subject: ...`, `Delay: N`, `Thread: yes|no`, and
    `Variant: NAME` to start a new variant. Merge fields are {{field}}."""
    variants, cur, step = [], None, None
    for block in re.split(r"^---\s*$", Path(path).read_text(encoding="utf-8"), flags=re.M):
        lines = block.strip("\n").splitlines()
        hdr, body = {}, []
        for i, ln in enumerate(lines):
            m = re.match(r"^(Variant|Subject|Delay|Thread):\s*(.*)$", ln)
            if m and not body:
                hdr[m.group(1).lower()] = m.group(2).strip()
            else:
                body = lines[i:]
                break
        if not body and not hdr:
            continue
        if "variant" in hdr or cur is None:
            cur = {"name": hdr.get("variant", "A"), "steps": []}
            variants.append(cur)
        text = "\n".join(body).strip() + "\n"
        thread = hdr.get("thread", "yes" if cur["steps"] else "no").lower().startswith("y")
        step = {"subject": hdr.get("subject", ""), "body": text, "renders": [text],
                "delay": int(hdr.get("delay", "0" if not cur["steps"] else "3") or 0),
                "thread": thread, "spun_cta": False}
        cur["steps"].append(step)
    return {"id": None, "name": Path(path).stem, "status": "local", "variants": variants,
            "settings": {}, "sender_ids": []}


# --------------------------------------------------------------------- gates

class Gate:
    def __init__(self, n, title):
        self.n, self.title = n, title
        self.fails, self.warns, self.notes, self.unchecked = [], [], [], []
        self.score = None

    def fail(self, msg, src):
        self.fails.append(f"{msg} [{src}]")

    def warn(self, msg, src):
        self.warns.append(f"{msg} [{src}]")

    def note(self, msg):
        self.notes.append(msg)

    def skip(self, what, why):
        self.unchecked.append(f"NOT CHECKED {what}: {why}")

    @property
    def passed(self):
        return not self.fails and not self.unchecked

    def as_dict(self):
        return {"gate": self.n, "title": self.title, "pass": self.passed, "score": self.score,
                "fails": self.fails, "not_checked": self.unchecked, "warnings": self.warns,
                "notes": self.notes}


def linear(value, good, bad):
    """100 at `good`, 0 at `bad`, straight line between. The anchors are the
    playbook's; the straight line between them is this tool's."""
    if good == bad:
        return 100.0
    lo, hi = sorted((good, bad))
    v = min(max(value, lo), hi)
    return round(100.0 * (v - bad) / (good - bad), 1)


def words(text):
    return re.findall(r"[A-Za-z0-9{}_'$%.,-]+", text)


def strip_signature(text):
    paras = [p for p in text.split("\n") if p.strip()]
    while paras and (re.fullmatch(r"\{\{sender_\w+\}\}", paras[-1].strip())
                     or (len(paras[-1].split()) <= 8 and not re.search(r"[.?!]$", paras[-1].strip()))):
        paras.pop()
    return paras


def sentences(paras):
    return [s for p in paras for s in re.split(r"(?<=[.?!])\s+", p.strip()) if s]


def gate_list(rows, args, verdicts, suppressed, gate):
    if rows is None:
        gate.skip("the list", "no --leads file, so no row was scored")
        return
    n = len(rows)
    ecol = col(rows, "email", "email_address", "work_email")
    if not ecol:
        gate.fail("the list has no email column", LASTLOOK)
        return
    emails = [r[ecol].lower() for r in rows]
    fn = col(rows, "first_name", "firstname")
    co = col(rows, "company", "company_name", "firm", "organization")
    ti = col(rows, "title", "job_title")
    vcol = col(rows, "verification", "verdict", "email_status", "status")

    def verdict(r):
        e = r[ecol].lower()
        if verdicts is not None and e in verdicts:
            return verdicts[e]
        return r[vcol].lower() if vcol else None

    vs = [verdict(r) for r in rows]
    if all(v is None for v in vs):
        gate.skip("verification", "no verdict column and no --verification file; Instantly: "
                                  "unverified rows block the send whatever the grade")
        ver_share = 0.0
    else:
        bad = sum(1 for v in vs if v not in VERIFIED)
        ca = sum(1 for v in vs if v in CATCH_ALL)
        ver_share = 1 - bad / n if n else 0
        if bad:
            gate.fail(f"{bad} of {n} rows are not verified valid ({ca} catch-all); only Verified "
                      f"rows enter the send set", INSTANTLY)
    dup = n - len(set(emails))
    if dup:
        gate.fail(f"{dup} duplicate addresses in the list", GEX_LIST)
    if suppressed is None:
        gate.skip("suppression", "no --suppress file; the launch checklist loads the suppression "
                                 "list from prior sends")
    else:
        hit = sum(1 for e in emails if e in suppressed or "*@" + e.split("@")[-1] in suppressed)
        if hit:
            gate.fail(f"{hit} addresses are on the suppression list (emailed, replied, bounced, "
                      f"unsubscribed or not a fit)", GEX_LAUNCH)
    role = sum(1 for e in emails if ROLE.match(e))
    if role:
        gate.fail(f"{role} role inboxes (info@, ir@) nobody owns", LASTLOOK)
    free = sum(1 for e in emails if e.split("@")[-1] in FREE)
    if free:
        gate.warn(f"{free} free-mail addresses in a B2B list", LASTLOOK)
    doms = Counter(e.split("@")[-1] for e in emails if e.split("@")[-1] not in FREE)
    over = {d: c for d, c in doms.items() if c > 3}
    if over:
        gate.fail(f"{len(over)} domains carry more than 3 leads, worst {max(over.values())}; cap at 3",
                  GEX_LIST)
    missing = sum(1 for r in rows if not (fn and r[fn]) or not (co and r[co]))
    if n and missing / n > 0.10:
        gate.fail(f"{missing} of {n} rows lack a first name or company (limit 10%)", INSTANTLY)
    if co:
        comm = sum(1 for r in rows if COMMUNITY.search(r[co]))
        if comm:
            gate.warn(f"{comm} leads list a community (Pavilion, Exit Five) as employer", LASTLOOK)

    # Growth Engine X scorecard. Skipped under 100 rows by the pack's own rule;
    # the blocking rules above still apply.
    if n < 100:
        gate.note(f"{n} rows: under 100, so the eight-dimension scorecard is skipped "
                  f"({GEX_LIST}); the blocking rules above still ran")
        return
    dims = {}
    dims["verification"] = (0.0 if ver_share < 0.5 else linear(ver_share, 1.0, 0.5), 2)
    dims["duplicates"] = (linear(dup / n, 0.0, 0.05), 1)
    per_dom = (sum(doms.values()) / len(doms)) if doms else 1
    dims["leads per domain"] = (100 if per_dom < 2 else 60 if per_dom <= 5 else 30, 1)
    if ti and args.icp_titles:
        pat = re.compile(r"\b(" + "|".join(re.escape(t.strip()) for t in args.icp_titles.split(",")
                                          if t.strip()) + r")\b", re.I)
        share = sum(1 for r in rows if pat.search(r[ti])) / n
        dims["title match"] = (100 if share >= 0.8 else 50 if share >= 0.4 else 0, 1)
        if share < 0.8:
            gate.fail(f"title match to the ICP is {share:.0%}, under 80%", GEX_LIST)
    else:
        # Not scored as 0: the skip already keeps the gate from passing, and a 0
        # here turned a 181-row Monday list into a "D" on 2026-10-11 while
        # every dimension actually checked scored 98 to 100, which sends the
        # reader hunting for a list problem that isn't there.
        gate.skip("title match", "no title column or no --icp-titles")
    if ti:
        bt = sum(1 for r in rows if BAD_TITLE.search(r[ti])) / n
        dims["bad titles"] = (linear(bt, 0.02, 0.10) if bt > 0.02 else 100, 1)
    else:
        dims["bad titles"] = (0, 1)
    ca_share = sum(1 for v in vs if v in CATCH_ALL) / n
    dims["catch-all"] = (100 if ca_share < 0.05 else 50 if ca_share <= 0.15 else 0, 1)
    fit = col(rows, args.icp_fit_column) if args.icp_fit_column else None
    if fit:
        share = sum(1 for r in rows if r[fit].lower() in {"yes", "true", "1", "fit", "y"}) / n
        dims["ICP fit"] = (100 if share >= 1 else linear(share, 1.0, 0.0), 2)
        if share < 0.8:
            gate.fail(f"ICP fit is {share:.0%}, under 80%", GEX_LIST)
    else:
        gate.skip("ICP fit", "no --icp-fit-column naming a yes/no fit column")
    human = sum(1 for r in rows if fn and re.fullmatch(r"[A-Z][a-z'\-]+( [A-Z][a-z'\-]+)?", r[fn] or ""))
    dims["names"] = (100 if human / n >= 0.95 else linear(human / n, 0.95, 0.0), 1)
    total = sum(s * w for s, w in dims.values()) / sum(w for _, w in dims.values())
    gate.score = round(total, 1)
    grade = "A" if total >= 90 else "B" if total >= 80 else "C" if total >= 70 else "D" if total >= 60 else "F"
    gate.note("scorecard " + ", ".join(f"{k} {v[0]:.0f}" for k, v in dims.items())
              + f" = {total:.0f} ({grade})" + (f", over the {len(dims)} dimensions checked" if len(dims) < 8 else ""))
    if total < 80:
        gate.fail(f"list scores {total:.0f} ({grade}); never upload below B", GEX_LIST)


def personal_fields(text):
    return {f for f in re.findall(r"\{\{(\w+)\}\}", text)
            if f not in BASE_FIELDS and not f.startswith("sender_")}


def score_email(step, idx, rows, gate, label):
    """Growth Engine X 0-100 rubric, from text features, plus its QA list."""
    body = step["body"]
    paras = strip_signature(body)
    if paras and re.match(r"^(hi|hello|hey|dear)\b", paras[0], re.I) and len(paras[0].split()) <= 3:
        greeting, paras = paras[0], paras[1:]
    elif paras and re.match(r"^(hi|hello|hey)\s+\{\{", paras[0], re.I):
        greeting = paras[0].split(",")[0]
        rest = paras[0][len(greeting):].lstrip(", ")
        paras = ([rest] if rest else []) + paras[1:]
    else:
        greeting = ""
    text = "\n".join(paras)
    sents = sentences(paras)
    n_words = max((len(words("\n".join(strip_signature(r)))) for r in step["renders"]), default=0)
    pts = {}
    first = sents[0] if sents else ""
    fields = personal_fields(body)
    first_fields = personal_fields(first)
    if first_fields:
        pts["situation"] = 25
    elif SENDER_FIRST.match(first):
        pts["situation"] = 0
    elif re.search(r"\byou(r)?\b", first, re.I):
        pts["situation"] = 12
    else:
        pts["situation"] = 5
    proof = bool(re.search(r"\d", text))
    benefit = bool(re.search(r"\byou(r)?\b", text, re.I))
    pts["value"] = (15 if proof else 0) + (10 if benefit else 0)
    if fields:
        thin = []
        for f in fields:
            c = col(rows or [], f.lower())
            if rows and c:
                vals = [r[c] for r in rows if r[c]]
                if len(vals) / len(rows) < 0.9 or len(set(vals)) / max(len(vals), 1) < 0.5:
                    thin.append(f)
            else:
                thin.append(f)
        pts["personalization"] = 20 if not thin else 10
    else:
        pts["personalization"] = 5 if "{{first_name}}" in body or "{{company" in body else 0
    qs = [s for s in sents if s.endswith("?")]
    if len(qs) == 1:
        pts["cta"] = 5 if CALENDAR_ASK.search(qs[0]) else 15
    else:
        pts["cta"] = 5 if qs else 0
    if idx == 0:
        pts["punchiness"] = 10 if 50 <= n_words <= 90 else 5 if n_words <= 125 else 0
        sw = len(step["subject"].split())
        whole_offer = sw >= 5 and step["subject"].endswith("?")
        bad_subj = step["subject"].lower() in {"curious", "quick question"}
        pts["subject"] = 0 if bad_subj else 5 if (2 <= sw <= 4 or whole_offer) else 0
    else:
        pts["punchiness"] = 10 if n_words <= 50 else 5 if n_words <= 90 else 0
        pts["subject"] = 5 if (step["thread"] or step["subject"]) else 0
    score = sum(pts.values())
    where = f"{label} email {idx + 1}"
    gate.note(f"{where}: {score}/100 ({', '.join(f'{k} {v}' for k, v in pts.items())}), "
              f"{n_words} words")
    if score < 85:
        gate.fail(f"{where} scores {score}/100; 85 ships, 70-84 gets one more pass, under 70 "
                  f"starts over", GEX_COPY)

    # QA list, every line must pass
    if idx == 0 and not first_fields:
        gate.fail(f"{where}: line one carries no recipient-specific signal "
                  f"(opens: \"{first[:60]}\")", GEX_COPY)
    low = (step["subject"] + "\n" + text).lower()
    hits = sorted({w for w in SPAM_WORDS if re.search(r"(?<![a-z])" + w + r"(?![a-z])", low)}
                  | {p for p in SPAM_PHRASES if p in low})
    if hits:
        gate.fail(f"{where}: spam-list words {hits}", GEX_SPAM)
    if SILENCE_STOP.search(low):
        gate.fail(f"{where}: promises to stop on silence", GEX_SPAM)
    if "—" in body or "--" in body:
        gate.fail(f"{where}: em dash", GEX_COPY)
    if greeting:
        gate.warn(f"{where}: greeting before the first name; GEX bans it, Instantly's own "
                  f"example uses it, and the team's approved copy wins where they disagree",
                  f"{GEX_SPAM}; {PLAYBOOK} disagreements")
    rec = sum(1 for s in sents if re.search(r"\byou(r|'re)?\b", s, re.I))
    # The opt-out line is compliance, not pitch, so it never counts as a sender sentence.
    snd = sum(1 for s in sents if re.search(r"\b(i|i'm|we|we're|our|us|me|my)\b", s, re.I)
              and not re.search(r"\byou(r)?\b", s, re.I) and not OPT_OUT.search(s))
    if (idx == 0 or len(sents) >= 3) and snd and rec < 3 * snd:
        gate.fail(f"{where}: {rec} recipient sentences to {snd} sender sentences, under 3:1",
                  GEX_COPY)
    if len(qs) != 1:
        gate.fail(f"{where}: {len(qs)} questions; one CTA per email", f"{PLAYBOOK} agreements")
    elif not YES_NO.match(qs[0].strip()):
        gate.fail(f"{where}: the CTA \"{qs[0][:50]}\" is not answerable in five words", GEX_COPY)
    if n_words > READ_ALOUD_WORDS:
        gate.fail(f"{where}: {n_words} words, over 20 seconds read aloud", GEX_COPY)
    if idx == 0 and not pts["subject"]:
        gate.fail(f"{where}: subject \"{step['subject']}\" is neither 2-4 words nor the whole offer",
                  GEX_COPY)
    if idx > 0 and WEAK_FOLLOWUP.search(text):
        gate.fail(f"{where}: opens by pointing at the earlier email", GEX_COPY)
    if step.get("spun_cta"):
        gate.warn(f"{where}: spintax on the CTA; Clay keeps the CTA fixed, GEX spins it",
                  "Clay W-073; GEX 12-launch-checklist")


def gate_copy(camp, rows, gate):
    if not camp["variants"] or not any(v["steps"] for v in camp["variants"]):
        gate.skip("copy", "no sequence to grade")
        return
    for v in camp["variants"]:
        label = f"variant {v['name']}" if len(camp["variants"]) > 1 else "sequence"
        for i, st in enumerate(v["steps"]):
            score_email(st, i, rows, gate, label)
    if len(camp["variants"]) > 1:
        a, b = (v["steps"][0]["body"] if v["steps"] else "" for v in camp["variants"][:2])
        diff = len(set(a.split("\n")) ^ set(b.split("\n")))
        if diff > 2:
            gate.warn(f"the variants differ in {diff} lines; change one variable per experiment",
                      "GEX experiment-design")
        gate.warn("in-campaign A/B: GEX runs a test as two campaigns that split the inboxes; "
                  "under 500 sends per arm it cannot separate signal from noise",
                  "GEX experiment-design")


def gate_read(review, camp, gate):
    if not review:
        gate.skip("recipient read", "no --review file recording a read as the recipient")
        return
    try:
        doc = json.loads(Path(review).read_text())
    except (OSError, ValueError) as exc:
        gate.fail(f"--review is unreadable: {exc}", "Clay campaigns-sequence-reviewing")
        return
    key = doc.get("campaign")
    if camp.get("id") and key and key != camp["id"]:
        gate.fail(f"--review is for {key}, not {camp['id']}", "Clay campaigns-sequence-reviewing")
    at = doc.get("reviewed_at")
    try:
        age = time.time() - dt.datetime.fromisoformat(str(at).replace("Z", "+00:00")).timestamp()
    except ValueError:
        age = None
    if age is None or age > REVIEW_MAX_AGE_S:
        gate.fail("the recipient read is missing a time or is over 12 hours old",
                  "Clay campaigns-sequence-reviewing")
    if not doc.get("reviewer"):
        gate.fail("the recipient read names no reviewer", "Clay campaigns-sequence-reviewing")
    open_items = doc.get("unresolved")
    if open_items is None or not isinstance(open_items, list):
        gate.fail("the recipient read has no unresolved list", "Clay campaigns-sequence-reviewing")
    elif open_items:
        gate.fail(f"{len(open_items)} unresolved objections: {open_items[:3]}",
                  "Clay campaigns-sequence-reviewing")


def render(text, row, fieldmap):
    def sub(m):
        f = m.group(1)
        if f.startswith("sender_"):
            return "Sender"
        c = fieldmap.get(f)
        return row.get(c, "") if c else "\x00MISSING:" + f + "\x00"
    return re.sub(r"\{\{(\w+)\}\}", sub, text)


def gate_render(camp, rows, gate):
    if rows is None:
        gate.skip("rendering", "no --leads file to render against")
        return
    steps_all = [(v["name"], i, s) for v in camp["variants"] for i, s in enumerate(v["steps"])]
    if not steps_all:
        gate.skip("rendering", "no sequence")
        return
    fields = set()
    for _, _, s in steps_all:
        for r in s["renders"]:
            fields |= set(re.findall(r"\{\{(\w+)\}\}", r + s["subject"]))
    aliases = {"company_name": ("company_name", "company", "firm"), "company": ("company", "company_name", "firm"),
               "line": ("line", "personalized_copy", "personalized_line")}
    fieldmap = {}
    for f in fields:
        if f.startswith("sender_"):
            continue
        c = col(rows, *aliases.get(f, (f.lower(),)))
        if c:
            fieldmap[f] = c
        else:
            gate.fail(f"merge field {{{{{f}}}}} has no column in the leads file, so every email "
                      f"renders it blank or literal", LASTLOOK)
    for f, c in fieldmap.items():
        fill = sum(1 for r in rows if r[c]) / len(rows) if rows else 0
        gate.note(f"fill rate {{{{{f}}}}} {fill:.0%}")
        if fill < 1:
            gate.fail(f"{{{{{f}}}}} is empty on {sum(1 for r in rows if not r[c])} leads: a blank "
                      f"merge, or Clay never enrolls them", f"{LASTLOOK}; Clay W-072, W-172")
    custom = [f for f in fieldmap if f not in BASE_FIELDS]
    src = col(rows, "line_source", "source_url", "source")
    for f in custom:
        c = fieldmap[f]
        if not src:
            gate.skip(f"sources for {{{{{f}}}}}", "no line_source column; every fact must be "
                                                 "verifiable")
            continue
        unsourced = sum(1 for r in rows if r[c] and not URL.match(r[src]))
        if unsourced:
            gate.fail(f"{unsourced} {{{{{f}}}}} values carry no public source URL", GEX_COPY)
    fn = fieldmap.get("first_name")
    problems = Counter()
    for r in rows:
        if fn:
            v = r[fn]
            if v and (v.isupper() and len(v) > 2 or " " in v or len(v) < 2 or re.search(r"[\d@]", v)):
                problems["first name looks like a raw CRM value (caps, full name, digits)"] += 1
        for f, c in fieldmap.items():
            v = r[c]
            if v and LEAK.search(v):
                problems[f"{{{{{f}}}}} carries an enrichment leak (NONE, N/A, braces)"] += 1
            if v and INVISIBLE.search(v):
                problems[f"{{{{{f}}}}} carries invisible characters"] += 1
            if repair(v):
                problems[f"{{{{{f}}}}} is garbled text (UTF-8 read in the wrong encoding)"] += 1
    # A company sitting where a person's name goes. On 2026-10-11 a Russian LLC,
    # "ООО «Урал-Инвест-Капитал»", was loaded as a lead on a Monday list, first
    # name and all. Togari's realness heuristics catch org tokens in a name; this
    # is the same idea on the rendered list.
    full = col(rows, "full_name", "name")
    if full:
        org = sum(1 for r in rows
                  if ORG_AS_PERSON.search(repair(r[full]) or r[full] or ""))
        if org:
            problems["the person's name is a company (LLC, Inc, Capital, ООО...)"] += org
    for what, k in problems.items():
        if k:
            gate.fail(f"{k} leads: {what}", LASTLOOK)
    co = fieldmap.get("company") or fieldmap.get("company_name")
    if co:
        suf = sum(1 for r in rows if re.search(r"\b(inc|llc|ltd|lp|gmbh)\.?$", r[co], re.I))
        if suf:
            gate.warn(f"{suf} company names end in a legal suffix", "GEX playbook-company-name-cleaning")
    for name, i, s in steps_all:
        t = s["body"] + s["subject"]
        if INVISIBLE.search(t):
            gate.fail(f"variant {name} email {i + 1}: invisible characters in the template", LASTLOOK)
        if PLACEHOLDER.search(t):
            gate.fail(f"variant {name} email {i + 1}: placeholder text in the template", LASTLOOK)
        if i > 0 and not s["thread"] and not s["subject"]:
            gate.fail(f"variant {name} email {i + 1}: a new thread with no subject", LASTLOOK)
        if i > 0 and s["delay"] == 0:
            gate.fail(f"variant {name} email {i + 1}: zero-day gap after the previous step", LASTLOOK)
        elif i > 0 and s["delay"] < 3:
            gate.warn(f"variant {name} email {i + 1}: {s['delay']}-day gap", LASTLOOK)
    if len(camp["variants"]) > 1:
        bodies = [tuple(s["body"] for s in v["steps"]) for v in camp["variants"]]
        if len(set(bodies)) < len(bodies):
            gate.fail("two variants are identical", LASTLOOK)
        openers = [strip_signature(v["steps"][0]["body"])[:2] for v in camp["variants"] if v["steps"]]
        if len({tuple(o) for o in openers}) < len(openers):
            gate.warn("variants share their opening lines", LASTLOOK)
    sample = render(steps_all[0][2]["body"], rows[0], fieldmap) if rows else ""
    if "\x00MISSING" in sample:
        gate.fail("the first lead renders a missing field", LASTLOOK)


def load_senders(path):
    if path.endswith(".json"):
        doc = json.loads(Path(path).read_text())
        accts = doc.get("data", doc) if isinstance(doc, dict) else doc
    else:
        accts = read_csv(path)
    return [{k.lower(): v for k, v in a.items()} for a in accts]


def gate_start(camp, args, senders, analytics, gate, client):
    st = camp["settings"]
    steps = [s for v in camp["variants"] for s in v["steps"]]
    if st:
        tr = st.get("trackingSettings") or {}
        if tr.get("trackEmailOpen") or tr.get("trackLinkClick") or st.get("isHtmlEnabled"):
            gate.fail("open or click tracking or HTML is on; email 1 goes plain text, tracking off",
                      "ColdIQ / Lieben")
        sch = st.get("scheduleSettings") or {}
        days = set(sch.get("daysOfWeek") or [])
        if days - {"mon", "tue", "wed", "thu", "fri"}:
            gate.fail("the schedule sends on weekends", GEX_LAUNCH)
        try:
            h0, h1 = int(sch.get("startHour", "9")[:2]), int(sch.get("endHour", "17")[:2])
            if h0 < 8 or h1 > 18:
                gate.fail(f"sending window {h0}:00-{h1}:00 runs outside business hours", GEX_LAUNCH)
        except ValueError:
            gate.skip("send window", "unreadable hours")
        gate.note(f"schedule in {sch.get('timezone', '?')}; the checklist wants the recipient's "
                  f"business hours, so leads outside that zone get mail at odd hours")
        if not st.get("autoPauseDomainLeadsOnReply"):
            gate.warn("a reply does not pause the rest of that firm", GEX_LAUNCH)
    else:
        gate.skip("campaign settings", "local copy carries no tracking or schedule settings")
    if steps:
        opt = st.get("unsubscribeText") or any(OPT_OUT.search(s["body"]) for s in steps)
        every = all(OPT_OUT.search(s["body"]) for s in steps) or bool(st.get("unsubscribeText"))
        if not opt or not every:
            gate.fail("not every email carries an opt-out", GEX_LAUNCH)
        if not all(ADDRESS.search(s["body"]) for s in steps):
            gate.fail("not every email carries a physical address", GEX_LAUNCH)

    # The senders: the ones the campaign actually carries, not a file about them.
    if senders is None:
        gate.skip("senders", "no --senders list to resolve the campaign's inboxes against")
        return
    by_id = {s.get("id"): s for s in senders if s.get("id")}
    if camp["sender_ids"]:
        unknown = [i for i in camp["sender_ids"] if i not in by_id]
        if unknown:
            gate.fail(f"{len(unknown)} of the campaign's {len(camp['sender_ids'])} inboxes are not in "
                      f"--senders, so nobody checked them", "Zeutara 2026-10-04 review")
        attached = [by_id[i] for i in camp["sender_ids"] if i in by_id]
    else:
        attached = senders
    sent_from = {a["email"].lower() for a in (analytics or {}).get("senders", {}).get("byAccount", [])
                 if a.get("sent")}
    emails = [a.get("email", "").lower() for a in attached] + sorted(sent_from - {a.get("email", "").lower()
                                                                                 for a in attached})
    if not emails:
        gate.fail("the campaign has no sending inboxes", GEX_LAUNCH)
        return
    refused = [re.compile(p, re.I) for p in (args.refuse_sender or [])]
    refused += [re.compile(p, re.I) for p in (client or {}).get("refused_senders", [])]
    bad = sorted({e for e in emails if any(p.search(e) for p in refused)})
    if bad:
        gate.fail(f"{len(bad)} inboxes the client refused: {bad[:4]}", "client review")
    primary = args.primary_domain or (client or {}).get("primary_domain")
    if primary:
        prim = [e for e in emails if e.endswith("@" + primary.lower())]
        if prim:
            gate.fail(f"{len(prim)} inboxes on the primary domain {primary}; never send cold from it",
                      "ColdIQ deliverability-guide")
    names = {a.get("displayname") or a.get("display_name") or "" for a in attached}
    if any(len(n.split()) < 2 or re.search(r"\b(team|info|sales|support)\b", n, re.I) for n in names if n) \
            or not any(names):
        gate.fail("a sender has no real person's name", GEX_LAUNCH)
    per_dom = Counter(e.split("@")[-1] for e in emails)
    over = {d: c for d, c in per_dom.items() if c > INBOX_MAX}
    if over:
        gate.fail(f"{len(over)} sending domains carry more than {INBOX_MAX} inboxes "
                  f"(worst {max(over.values())})", "Clay W-070, W-171")
    elif any(c > INBOX_WARN for c in per_dom.values()):
        gate.warn(f"some domains carry more than {INBOX_WARN} inboxes", "Clay W-070")
    gate.note(f"{len(emails)} inboxes on {len(per_dom)} domains")
    ages = []
    for a in attached:
        w = a.get("warmup_days") or a.get("warmup_age_days")
        if w not in (None, ""):
            ages.append(float(w))
    if not ages and args.warmup_start:
        start = dt.date.fromisoformat(args.warmup_start)
        ages = [(dt.date.fromisoformat(args.today) if args.today else dt.date.today()).toordinal()
                - start.toordinal()] * len(attached)
    if not ages:
        gate.skip("warmup", "no warmup age per inbox and no --warmup-start; a sender missing from "
                            "the warmup data counts as cold (Instantly)")
    else:
        young = sum(1 for a in ages if a < WARMUP_DAYS)
        if young:
            gate.fail(f"{young} inboxes have under {WARMUP_DAYS} days of warmup (youngest "
                      f"{min(ages):.0f})", "Clay W-070, W-171; Instantly deliverability")
    health = [float(a["health"]) for a in attached if a.get("health") not in (None, "")]
    if health and min(health) < 80:
        gate.fail(f"{sum(1 for h in health if h < 80)} inboxes under health score 80",
                  "Instantly deliverability")
    if analytics:
        tot = (analytics.get("stats") or {}).get("totals") or {}
        sent, bounces = tot.get("sent", 0), tot.get("bounces", 0)
        if sent >= 50:
            rate = bounces / sent
            if rate > 0.03:
                gate.fail(f"live bounce rate {rate:.1%} on {sent} sends; above 3% pause and "
                          f"re-validate", "GEX weekly rhythm")
            elif rate > 0.02:
                gate.warn(f"live bounce rate {rate:.1%}; above 2% triage", "GEX weekly rhythm")
            gate.note(f"live: {sent} sent, {bounces} bounces ({rate:.1%})")
        elif sent:
            gate.note(f"live: {sent} sent, under the 50-send floor for a bounce verdict")


# -------------------------------------------------------------------- Sagar
# Sagar Tiwari runs BMA's outbound. These are his rules that can be read off the
# data, each cited to where he said it; the quotes and the rules that need
# judgement are in skills/gtm-engineering/references/sagar.md. The transcript is
# "Outbound change management review", Sagar teaching Maggie and Mike the six
# variables, file dated 2026-03-19.
SAGAR_SUBJ = "Sagar 2026-03-19 transcript, subject lines; Zeutara subjects re-cut 2026-10-11"
SAGAR_VAGUE = "Sagar 2026-03-19 transcript, his kill of Kevin's copy"
SAGAR_SIGNALS = "Sagar 2026-03-19 transcript, signals leading messaging"
SAGAR_WARM = "Sagar 2026-03-19 transcript, relationship column; amber-outbound ask 2026-09-17"
SAGAR_TWICE = "Sagar 2026-10-06 Zeutara DECISIONS no-double-email"
SAGAR_FIRM = "Sagar 2025-03-05 Slack maple-smartlead, dedupe at the company level"
SAGAR_ORDER = "Sagar 2026-10-04 Zeutara DECISIONS strongest-first"
SAGAR_SHAPE = "Sagar 2026-10-04 Slack zeutara-amber, 2 variants of 3 messages"

# Subjects that name no offer. "Question" is the one Zeutara actually shipped
# from 9/28 to 10/11, from a "one word question" brief, until the subjects were
# re-cut to Sagar's stacked nouns ("Chicago dating app pre-seed").
GENERIC_SUBJECTS = {
    "question", "quick question", "a question", "question for you", "quick q", "hi", "hello",
    "hey", "hi there", "hey there", "intro", "introduction", "quick intro", "intro call",
    "following up", "follow up", "follow-up", "checking in", "touching base", "curious",
    "idea", "an idea", "quick idea", "thoughts", "quick thought", "partnership",
    "opportunity", "quick chat", "chat", "call", "meeting", "connect", "let's connect",
    "update", "quick update", "hello from us",
}
# Words that carry no offer. A subject made only of these, pronouns and
# connectives names nothing a reader could picture.
EMPTY_WORDS = set("""
a an the and or of to for with about from on in at by re fwd fw your you our my we us i me it
this that these those quick question questions idea ideas thought thoughts intro introduction
hi hello hey chat call meeting connect connecting following follow up checking touching base
curious update opportunity partnership help time minute minutes info information reaching out
share sharing regarding hope well just some new great quick note something few one two
""".split())
VAGUE = re.compile(r"\b(solutions?|services|offerings?|capabilities|synerg\w*|value[- ]add|"
                   r"best[- ]in[- ]class|next level|grow your business|help (you|companies|teams) grow|"
                   r"consulting)\b", re.I)
SIGNAL_COL = re.compile(r"(signal|segment|trigger|why_now|intent|cohort|sector_match|thesis_match)")
LAST_SENT_COL = re.compile(r"(last_sent|last_emailed|last_contacted|zeutara_last_sent)")
RELATION_COL = re.compile(r"^(relationship\w*|degree|connection_degree|warmth|warm|known)$")
WARM_VALUE = re.compile(r"^(1|1st|first|first degree|direct|known|warm|friend|yes|true)$", re.I)
TIER_COL = ("tier", "fit_tier", "priority")
SENDER_NAME_FIELD = re.compile(r"\{\{sender_\w*name\w*\}\}", re.I)
SENDER_CO_FIELD = re.compile(r"\{\{sender_\w*compan\w*\}\}", re.I)


def content_words(text):
    """Words that could name something, lowercased, merge fields kept whole."""
    toks = re.findall(r"\{\{\w+\}\}|[a-z0-9$%]+", (text or "").lower())
    return [t for t in toks if t.startswith("{{") or (len(t) >= 3 and t not in EMPTY_WORDS)]


def overlaps(a, b):
    """True when two word lists share a word, by its first five letters, so
    "round" meets "rounds" and "payments" meets "payment"."""
    stems = {w[:5] for w in b if not w.startswith("{{")}
    return any(not w.startswith("{{") and w[:5] in stems for w in a)


def subject_problem(subject):
    """Why a subject fails Sagar's rule, or ''. He wants the offer stacked as
    concrete nouns: "Clay, private equity, Structify. That sticks out to me in
    the subject line. It also is just more real." """
    norm = re.sub(r"^(re|fwd?|fw)\s*:\s*", "", (subject or "").strip().lower())
    norm = re.sub(r"[^\w\s'{}-]", "", norm).strip()
    if not norm:
        return "is empty"
    if norm in GENERIC_SUBJECTS:
        return f"\"{subject}\" is a generic word that names no offer"
    if len(norm.split()) < 2:
        return f"\"{subject}\" is one word, and one word cannot stack the offer's nouns"
    if not content_words(norm):
        return f"\"{subject}\" carries no concrete noun"
    return ""


def offer_for(camp, args, client):
    """The offer in concrete nouns: --offer, else a clients.json offer whose name
    or alias is in the campaign name and which carries a `pitch`."""
    if args.offer:
        return args.offer
    name = (camp.get("name") or "").lower()
    for o in (client or {}).get("offers", []):
        names = [o.get("name", "")] + list(o.get("aliases") or [])
        if o.get("pitch") and any(n and n.lower() in name for n in names):
            return o["pitch"]
    return None


def sagar_list(rows, gate):
    """His list rules, on the rows. No rows means gate 1 already says NOT CHECKED."""
    if not rows:
        return
    keys = rows[0].keys()
    last = next((k for k in keys if LAST_SENT_COL.search(k)), None)
    if last:
        sent = sum(1 for r in rows if r[last])
        if sent:
            gate.fail(f"{sent} leads already carry a last-sent date; refills never email anyone "
                      f"twice", SAGAR_TWICE)
    rel = next((k for k in keys if RELATION_COL.match(k)), None)
    if rel is None:
        gate.warn("no relationship-to-sender column, so nobody filtered out the people the sender "
                  "already knows (\"you know these 26 people directly. There's no need for you to "
                  "send an email. You should just personally text them.\")", SAGAR_WARM)
    else:
        warm = sum(1 for r in rows if WARM_VALUE.match(r[rel]))
        if warm:
            gate.fail(f"{warm} leads are marked as known to the sender in {rel}; they get a "
                      f"personal text, not a cold email", SAGAR_WARM)
    ecol = col(rows, "email", "email_address", "work_email")
    if ecol:
        doms = Counter(r[ecol].lower().split("@")[-1] for r in rows if "@" in r[ecol])
        multi = {d: c for d, c in doms.items() if c > 1 and d not in FREE}
        if multi:
            gate.warn(f"{len(multi)} companies carry more than one lead (worst {max(multi.values())}); "
                      f"Sagar dedupes at the company level", SAGAR_FIRM)
    tier = col(rows, *TIER_COL)
    if tier:
        tiers = sorted({r[tier] for r in rows if r[tier]})
        if len(tiers) > 1:
            gate.warn(f"one start mixes tiers {tiers[:4]}; the strongest fits go first and the "
                      f"weaker fill after, order never cut", SAGAR_ORDER)


def sagar_copy(camp, rows, args, senders, client, gate):
    """His copy rules, on email 1 of every variant."""
    firsts = [(v["name"], v["steps"][0]) for v in camp["variants"] if v["steps"]]
    if not firsts:
        return
    offer = offer_for(camp, args, client)
    offer_words = content_words(offer) if offer else []
    if offer is None:
        gate.skip("what is sold, in concrete nouns", "no --offer (or clients.json offer pitch); "
                  "Sagar: \"It's impossible to sell consulting services outbound without anything "
                  "specific because no one will trust you\"")
    names = [n for n in [args.sender_name, (client or {}).get("principal")] if n]
    by_id = {s.get("id"): s for s in senders or [] if s.get("id")}
    attached = [by_id[i] for i in camp["sender_ids"] if i in by_id] if camp["sender_ids"] else (senders or [])
    names += [a.get("displayname") or a.get("display_name") or "" for a in attached]
    names = sorted({n.strip() for n in names if n and n.strip()})
    company = args.sender_company or (client or {}).get("sender_company") or (client or {}).get("name")
    many = len(firsts) > 1
    for vname, st in firsts:
        where = f"variant {vname} email 1" if many else "email 1"
        text = st["subject"] + "\n" + st["body"]
        low = text.lower()
        why = subject_problem(st["subject"])
        if why:
            gate.fail(f"{where}: subject {why}; Sagar's subjects stack the offer's concrete nouns, "
                      f"like \"Chicago dating app pre-seed\"", SAGAR_SUBJ)
        else:
            subj = content_words(st["subject"])
            target = offer_words or content_words(st["body"])
            if not overlaps(subj, target):
                msg = (f"{where}: subject \"{st['subject']}\" shares no word with "
                       f"{'the offer' if offer_words else 'the email it opens'}")
                if offer_words:
                    gate.fail(msg, SAGAR_SUBJ)
                else:
                    gate.warn(msg, SAGAR_SUBJ)
        if offer_words and not overlaps(content_words(st["body"]), offer_words):
            gate.fail(f"{where} never names the offer (\"{offer}\"); Kevin's copy died as \"way too "
                      f"vague, both in terms of who we're targeting and in terms of who the message "
                      f"is coming from\"", SAGAR_VAGUE)
        if SENDER_NAME_FIELD.search(text) or any(n.lower() in low for n in names):
            pass
        elif names:
            gate.fail(f"{where} never says who it is from (looked for {names[:3]}); \"way too vague "
                      f"... in terms of who the message is coming from\"", SAGAR_VAGUE)
        else:
            gate.skip(f"{where} sender name", "no --sender-name, client principal or sender display "
                      "name to look for")
        if company is None:
            gate.skip(f"{where} sender company", "no --sender-company or --client naming the company "
                      "the email comes from")
        elif not (SENDER_CO_FIELD.search(text) or company.lower() in low):
            gate.fail(f"{where} never names the company it comes from ({company})", SAGAR_VAGUE)
        vague = sorted({m.group(0).lower() for m in VAGUE.finditer(st["body"])})
        if vague:
            gate.warn(f"{where} sells in abstractions {vague}; name the thing, the number, the "
                      f"customer", SAGAR_VAGUE)

    # Signals lead messaging: the list was cut by a reason to write now, or
    # email 1 says something only this recipient could be told.
    per_lead = any(personal_fields(st["body"]) for _, st in firsts)
    sig = col(rows or [], *[k for k in (rows[0].keys() if rows else []) if SIGNAL_COL.search(k)])
    split = bool(sig and all(r[sig] for r in rows))
    if per_lead or args.signal or split:
        gate.note("signals lead messaging: " + ("email 1 carries a per-lead line" if per_lead else
                  f"--signal {args.signal!r}" if args.signal else f"every lead carries {sig}"))
    elif rows is None:
        gate.skip("signals leading messaging", "email 1 has no per-lead line, and with no --leads "
                  "and no --signal nothing shows the list was cut by a signal")
    else:
        gate.warn("signals leading messaging: no lead carries a signal or segment field and email 1 "
                  "has no per-lead line, so this is a list plus copy (\"you should not look at ICP "
                  "builds and messaging ... as two distinct things\")", SAGAR_SIGNALS)
    shapes = [len(v["steps"]) for v in camp["variants"]]
    if len(shapes) != 2 or any(n != 3 for n in shapes):
        gate.warn(f"{len(shapes)} variant(s) of {shapes} messages; Sagar's weekly launch is 2 variants "
                  f"of 3 messages per offer", SAGAR_SHAPE)


# ------------------------------------------------------------------- driver

def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def load_client(name):
    if not name:
        return None
    path = Path(os.path.expanduser(os.environ.get("GTME_CLIENTS", "~/.chewbacca/gtm/clients.json")))
    try:
        doc = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    for c in doc.get("clients", []):
        if c.get("name", "").lower() == name.lower():
            return c
    return None


def grade(args):
    analytics = None
    inputs = []
    if args.campaign_json:
        doc = json.loads(Path(args.campaign_json).read_text())
        camp = campaign_from_clay(doc.get("data", doc))
        camp["raw"] = doc.get("data", doc)
        inputs.append(args.campaign_json)
    elif args.campaign:
        raw = clay("campaign", ws=args.ws, campaign=args.campaign)
        camp = campaign_from_clay(raw)
        camp["raw"] = raw
        try:
            analytics = clay("campaign-analytics", campaign=args.campaign)
        except SystemExit:
            analytics = None
    elif args.copy:
        camp = campaign_from_copy(args.copy)
        inputs.append(args.copy)
    else:
        raise SystemExit("gtme-grade: name a --campaign, a --campaign-json or a --copy file")
    if args.settings:
        # Local copy has no Clay settings; this supplies them in Clay's shape
        # (trackingSettings, scheduleSettings, unsubscribeText, ...).
        camp["settings"] = json.loads(Path(args.settings).read_text())
        inputs.append(args.settings)
    if args.analytics_json:
        a = json.loads(Path(args.analytics_json).read_text())
        analytics = a.get("data", a)
        inputs.append(args.analytics_json)
    rows = read_csv(args.leads) if args.leads else None
    for pair in args.field_map or []:
        field, _, column = pair.partition("=")
        if not column or rows is None:
            continue
        if rows and column.lower() not in rows[0]:
            raise SystemExit(f"gtme-grade: --field-map names {column}, which the leads file lacks")
        for r in rows:
            r[field.lower()] = r.get(column.lower(), "")
    verdicts = None
    if args.verification:
        vr = read_csv(args.verification)
        e, v = col(vr, "email"), col(vr, "verification", "verdict", "status", "result")
        if not e or not v:
            raise SystemExit(f"gtme-grade: {args.verification} needs email and verification columns")
        verdicts = {r[e].lower(): r[v].lower() for r in vr}
    suppressed = None
    if args.suppress:
        suppressed = set()
        for p in args.suppress:
            sr = read_csv(p)
            if not sr:
                continue
            e = col(sr, "email", "address")
            if not e:
                raise SystemExit(f"gtme-grade: {p} has no email column")
            suppressed |= {r[e].lower() for r in sr if r[e]}
    senders = load_senders(args.senders) if args.senders else None
    for p in [args.leads, args.verification, args.senders, args.review] + list(args.suppress or []):
        if p:
            inputs.append(p)
    client = load_client(args.client)

    gates = [Gate(1, "list"), Gate(2, "copy"), Gate(3, "recipient read"), Gate(4, "rendered output"),
             Gate(5, "infrastructure and start")]
    gate_list(rows, args, verdicts, suppressed, gates[0])
    gate_copy(camp, rows, gates[1])
    gate_read(args.review, camp, gates[2])
    gate_render(camp, rows, gates[3])
    gate_start(camp, args, senders, analytics, gates[4], client)
    sagar_list(rows, gates[0])
    sagar_copy(camp, rows, args, senders, client, gates[1])
    passed = all(g.passed for g in gates)
    return camp, gates, passed, inputs


ACTIONS = ("launch", "resume", "add-leads")
# 12 hours: lists and copy change overnight, and Monday's launch should not ride
# on Saturday's grade. Same window as the pre-send gate receipt.
RECEIPT_TTL_S = 12 * 3600
# Bounded so the PreToolUse hook (10 s budget) still answers; a slower Clay read
# refuses rather than waits. chewbacca clay campaign measured 0.6-4.5 s on 10-09.
VERIFY_FETCH_TIMEOUT_S = 7
# Fields that change without the copy, list or senders changing: launching flips
# status, and Clay touches updatedAt on any save.
VOLATILE = {"status", "updatedAt", "createdAt", "analytics"}


def key_path():
    """The HMAC key lives outside the repo and outside ~/.chewbacca (which is
    mirrored into the second-brain repo), readable by this user only."""
    return Path(os.environ.get("GTME_GRADE_KEY_FILE") or
                os.path.expanduser("~/Library/Application Support/chewbacca/gtme-grade.key"))


def load_key(create):
    """The signing key. Only a grade may mint it (from the OS CSPRNG); --verify
    never does, so deleting the key strands every receipt instead of re-minting."""
    import secrets
    p = key_path()
    if p.is_symlink():
        raise PermissionError(f"grade key {p} is a symlink; refusing to trust it")
    if not p.exists():
        if not create:
            raise PermissionError(f"no grade key at {p}; run gtme-grade once to make it")
        p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as fh:
            fh.write(secrets.token_hex(32))
    st = p.stat()
    if st.st_mode & 0o077 or st.st_uid != os.getuid():
        raise PermissionError(f"grade key {p} is mode {oct(st.st_mode & 0o777)} or not owned by "
                              f"this user, not 0600; refusing to trust it")
    k = p.read_text().strip()
    if not re.fullmatch(r"[0-9a-f]{64}", k):
        raise PermissionError(f"grade key {p} is empty or malformed")
    return k.encode()


def canonical_state(raw):
    """sha256 of the campaign as Clay holds it: sequence, variants, settings and
    sender ids, without the fields a launch or a save touches by themselves."""
    body = {k: v for k, v in (raw or {}).items() if k not in VOLATILE}
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def fetch_state(ws, cid):
    """Live campaign state for verification. GTME_GRADE_CLAY_FIXTURE_DIR is a test
    seam read from the hook's own environment, which a tool call cannot set."""
    fixtures = os.environ.get("GTME_GRADE_CLAY_FIXTURE_DIR")
    if not WS_RE.fullmatch(str(ws)) or not CID_RE.fullmatch(cid or ""):
        raise ValueError("bad workspace or campaign id")
    if fixtures:
        doc = json.loads((Path(fixtures) / f"{cid}.json").read_text())
        return doc.get("data", doc)
    cmd = ["bash", str(REPO / "bin/chewbacca"), "clay", "campaign", f"ws={ws}", f"campaign={cid}"]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=VERIFY_FETCH_TIMEOUT_S)
    doc = json.loads(out.stdout)
    if not doc.get("ok"):
        raise RuntimeError(f"Clay read failed: {str(doc.get('reason', ''))[:120]}")
    return doc["data"]


WS_RE = re.compile(r"[0-9]{1,12}")
CID_RE = re.compile(r"cam_[A-Za-z0-9]{1,64}")


def key_id(key):
    return hashlib.sha256(b"gtme-grade key id:" + key).hexdigest()[:16]


def receipt_file(ws, cid, action):
    """The only place a receipt can live: a fixed directory under the hook's own
    HOME, named from values that were validated first. Never a caller's path."""
    if not WS_RE.fullmatch(str(ws)) or not CID_RE.fullmatch(cid or "") or action not in ACTIONS:
        raise ValueError(f"refusing a receipt name from {ws!r}, {cid!r}, {action!r}")
    return STATE / f"{ws}-{cid}-{action}.json"


def canonical(body):
    """The exact bytes signed: sorted keys, no whitespace, ints only for numbers
    (a float's text can differ between writers)."""
    def walk(v):
        if isinstance(v, float):
            raise ValueError("floats are not signed")
        if isinstance(v, dict):
            for x in v.values():
                walk(x)
        if isinstance(v, list):
            for x in v:
                walk(x)
    walk(body)
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def sign(body, key):
    import hmac
    return hmac.new(key, canonical(body), hashlib.sha256).hexdigest()


def input_roots():
    """Graded files must sit under one of these, resolved. Read from the
    verifier's own environment, which a tool call cannot set."""
    raw = os.environ.get("GTME_GRADE_INPUT_ROOTS") or os.path.expanduser("~")
    return [os.path.realpath(r) for r in raw.split(os.pathsep) if r]


def check_input(p):
    """'' for a regular, non-symlinked file under an allowed root; else why not."""
    if not os.path.isabs(p):
        return f"{p} is not an absolute path"
    if os.path.realpath(p) != os.path.normpath(p):
        return f"{os.path.basename(p)} sits behind a symlink"
    if os.path.islink(p) or not os.path.isfile(p):
        return f"{os.path.basename(p)} is not a regular file"
    if not any(os.path.commonpath([p, r]) == r for r in input_roots()):
        return f"{os.path.basename(p)} is outside the allowed input roots"
    return ""


def write_receipt(ws, cid, action, camp, gates, inputs):
    """Bound to one workspace, one campaign, one action, these exact inputs and
    this key, and signed, so a pass for one target never unlocks another."""
    dest = receipt_file(ws, cid, action)
    # Checked as given, not resolved first: a symlinked input is refused here
    # rather than quietly replaced by its target.
    paths = [os.path.abspath(p) for p in inputs]
    for p in paths:
        why = check_input(p)
        if why:
            raise ValueError(f"no receipt: {why}")
    key = load_key(create=True)
    now = int(time.time())
    body = {"v": 3, "workspace": str(ws), "campaign": cid, "action": action, "key_id": key_id(key),
            "name": camp.get("name"), "time": now, "expires": now + RECEIPT_TTL_S, "pass": True,
            "gates": [g.n for g in gates if g.passed],
            "inputs": {p: sha(p) for p in paths},
            "campaign_state": canonical_state(camp.get("raw"))}
    body["mac"] = sign(body, key)
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = dest.with_name(f".{dest.name}.{os.getpid()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(json.dumps(body, indent=1))
    os.replace(tmp, dest)
    return dest


SIGNED = ("v", "workspace", "campaign", "action", "key_id", "name", "time", "expires", "pass",
          "gates", "inputs", "campaign_state")


def verify(ws, cid, action):
    """'' when a signed, fresh, passing grade for exactly this workspace,
    campaign and action exists and nothing it graded has changed; else why not.
    Takes only those three values; the receipt, the key and the inputs are found
    from fixed places and the signed record. Every error is a refusal, and the
    key is never created here."""
    import hmac
    try:
        path = receipt_file(ws, cid, action)
    except ValueError as exc:
        return str(exc)
    try:
        if os.path.islink(STATE) or os.path.islink(path):
            return "the grade receipt or its directory is a symlink"
        if not path.exists():
            return f"no gtme-grade pass for {action} on {cid} in workspace {ws}"
        st = path.stat()
        if st.st_uid != os.getuid() or st.st_mode & 0o077:
            return "the grade receipt is not a 0600 file owned by this user"
        body = json.loads(path.read_text())
        key = load_key(create=False)
    except (OSError, ValueError, PermissionError) as exc:
        return f"grade receipt unreadable: {exc}"
    if not isinstance(body, dict):
        return "grade receipt is not an object"
    mac = body.pop("mac", None)
    if not isinstance(mac, str) or len(mac) != 64:
        return "grade receipt carries no signature"
    if set(body) != set(SIGNED):
        return "grade receipt fields differ from what gtme-grade signs"
    try:
        good = hmac.compare_digest(mac, sign(body, key))
    except ValueError:
        good = False
    if not good:
        return "grade receipt signature does not verify (written by something other than gtme-grade)"
    if body["key_id"] != key_id(key):
        return "grade receipt was signed with a different key"
    if (body["workspace"], body["campaign"], body["action"]) != (str(ws), cid, action):
        return (f"grade receipt is for {body['action']} on {body['campaign']} in "
                f"{body['workspace']}, not {action} on {cid} in {ws}")
    if body["pass"] is not True:
        return "the recorded grade is not a pass"
    now = time.time()
    t, exp = body["time"], body["expires"]
    if not (isinstance(t, int) and isinstance(exp, int)) or exp - t != RECEIPT_TTL_S \
            or not (t <= now < exp):
        return "the gtme-grade pass is over 12 hours old or not yet valid"
    inputs = body["inputs"]
    if not isinstance(inputs, dict) or not inputs:
        return "the grade receipt names no input files"
    for p, want in inputs.items():
        if not os.path.exists(p) and not os.path.islink(p):
            return f"{os.path.basename(p)} vanished after gtme-grade passed"
        why = check_input(p)
        if why:
            return why
        if sha(p) != want:
            return f"{os.path.basename(p)} changed after gtme-grade passed"
    try:
        live = canonical_state(fetch_state(ws, cid))
    except Exception as exc:  # any failure to re-read the campaign refuses
        return f"could not re-read the campaign from Clay to compare: {exc}"
    if not hmac.compare_digest(live, str(body["campaign_state"])):
        return "the campaign's copy, variants, settings or senders changed after gtme-grade passed"
    return ""


PRESEND = Path(os.path.expanduser("~/.chewbacca/state/send-gate-receipt.json"))


def presend_ok():
    """The client's pre-send gate (zeutara-gtme scripts/pre_send_gate.py) must
    also have passed in full in the last 12 hours on unchanged files. This was
    launch-guard's first check; it moved here with the rest on 2026-10-10."""
    try:
        r = json.loads(PRESEND.read_text())
    except (OSError, ValueError):
        return "no pre-send gate receipt (scripts/pre_send_gate.py with every check on)"
    if r.get("full") is not True:
        return "the last pre-send gate pass skipped a check"
    t = r.get("time")
    if not isinstance(t, int) or not (0 <= time.time() - t < RECEIPT_TTL_S):
        return "the last full pre-send gate pass is over 12 hours old"
    hashes = r.get("hashes") or {}
    if not hashes:
        return "the pre-send gate receipt names no input files"
    for path, want in hashes.items():
        try:
            if sha(path) != want:
                return f"{os.path.basename(path)} changed after the pre-send gate passed"
        except OSError:
            return f"{os.path.basename(path)} vanished after the pre-send gate passed"
    return ""


def verify_request(ws, cid, action, audience=None):
    """What a check asks: a grade for this action, plus the pre-send gate; for
    add-leads (the one write chewbacca clay gates on a grade) the audience must
    also be this campaign's own base segment. There is no `start`: Clay decides
    launch vs resume at send time, so a START is never sent by the kit."""
    if action not in ACTIONS:
        return f"unknown action {action!r}"
    try:
        receipt_file(ws, cid, ACTIONS[0])  # validates ws and cid
    except ValueError as exc:
        return str(exc)
    why = presend_ok()
    if why:
        return why
    if action == "add-leads":
        try:
            doc = fetch_state(ws, cid)
        except Exception as exc:  # a read that fails refuses
            return f"could not read the campaign from Clay: {exc}"
        if audience is None:
            return "add-leads needs the audience it changes"
        base = doc.get("leadBaseSegmentId") or (doc.get("audience") or {}).get("id")
        if not base or base != audience:
            return f"audience {audience} is not campaign {cid}'s base segment"
    return verify(ws, cid, action)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="gtme-grade", description=__doc__.split("\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_argument_group("the campaign (one of)")
    src.add_argument("--campaign", help="Clay campaign id, read through chewbacca clay")
    src.add_argument("--campaign-json", help="a saved `chewbacca clay campaign` answer")
    src.add_argument("--copy", help="local copy file: steps split by ---, Subject:/Delay:/Variant: headers")
    ap.add_argument("--ws", default=os.environ.get("CLAY_WORKSPACE_ID", "1372623"))
    ap.add_argument("--analytics-json", help="a saved `chewbacca clay campaign-analytics` answer")
    ap.add_argument("--settings", help="campaign settings JSON in Clay's shape, for --copy")
    ap.add_argument("--name", help="receipt key for --copy (a Clay id is used when given)")
    ap.add_argument("--leads", help="the send list CSV")
    ap.add_argument("--field-map", action="append",
                    help="FIELD=COLUMN: a campaign merge field (e.g. a Clay audience field id) "
                         "and the leads column that holds it (repeatable)")
    ap.add_argument("--verification", help="CSV of email + verifier verdict, joined by email")
    ap.add_argument("--suppress", action="append", help="CSV of addresses never to email (repeatable)")
    ap.add_argument("--senders", help="sender accounts: `clay campaigns options sender-accounts` JSON "
                                      "or a CSV (id, email, displayName, warmup_days, health)")
    ap.add_argument("--warmup-start", help="YYYY-MM-DD every inbox began warming, when no per-inbox age")
    ap.add_argument("--today", help=argparse.SUPPRESS)
    ap.add_argument("--primary-domain", help="the company's own domain; cold mail never goes from it")
    ap.add_argument("--refuse-sender", action="append", help="regex of inbox addresses the client refused")
    ap.add_argument("--client", help="client name in ~/.chewbacca/gtm/clients.json "
                                     "(refused_senders, primary_domain)")
    ap.add_argument("--sender-name", help="the person the email comes from (else --client's principal "
                                          "or the senders' display names)")
    ap.add_argument("--sender-company", help="the company the email comes from (else --client's "
                                             "sender_company or name)")
    ap.add_argument("--offer", help="what is sold, in concrete nouns (\"dating app pre-seed round\"); "
                                    "email 1 and its subject must name it")
    ap.add_argument("--signal", help="the signal this campaign's leads were cut on, when no leads "
                                     "column carries it")
    ap.add_argument("--icp-titles", help="comma list of title words that match the ICP")
    ap.add_argument("--icp-fit-column", help="column holding a yes/no ICP fit per row")
    ap.add_argument("--review", help="JSON recording the recipient read: campaign, reviewer, "
                                     "reviewed_at, unresolved[]")
    ap.add_argument("--audience", help="with --verify --action add-leads: the audience the write changes")
    ap.add_argument("--action", choices=ACTIONS,
                    help="what this grade unlocks for the campaign (one of the three actions). "
                         "A receipt is written only with an action and a Clay campaign id")
    ap.add_argument("--verify", action="store_true",
                    help="check a stored grade for --campaign, --ws and --action against the "
                         "current inputs and the live campaign; exit 0 or 2 (the guard hook uses this)")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    if args.verify:
        if not (args.campaign and args.action):
            print("gtme-grade --verify: needs --campaign and --action", file=sys.stderr)
            return 2
        why = verify_request(args.ws, args.campaign, args.action, args.audience)
        if why:
            print(f"gtme-grade: {why}", file=sys.stderr)
            return 2
        print(f"gtme-grade: verified {args.action} on {args.campaign} in {args.ws}")
        return 0
    try:
        camp, gates, passed, inputs = grade(args)
    except (OSError, ValueError) as exc:
        print(f"gtme-grade: {exc}", file=sys.stderr)
        return 2
    key = camp.get("id") or args.name
    receipt = None
    if passed and args.action and camp.get("raw") is not None and camp.get("id"):
        try:
            receipt = str(write_receipt(args.ws, camp["id"], args.action, camp, gates, inputs))
        except (OSError, ValueError, PermissionError) as exc:
            print(f"gtme-grade: {exc}", file=sys.stderr)
            return 2
    if args.json:
        print(json.dumps({"campaign": key, "name": camp.get("name"), "pass": passed,
                          "receipt": receipt, "gates": [g.as_dict() for g in gates]}, indent=1))
    else:
        print(f"gtme-grade: {camp.get('name') or key}")
        for g in gates:
            score = f" {g.score:.0f}/100" if g.score is not None else ""
            print(f"\n  gate {g.n} {g.title}: {'PASS' if g.passed else 'FAIL'}{score}")
            for m in g.unchecked:
                print(f"    {m}")
            for m in g.fails:
                print(f"    FAIL  {m}")
            for m in g.warns:
                print(f"    warn  {m}")
            for m in g.notes:
                print(f"    note  {m}")
        print("\n  " + (f"PASS, receipt {receipt}" if passed and receipt else
                        "PASS, but no receipt: a receipt needs --action and a Clay campaign "
                        "(--campaign or --campaign-json)" if passed else
                        "REFUSED. Fix each FAIL and NOT CHECKED line, then grade again."))
        print("  Grading never authorizes the send.")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
