#!/usr/bin/env python3
"""chewbacca gtme: a full-time growth engineer for someone who has never heard of Clay.

    gtme                     same as `gtme start`
    gtme start               plain questions about your business -> ICP, offer, first campaign plan
    gtme list --client NAME  build the first list from public sources and dedupe it (free, read only)
    gtme setup               connect Clay (if you have it), name each workspace, run the first sync
    gtme brief [--sync]      the morning standup: replies to answer, alarms, credits, top 3 actions
    gtme next                every client's to-do list, each with its command and its gate
    gtme report --client NAME [--week]   the Friday client summary, as markdown and a PDF in ~/Downloads
    gtme rule --client NAME "always/never ..." --who WHO   save a client's standing ruling; brief, next
                             and report flag any recommendation that would cross it
    gtme explain TERM        one plain sentence for a word like ICP or deliverability
    gtme why                 why the last recommendation was made, with its numbers and rule
    gtme sync                refresh the graph (chewbacca gtm sync) and record credit balances

Nothing here sends an email, spends a credit or creates an account. Reads run
freely; anything that sends, spends or changes a campaign is printed with the
exact command and the words "needs your approval". All state stays on this
machine under ~/.chewbacca/gtm (GTME_HOME overrides it).

Numbers come from the local graph `chewbacca gtm sync` writes and from the
credit snapshots `gtme sync` records; every one carries its source and when
it was read. Benchmarks come from skills/gtm-engineering/references/
demand-gen-playbooks.md and are cited by rule, not invented.
"""
from __future__ import annotations

import argparse
import csv
import html
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "bin" / "lib"
sys.path.insert(0, str(LIB))
# bin/gtme runs this file with runpy, which leaves tools/ off the path:
# gtme_reply (the kit's reply cleaner and name fixer) lives beside it.
sys.path.insert(1, str(ROOT / "tools"))

CLAY_SIGNUP = "https://app.clay.com/signup"
CLAY_LOGIN = "https://app.clay.com"
CALENDAR_PANE = "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars"

# ── benchmarks, each from demand-gen-playbooks.md ─────────────────────────
# "Floor is 1% reply rate, target 2-4%. 20-40% of replies should be positive.
# Expect 1 qualified lead per 350-500 contacts." (discoveredlabs, line 34)
REPLY_FLOOR = 0.01
JUDGE_AFTER_SENDS = 200
CONTACTS_PER_MEETING = 400  # midpoint of 350-500
# "Instantly: ... bounce under 2%" (line 47); "Above 2% bounce, triage; above
# 3%, pause the campaign." (Growth Engine X weekly rhythm, line 125)
BOUNCE_TRIAGE = 0.02
BOUNCE_PAUSE = 0.03
# "Max 30 sends per inbox per day" (Lieben, line 10); 3-step sequence (line 13).
SENDS_PER_INBOX_DAY = 30
SEQUENCE_STEPS = 3
# "Under 500 sends per arm can't separate signal from noise" (line 129).
SENDS_PER_ARM = 500
# Answer positive replies within 30 minutes (Growth Engine X, line 132).
POSITIVE_ANSWER_MINUTES = 30
# A campaign with fewer unsent leads than this runs out inside about two
# sending days at a small test's pace (2 inboxes x 30 a day = 60). Guessed
# from the inbox cap above, never measured against a real campaign's drain.
RUN_DRY_LEADS = 60
# Seven days of credits left is one week of warning: a top-up has time to
# land before a Monday run. Guessed, never measured.
CREDIT_DAYS_ALARM = 7
# A brief older than a day is reading yesterday's inbox.
STALE_SYNC_HOURS = 24
# The reply-rate drop alarm compares two syncs at least this many new sends
# apart; under 100 sends one reply moves the rate by a whole point.
DROP_MIN_NEW_SENDS = 100
# Most replies to a cold email arrive within three days of it (guessed from
# the 3-day gap between sequence steps in the playbook, line 115; never
# measured on our own inbox).
REPLY_LAG_DAYS = 3

# ── the glossary: every term taught once, in one plain sentence ───────────
GLOSSARY = {
    "growth engineer": "A growth engineer (GTME) runs the system that finds likely buyers, writes to them "
                       "and books sales meetings.",
    "outbound": "Outbound means you reach out first, mostly by email, to people who haven't heard of you.",
    "cold email": "A cold email is an email to someone who doesn't know you yet.",
    "Clay": "Clay is a web app that finds companies and people, looks up their work emails, "
            "and sends your emails for you; think of it as the engine under the hood.",
    "ICP": "ICP means ideal customer profile: a short description of the companies and people "
           "most likely to buy, so you only email them.",
    "offer": "The offer is the specific thing you give a prospect for replying, like a free audit "
             "or a test run, which works better than asking for a meeting.",
    "campaign": "A campaign is one batch of cold emails, sent to one list, with one message.",
    "sequence": "A sequence is the set of emails one person gets in a row, usually 3, a few days "
                "apart, until they reply.",
    "lead": "A lead is one person you might sell to.",
    "list": "The list is the spreadsheet of companies and people a campaign emails.",
    "enrichment": "Enrichment means filling in missing facts about a lead, like their work email "
                  "or company size, by looking them up in data providers.",
    "waterfall": "A waterfall tries several data providers in order and stops at the first one "
                 "that finds the answer, so you only pay for what is found.",
    "credits": "Credits are Clay's currency: each lookup or AI step costs some, and a workspace "
               "buys them in advance.",
    "workspace": "A workspace is one account area in Clay, usually one per company you run "
                 "outbound for.",
    "deliverability": "Deliverability is whether your emails land in the inbox instead of spam; "
                      "it drops when you send too much, too fast, or to bad addresses.",
    "bounce rate": "Bounce rate is the share of emails that came back undelivered, usually because "
                   "the address does not exist.",
    "reply rate": "Reply rate is replies divided by emails sent.",
    "positive reply rate": "Positive reply rate is interested replies divided by emails sent; it is "
                           "the number that predicts meetings.",
    "dedupe": "To dedupe is to merge rows that are the same company or person, so nobody gets "
              "emailed twice.",
    "Form D": "A Form D is a public SEC filing a company makes when it raises money, often weeks "
              "before any press release.",
    "signal": "A signal is a public event, like a fundraise or a job post, that suggests a company "
              "needs what you sell right now.",
    "sending inbox": "A sending inbox is one email address your campaigns send from; you spread sends "
                     "across several so none of them looks like spam.",
}
# How each term is found in a line. Clay and Form D are proper nouns, so they
# match case-sensitively; the rest match any case, whole words only.
CASE_SENSITIVE = {"Clay", "Form D", "ICP"}


def _term_re(term: str) -> re.Pattern:
    flags = 0 if term in CASE_SENSITIVE else re.IGNORECASE
    return re.compile(r"(?<![\w`-])" + re.escape(term) + r"(?:e?s)?(?![\w`])", flags)


TERM_RES = {t: _term_re(t) for t in GLOSSARY}

# Reply classes the graph uses (gtm_ingest REPLY_CLASSES) -> the next step a
# GTME takes, from the playbook's reply-handling rules (lines 126-132).
REPLY_NEXT = {
    "positive": f"answer within {POSITIVE_ANSWER_MINUTES} minutes: answer what they asked, then suggest two specific times",
    "neutral": "answer the question in two lines, then ask one low-effort yes/no question",
    None: "read it and classify it; until then treat it as a question to answer",
}


# ── state on disk ─────────────────────────────────────────────────────────


def home() -> Path:
    return Path(os.environ.get("GTME_HOME") or Path.home() / ".chewbacca" / "gtm")


def config_path() -> Path:
    return Path(os.environ.get("GTM_CONFIG") or home() / "clients.json")


def client_dir(name: str) -> Path:
    """A client's state, or the folder its clients.json entry names in
    `state_dir`: a shared repo, so two people's Chewbaccas read one ledger."""
    cfg = read_json(config_path(), {})
    for c in (cfg.get("clients") or []) if isinstance(cfg, dict) else []:
        if isinstance(c, dict) and slug(c.get("name", "")) == slug(name) and c.get("state_dir"):
            return Path(os.path.expanduser(str(c["state_dir"])))
    return home() / "clients" / slug(name)


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-") or "unnamed"


def read_json(path: Path, fallback):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return fallback


def write_json(path: Path, body) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(body, indent=1, default=str) + "\n")
    os.chmod(tmp, 0o600)
    tmp.replace(path)


def utc_now() -> datetime:
    fixed = os.environ.get("GTME_NOW")
    if fixed:
        return datetime.fromisoformat(fixed)
    return datetime.now(timezone.utc)


def stamp() -> str:
    return utc_now().isoformat(timespec="seconds")


def parse_time(text) -> datetime | None:
    if not text:
        return None
    try:
        t = datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    except ValueError:
        try:
            t = datetime.fromisoformat(str(text)[:10])
        except ValueError:
            return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def age(text) -> str:
    t = parse_time(text)
    if not t:
        return "unknown age"
    secs = int((utc_now() - t).total_seconds())
    if secs < 5400:
        return f"{max(secs, 0) // 60}m ago"
    if secs < 172800:
        return f"{secs // 3600}h ago"
    return f"{secs // 86400}d ago"


# ESC sequences first, whole: CSI (ESC [ ... final byte), OSC (ESC ] ... BEL or
# ST, which is how OSC 8 plants a link and OSC 0/2 retitle the window), and
# any other two-byte ESC form. Then the lone control characters gtm_ingest
# already strips at ingest (C0 but tab and newline, DEL, C1 incl. U+009B,
# zero-width and bidi overrides), reused from there so the two never drift.
ESC_SEQ = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-_]?")
try:
    from gtm_ingest import CONTROL  # noqa: E402
except Exception:  # noqa: BLE001  the ingester failing to import must not stop a brief
    CONTROL = re.compile("[\x00-\x08\x0b-\x1f\x7f-\x9f\u200b-\u200f\u2028\u2029\u202a-\u202e"
                         "\u2066-\u2069\ufeff]")
SAFE_MAX = 2000


def safe(text, limit: int = SAFE_MAX) -> str:
    """Any string bound for the terminal, the markdown or the PDF. Values from
    Clay and reply emails are written by strangers; an escape sequence in one
    could clear the screen, hide a line or plant a clickable link."""
    text = ESC_SEQ.sub("", str(text if text is not None else ""))
    text = CONTROL.sub(" ", text)
    return text if len(text) <= limit else text[:limit - 1] + "…"


MD_SPECIAL = re.compile(r"([\\`*_\[\]()<>|#!])")


def md(text, limit: int = 200) -> str:
    """safe(), then every markdown control character escaped, so a company
    or campaign name can't become a link, an image, HTML or a table cell."""
    return MD_SPECIAL.sub(r"\\\1", safe(text, limit).replace("\n", " "))


def pct(n, d) -> str:
    return f"{100.0 * n / d:.1f}%" if d else "n/a"


# ── teaching: every term once, per person ─────────────────────────────────


class Teacher:
    """Prints lines, and the first time a glossary term appears for this
    person, prints its one-sentence meaning right under it and remembers it in
    learned.json. A line with an untaught term never goes out bare."""

    def __init__(self, quiet: bool = False, out=None):
        self.path = home() / "learned.json"
        self.state = read_json(self.path, {"terms": {}, "lessons": {}})
        self.state.setdefault("terms", {})
        self.state.setdefault("lessons", {})
        self.quiet = quiet
        self.out = out or sys.stdout
        self.dirty = False

    def known(self, term: str) -> bool:
        return term in self.state["terms"]

    def teach(self, term: str) -> str:
        self.state["terms"][term] = stamp()
        self.dirty = True
        return GLOSSARY[term]

    def say(self, line: str = "") -> None:
        # Every line passes through safe(): it carries campaign names, lead
        # addresses and reply text that strangers wrote.
        line = safe(line)
        print(line, file=self.out)
        if self.quiet:
            return
        # Quoted text is data (a campaign name, a reply), not our words, so a
        # term inside it is not one we used.
        self._explain(re.sub(r'"[^"]*"', " ", line))

    def _explain(self, text: str) -> None:
        # A definition can use another term ("credits ... a workspace"), so
        # each one printed is scanned in turn; teach() marks a term known
        # before recursing, which ends the chain.
        for term, rx in TERM_RES.items():
            if not self.known(term) and rx.search(text):
                definition = self.teach(term)
                print(f"    ({definition})", file=self.out)
                self._explain(definition)

    def lesson_seen(self, key: str) -> bool:
        return key in self.state["lessons"]

    def lesson_done(self, key: str) -> None:
        self.state["lessons"][key] = stamp()
        self.dirty = True

    def save(self) -> None:
        if self.dirty:
            write_json(self.path, self.state)


# ── talking to the person ─────────────────────────────────────────────────


class Asker:
    """One question, one default. Reads stdin whether or not it is a
    terminal, so a test can pipe answers; EOF takes the default."""

    def __init__(self, teacher: Teacher, assume_yes: bool = False):
        self.t = teacher
        self.assume_yes = assume_yes

    def ask(self, question: str, default: str = "") -> str:
        hint = f" [{default}]" if default else ""
        self.t.say(f"{question}{hint}")
        if self.assume_yes:
            print(f"> {default}", file=self.t.out)
            return default
        try:
            line = input("> ")
        except EOFError:
            line = ""
        return line.strip() or default

    def yes(self, question: str, default: bool = False) -> bool:
        ans = self.ask(f"{question} (yes/no)", "yes" if default else "no").lower()
        return ans in ("y", "yes", "yeah", "yep", "ok", "sure")


def open_url(url: str) -> bool:
    """Open a page for the person. Never in tests or on a machine with no
    `open`. Opening a page is all it does: no account is created, nothing typed."""
    if os.environ.get("GTME_NO_OPEN") or not shutil.which("open"):
        return False
    try:
        subprocess.run(["open", "-g", url], check=False, timeout=10,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except (OSError, subprocess.SubprocessError):
        return False


# ── the engines, as black boxes ───────────────────────────────────────────


def run_json(argv: list[str], fixture: str, timeout: int = 90) -> dict:
    """Run one kit command that prints JSON. GTME_FIXTURES=<dir> answers from
    <dir>/<fixture>.json instead (a missing file reads as a failed call), so
    tests never touch the network."""
    fx = os.environ.get("GTME_FIXTURES")
    if fx:
        body = read_json(Path(fx) / f"{fixture}.json", None)
        return body if isinstance(body, dict) else {"ok": False, "reason": f"no fixture {fixture}"}
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError) as err:
        return {"ok": False, "reason": str(err)[:200]}
    text = (p.stdout or "").strip().splitlines()
    for line in reversed(text):
        if line.startswith("{"):
            try:
                return json.loads(line)
            except ValueError:
                break
    return {"ok": False, "reason": ((p.stderr or p.stdout or "").strip()[:200] or f"exit {p.returncode}")}


def clay(op: str, **kv) -> dict:
    argv = ["node", str(ROOT / "bin" / "chewbacca-clay"), op] + [f"{k}={v}" for k, v in kv.items()]
    return run_json(argv, f"clay-{op}")


def api(site: str, op: str, **kv) -> dict:
    argv = ["bash", str(ROOT / "bin" / "chewbacca-api"), "call", site, op] + [f"{k}={v}" for k, v in kv.items()]
    return run_json(argv, f"api-{site}-{op}")


def detect_clay() -> dict:
    """{"ok": bool, "workspaces": [{"id","name"}], "how": str}. The kit's own
    session import first (chewbacca clay reads the signed-in browser
    session), then the official clay CLI."""
    r = clay("workspaces")
    rows = r.get("data") if r.get("ok") else None
    if isinstance(rows, list) and rows:
        return {"ok": True, "how": f"chewbacca clay ({r.get('surface', 'session')})",
                "workspaces": [{"id": str(w.get("id")), "name": str(w.get("name") or w.get("id"))}
                               for w in rows if isinstance(w, dict) and w.get("id")]}
    if not os.environ.get("GTME_FIXTURES") and shutil.which("clay"):
        try:
            p = subprocess.run(["clay", "workspaces", "list"], capture_output=True, text=True, timeout=30)
            body = json.loads(p.stdout or "{}")
            rows = body.get("data") if isinstance(body, dict) else None
            if isinstance(rows, list) and rows:
                return {"ok": True, "how": "clay CLI",
                        "workspaces": [{"id": str(w.get("id")), "name": str(w.get("name") or w.get("id"))}
                                       for w in rows if isinstance(w, dict) and w.get("id")]}
        except (OSError, subprocess.SubprocessError, ValueError):
            pass
    return {"ok": False, "workspaces": [], "how": "", "reason": r.get("reason") or "not signed in"}


# ── the client config, shared with chewbacca gtm ──────────────────────────


def load_config() -> dict:
    body = read_json(config_path(), {"clients": []})
    if not isinstance(body, dict) or not isinstance(body.get("clients"), list):
        raise SystemExit(f"gtme: {config_path()} is not a {{\"clients\": [...]}} file; fix or move it")
    return body


def merge_clients(cfg: dict, answers: list[dict]) -> dict:
    """answers: [{"workspace": id, "name": client or ""}]. A blank name
    leaves that workspace unassigned. Everything else a client already had
    (offers, reply labels, do-not-contact) is kept; a workspace moves to the
    named client and off any other, so no workspace has two owners."""
    clients = [dict(c) for c in cfg.get("clients") or []]
    for a in answers:
        ws, name = str(a["workspace"]), (a.get("name") or "").strip()
        for c in clients:
            wss = [str(w) for w in c.get("workspaces") or []]
            if ws in wss and " ".join(c["name"].lower().split()) != " ".join(name.lower().split()):
                c["workspaces"] = [w for w in wss if w != ws]
        if not name:
            continue
        hit = next((c for c in clients if " ".join(c["name"].lower().split()) == " ".join(name.lower().split())),
                   None)
        if hit is None:
            hit = {"name": name, "workspaces": []}
            clients.append(hit)
        if ws not in [str(w) for w in hit.get("workspaces") or []]:
            hit["workspaces"] = [str(w) for w in hit.get("workspaces") or []] + [ws]
    return {**cfg, "clients": clients}


def owner_of(cfg: dict, ws: str) -> str:
    for c in cfg.get("clients") or []:
        if str(ws) in [str(w) for w in c.get("workspaces") or []]:
            return c["name"]
    return ""


# ── gtme start: from the business, not from Clay ──────────────────────────


def classify_market(text: str) -> str:
    t = (text or "").lower()
    if re.search(r"\b(restaurant|caf[eé]|baker|salon|clinic|dentist|gym|shop|store|plumb|roof|contractor|"
                 r"local|realtor|law firm|food truck|spa|studio)\w*", t):
        return "local"
    if re.search(r"\b(investor|vc|venture|fund|angel|family office)\w*", t):
        return "investors"
    if re.search(r"\b(startup|saas|software|ai|tech|founder|yc|seed|series)\w*", t):
        return "startups"
    return "companies"


def build_plan(ans: dict) -> dict:
    """The answers -> ICP, offer, first campaign plan. Every number in it is
    computed from a cited playbook rule; nothing is a guess dressed as data."""
    meetings = max(1, int(re.sub(r"\D", "", str(ans.get("meetings") or "2")) or 2))
    contacts_week = meetings * CONTACTS_PER_MEETING
    sends_week = contacts_week * SEQUENCE_STEPS
    inboxes = -(-sends_week // (SENDS_PER_INBOX_DAY * 5))
    market = classify_market(" ".join(str(ans.get(k) or "") for k in ("buyer", "great")))
    proof = (ans.get("proof") or "").strip()
    where = (ans.get("where") or "").strip()
    query = (ans.get("great") or ans.get("buyer") or "").strip()
    sources = []
    if market == "local":
        sources.append({"tool": "chewbacca api", "site": "google-maps", "op": "searchPlaces",
                        "args": {"query": f"{query} in {where}".strip() if where else query},
                        "why": "local businesses with phone, website and rating"})
    if market in ("startups", "companies"):
        sources.append({"tool": "chewbacca api", "site": "yc", "op": "searchCompanies",
                        "args": {"query": ans.get("industry") or query.split(",")[0][:40]},
                        "why": "startups with website, size and stage"})
    if market in ("startups", "investors", "companies"):
        sources.append({"tool": "gtme-signals", "op": "formd", "args": {"limit": "50"},
                        "why": "companies that just raised money (a buying signal)"})
    offer_cta = ("Want me to send the one-page result for your company?" if proof
                 else "Worth a free test on your account first? Feel free to say no.")
    plan = {
        "client": ans["name"],
        "made_at": stamp(),
        "approved": False,
        "answers": ans,
        "icp": {
            "buyer": ans.get("buyer") or "",
            "company": ans.get("great") or "",
            "where": where,
            "market": market,
            "leave_out": "interns, assistants, students and retired titles; companies you already work with",
        },
        "offer": {
            "what_you_sell": ans.get("sell") or "",
            "proof": proof or None,
            "promise": (f"{ans.get('sell')}, with proof: {proof}" if proof
                        else f"{ans.get('sell')}, offered as a free small test because there is no proof yet"),
            "cta": offer_cta,
            "rule": "An offer beats a meeting ask (Gong via Lieben: +28% vs -44%); with no proof, "
                    "lower the risk with a free test.",
        },
        "math": {
            "meetings_per_week": meetings,
            "contacts_per_week": contacts_week,
            "emails_per_week": sends_week,
            "sending_inboxes": inboxes,
            "rule": f"1 qualified lead per 350-500 contacts (used {CONTACTS_PER_MEETING}); {SEQUENCE_STEPS} "
                    f"emails each; at most {SENDS_PER_INBOX_DAY} sends per inbox per day",
        },
        "first_test": {
            "contacts": JUDGE_AFTER_SENDS,
            "rule": f"{JUDGE_AFTER_SENDS} contacts is enough to see whether replies clear the "
                    f"{REPLY_FLOOR:.0%} floor; comparing two messages needs about {SENDS_PER_ARM} each",
        },
        "sources": sources,
        "copy": draft_copy(ans, offer_cta),
    }
    plan["steps"] = plan_steps(plan, clay_connected=False)
    return plan


def buyers(ans: dict) -> str:
    """"the owner" -> "owners", so a sentence about the group reads right.
    On 2026-10-11 the follow-up printed "most the owner we talk to"."""
    b = re.sub(r"^(the|a|an)\s+", "", (ans.get("buyer") or "").strip(), flags=re.I)
    if not b:
        return "teams like yours"
    head, _, tail = b.partition(" or ")
    head = head if head.endswith("s") else head + "s"
    return head


def draft_copy(ans: dict, cta: str) -> list[dict]:
    sell = (ans.get("sell") or "what we do").rstrip(".")
    proof = (ans.get("proof") or "").rstrip(".")
    sender = ans.get("sender") or "{{your first name}}"
    line2 = f"{proof}." if proof else "We'd prove it on a small test before you pay anything."
    return [
        {"step": 1, "day": 0, "subject": "{{company}} " + (ans.get("topic") or "question").lower()[:30],
         "body": f"Hi {{{{first_name}}}},\n\n{{{{signal_line}}}}\n\nWe help {buyers(ans)} "
                 f"with {sell[:1].lower() + sell[1:]}. {line2}\n\n{cta}\n\n{sender}"},
        {"step": 2, "day": 3, "subject": "", "body": f"Hi {{{{first_name}}}}, one more thought: most "
                 f"{buyers(ans)} we talk to lose time on this every week. Happy to show you "
                 f"how it would work for {{{{company}}}}.\n\n{sender}"},
        {"step": 3, "day": 7, "subject": "worth a look?", "body": "Hi {{first_name}}, if this isn't yours, who "
                 f"at {{{{company}}}} owns it? Either way, thanks for reading.\n\n{sender}"},
    ]


def plan_steps(plan: dict, clay_connected: bool) -> list[dict]:
    c = plan["client"]
    test = plan["first_test"]["contacts"]
    steps = [
        {"do": "Approve this plan", "cost": "free", "gate": "needs your approval",
         "command": f"chewbacca gtme start --client \"{c}\""},
        {"do": "Build the first list from public sources and dedupe it", "cost": "free",
         "gate": "read only, no approval", "command": f"chewbacca gtme list --client \"{c}\""},
    ]
    if clay_connected:
        steps.append({"do": "Move the deduped list into Clay", "cost": "free to import",
                      "gate": "needs your approval", "command": "chewbacca clay route find-people"})
    else:
        # No Clay: the own-inbox path (tools/gtme_solo.py). A person paying for
        # this has one Gmail and no Clay plan, so the emails come from each
        # company's own site and go out from that Gmail.
        steps += [
            {"do": "Set the name and mailing address every email signs with", "cost": "free",
             "gate": "your answer", "command": f"chewbacca gtme sender --client \"{c}\" --name \"...\" "
                                                f"--address \"...\""},
            {"do": "Find each company's email and a fact on its own website", "cost": "free",
             "gate": "read only, no approval", "command": f"chewbacca gtme find --client \"{c}\""},
            {"do": "Today's batch: read every email, then ok it in chat", "cost": "free",
             "gate": "needs your ok (it sends email)", "command": f"chewbacca gtme today --client \"{c}\""},
        ]
        return steps
    steps += [
        {"do": "Price work-email enrichment on ONE row before running the rest",
         "cost": "a few credits for one row; the full price is known after it", "gate": "needs your approval",
         "command": "chewbacca clay route run-empty-rows"},
        {"do": f"Send a small test: {test} contacts, 3 emails each", "cost": "no credits; uses your sending inboxes",
         "gate": "needs your approval (it sends email)", "command": "chewbacca clay route start-campaign"},
    ]
    return steps


def interview(ask: Asker, client: str | None) -> dict:
    t = ask.t
    t.say("Let's set up your outbound, the way a full-time growth engineer would. Eight questions, "
          "every one has a default, Enter keeps it.")
    name = client or ask.ask("1. What's the business called?", "My business")
    sell = ask.ask("2. What do you sell, in one sentence?", "a service that saves our customers time")
    buyer = ask.ask("3. Who buys it? (their job title)", "the owner or founder")
    great = ask.ask("4. What does a great customer look like? (kind of company, size)", "small companies")
    where = ask.ask("5. Where are they? (a city, a state, or 'anywhere')", "anywhere")
    proof = ask.ask("6. What proof do you have? A case study or a number, like 'cut costs 30% for X'. "
                    "Leave blank if none yet.", "")
    meetings = ask.ask("7. How many sales meetings a week do you want?", "2")
    rules = ask.ask("8. Anything the client has told you to always or never do? (separate several with ';', "
                    "leave blank if none)", "")
    return {"name": name, "sell": sell, "buyer": buyer, "great": great,
            "where": "" if where.lower() == "anywhere" else where, "proof": proof, "meetings": meetings,
            "rules": rules}


def show_plan(t: Teacher, plan: dict) -> None:
    i, o, m, f = plan["icp"], plan["offer"], plan["math"], plan["first_test"]
    t.say("")
    t.say(f"Your plan for {plan['client']}")
    t.say(f"Your ICP: {i['buyer']} at {i['company']}{' in ' + i['where'] if i['where'] else ''}. "
          f"Leave out: {i['leave_out']}.")
    t.say(f"Your offer: {o['promise']}.")
    t.say(f"  Closing line: \"{o['cta']}\"  (why: {o['rule']})")
    t.say(f"The math for {m['meetings_per_week']} meetings a week: about {m['contacts_per_week']} new leads a "
          f"week, {m['emails_per_week']} emails, spread over {m['sending_inboxes']} sending inboxes.")
    t.say(f"  Rule: {m['rule']}.")
    t.say(f"First campaign: a small test of {f['contacts']} people, a 3-email sequence. {f['rule']}.")
    t.say("Where the first list comes from (all free, all public):")
    for s in plan["sources"]:
        t.say(f"  {s.get('site') or s['tool']} {s['op']}: {s['why']}")
    t.say("Draft email 1 (the {{...}} parts get filled per person):")
    for line in plan["copy"][0]["body"].splitlines():
        t.say(f"  | {line}")


def show_steps(t: Teacher, steps: list[dict]) -> None:
    t.say("Steps, in order, each with its cost and whether it needs you:")
    for n, s in enumerate(steps, 1):
        done = " (done)" if s.get("done") else ""
        t.say(f"  {n}. {s['do']}{done}. Cost: {s['cost']}. Gate: {s['gate']}.")
        t.say(f"     {s['command']}")
    nxt = next((s for s in steps if not s.get("done")), None)
    if nxt:
        t.say(f"Next single action: {nxt['do']} ({nxt['cost']}; {nxt['gate']}).")


def cmd_start(a, t: Teacher) -> int:
    ask = Asker(t, a.yes)
    existing = read_json(client_dir(a.client) / "plan.json", None) if a.client else None
    if existing and not a.redo:
        plan = existing
        t.say(f"Picking up the plan for {plan['client']} from {plan['made_at']}.")
        show_plan(t, plan)
    else:
        plan = build_plan(interview(ask, a.client))
        for text in re.split(r"[;\n]", plan["answers"].get("rules") or ""):
            if text.strip():
                add_ruling(plan["client"], text, "the client", "told during chewbacca gtme start")
    if not existing or a.redo:
        show_plan(t, plan)
    if not plan.get("approved"):
        t.say("")
        t.say("Nothing has been sent and nothing has been spent. Approving only saves the plan.")
        if ask.yes("Approve this plan?", False):
            plan["approved"], plan["approved_at"] = True, stamp()
            t.say("Approved and saved.")
        else:
            t.say("Saved as a draft. Run `chewbacca gtme start --client \"%s\"` to approve it." % plan["client"])
    cl = detect_clay()
    plan["steps"] = plan_steps(plan, cl["ok"])
    plan["steps"][0]["done"] = bool(plan.get("approved"))
    path = client_dir(plan["client"]) / "plan.json"
    write_json(path, plan)
    remember_client(plan["client"])
    remember_why("plan", f"Plan for {plan['client']}", [plan["offer"]["rule"], plan["math"]["rule"],
                                                         plan["first_test"]["rule"]])
    t.say("")
    if cl["ok"]:
        t.say(f"Clay is connected ({len(cl['workspaces'])} workspaces). Run `chewbacca gtme setup` to name them.")
    else:
        t.say("No Clay needed. I'll find each company's email on its own website and send from your Gmail, "
              "a few a day, only after you ok each day's emails.")
    if plan.get("approved") and ask.yes("Build your first list now from public sources? It's free and sends "
                                         "nothing.", True):
        build_list(t, plan)
        plan["steps"][1]["done"] = True
        write_json(path, plan)
    show_steps(t, plan["steps"])
    t.say(f"Plan saved at {path}")
    return 0


def remember_client(name: str) -> None:
    """A client planned before Clay exists still belongs in clients.json, with
    no workspaces, so `chewbacca gtm` and `gtme setup` know the name."""
    cfg = load_config()
    if not any(" ".join(c["name"].lower().split()) == " ".join(name.lower().split()) for c in cfg["clients"]):
        cfg["clients"].append({"name": name, "workspaces": []})
        write_json(config_path(), cfg)


# ── client rulings: standing instructions no recommendation crosses silently ──

# On 2026-10-09 a week-1 update told a client we'd "narrow every list" after
# the account lead had ruled the client wants max volume. A ruling lives on the client's entry
# in clients.json ("rulings"), where the client-rulings hook reads it too, and
# in a client repo's DECISIONS.json when one exists.
RULING_MAX = 500


def _same(a: str, b: str) -> bool:
    return " ".join((a or "").lower().split()) == " ".join((b or "").lower().split())


def add_ruling(client: str, rule: str, who: str, source: str | None = None) -> dict:
    """Append one active ruling to the client's entry, creating the entry if
    the client is new. The same rule text twice is kept once."""
    rule = " ".join(safe(rule, RULING_MAX).split())
    who = " ".join(safe(who, 120).split())
    if not rule or not who:
        raise ValueError("a ruling needs the rule text and who made it")
    cfg = load_config()
    entry = next((c for c in cfg["clients"] if _same(c.get("name", ""), client)), None)
    if entry is None:
        entry = {"name": client, "workspaces": []}
        cfg["clients"].append(entry)
    today = utc_now().date().isoformat()
    for r in entry.get("rulings") or []:
        if _same(r.get("rule", ""), rule) and (r.get("status") or "active") == "active":
            return r
    ruling = {"id": slug(rule)[:48], "rule": rule, "who": who, "date": today,
              "source": " ".join(safe(source or f"chewbacca gtme rule, {today}", 200).split()), "status": "active"}
    entry.setdefault("rulings", []).append(ruling)
    write_json(config_path(), cfg)
    return ruling


def client_repos() -> Path:
    return Path(os.environ.get("CHEWBACCA_CLIENT_REPOS") or Path.home() / "code" / "work")


def rulings_for(client: str) -> list[dict]:
    """Every active ruling for a client: its clients.json entry, then any
    client repo DECISIONS.json naming it (by client name or alias)."""
    out = []
    cfg = read_json(config_path(), {"clients": []})
    for c in cfg.get("clients") or [] if isinstance(cfg, dict) else []:
        if isinstance(c, dict) and _same(c.get("name", ""), client):
            out += [dict(r, where=str(config_path())) for r in c.get("rulings") or [] if isinstance(r, dict)]
    try:
        files = sorted(client_repos().glob("*/DECISIONS.json"))
    except OSError:
        files = []
    for path in files:
        d = read_json(path, {})
        if not isinstance(d, dict):
            continue
        names = [d.get("client") or ""] + [a for a in d.get("aliases") or [] if isinstance(a, str)]
        if any(_same(n, client) for n in names):
            out += [dict(r, where=str(path)) for r in d.get("rulings") or [] if isinstance(r, dict)]
    seen, active = set(), []
    for r in out:
        key = " ".join(str(r.get("rule") or "").lower().split())
        if key and key not in seen and (r.get("status") or "active") == "active":
            seen.add(key)
            active.append(r)
    return active


# What a ruling is about, read off its words, and what crosses it. Volume is
# the one that has bitten: "narrow the list" against "max volume".
VOLUME_RULING = re.compile(r"max(?:imum)? volume|\bvolume\b|every list|send to every|never cut|"
                           r"(?:don'?t|do not) cut|order, never cut", re.I)
CUTS_VOLUME = re.compile(r"\b(?:narrow\w*|cut\w*|trim\w*|shrink\w*|fewer|smaller (?:list|lists|batch)|"
                         r"reduce (?:the )?(?:list|volume|sends)|tighten (?:the )?list|send less)\b", re.I)
# A reply rate under the floor sends a GTME to "who you email" first (playbook
# lines 34, 131): the list gets narrowed. That is the cut a volume ruling forbids.
VOLUME_CUTTING_KINDS = frozenset({"floor"})


def crosses(action: dict, ruling: dict) -> bool:
    if not VOLUME_RULING.search(str(ruling.get("rule") or "")):
        return False
    text = f"{action.get('do', '')} {action.get('command', '')}"
    return action.get("kind") in VOLUME_CUTTING_KINDS or bool(CUTS_VOLUME.search(text))


def hold_against_rulings(actions: list[dict], rulings: list[dict]) -> list[dict]:
    """An action that would cross an active ruling is not recommended: it
    says which ruling, and who owns changing it, and drops below real work."""
    for a in actions:
        hit = next((r for r in rulings if crosses(a, r)), None)
        if hit is None:
            continue
        who = hit.get("who") or "whoever made it"
        a["held_by"] = {"rule": hit.get("rule"), "who": who, "date": hit.get("date"), "where": hit.get("where")}
        a["do"] = (f"Not recommended: {a['do']}. It contradicts the ruling \"{hit.get('rule')}\" ({who}, "
                   f"{hit.get('date') or 'undated'}); {who} owns changing it")
        a["gate"] = f"held by a client ruling: ask {who} before doing this"
        a["score"] = min(a.get("score", 0), 15)
    return actions


def remember_why(kind: str, title: str, reasons: list[str]) -> None:
    write_json(home() / "last.json", {"kind": kind, "title": title, "reasons": reasons, "at": stamp()})


# ── gtme list: a first list with no Clay ──────────────────────────────────

LIST_COLUMNS = ["company", "website", "name", "title", "linkedin", "email", "location", "source", "why"]


def rows_from(source: dict, body: dict) -> list[dict]:
    data = body.get("data")
    if isinstance(data, dict):
        data = data.get("data") or data.get("rows") or data.get("issuers") or [data]
    if not isinstance(data, list):
        return []
    out = []
    for r in data:
        if not isinstance(r, dict):
            continue
        site = source.get("site") or source["op"]
        raised = r.get("amount_sold") or r.get("offering_amount") or r.get("amount")
        people = r.get("people")
        first = people[0] if isinstance(people, list) and people else {}
        if isinstance(first, dict):
            r = {**r, "contact": r.get("contact") or first.get("name") or "",
                 "contact_title": first.get("title") or first.get("relationship") or ""}
        elif isinstance(first, str):
            r = {**r, "contact": first}
        if isinstance(raised, (int, float)) and not r.get("one_liner"):
            r = {**r, "industry": f"raised ${raised:,.0f}" + (f", {r['industry']}" if r.get("industry") else "")}
        out.append({
            "company": r.get("name") or r.get("issuer") or r.get("entity_name") or r.get("company") or "",
            "website": r.get("website") or r.get("domain") or "",
            "name": r.get("contact") or r.get("related_person") or "",
            "title": r.get("contact_title") or "",
            "linkedin": r.get("company_linkedin") or "",
            "email": "",
            "location": r.get("address") or r.get("location") or
                        ", ".join(x for x in (r.get("city"), r.get("state")) if x) or "",
            "source": f"{site} {source['op']}",
            "why": r.get("one_liner") or r.get("category") or r.get("industry") or "",
        })
    return [r for r in out if r["company"]]


def fetch_source(source: dict) -> dict:
    if source["tool"] == "gtme-signals":
        argv = [sys.executable, str(ROOT / "bin" / "gtme-signals"), "formd", "--json",
                "--limit", source["args"].get("limit", "50")]
        fx = os.environ.get("GTME_FIXTURES")
        if fx:
            return read_json(Path(fx) / "signals-formd.json", {"ok": False})
        try:
            p = subprocess.run(argv, capture_output=True, text=True, timeout=120)
            body = json.loads(p.stdout or "null")
        except (OSError, subprocess.SubprocessError, ValueError) as err:
            return {"ok": False, "reason": str(err)[:200]}
        rows = body if isinstance(body, list) else (body or {}).get("rows")
        return {"ok": isinstance(rows, list), "data": rows or [],
                "reason": "" if isinstance(rows, list) else (p.stderr or "")[:160]}
    return api(source["site"], source["op"], **source["args"])


def build_list(t: Teacher, plan: dict) -> dict:
    d = client_dir(plan["client"])
    raw = d / "list-raw.csv"
    rows, notes = [], []
    for s in plan["sources"]:
        body = fetch_source(s)
        got = rows_from(s, body) if body.get("ok", True) else []
        notes.append(f"{s.get('site') or s['tool']} {s['op']}: {len(got)} rows"
                     + ("" if got else f" ({body.get('reason') or 'nothing came back'})"))
        rows += got
    # gtme-dedupe matches people; a company row with no person is its own
    # cluster there (two identical "Crumb Corner" rows stayed two in the
    # stranger test). So companies collapse here first, on website domain,
    # else on the name, and gtme-dedupe then merges the people.
    companies: dict[str, dict] = {}
    for r in rows:
        key = company_key(r)
        if key in companies and not r.get("name"):
            continue
        companies.setdefault(key if not r.get("name") else f"{key}|{len(companies)}", r)
    merged_companies = len(rows) - len(companies)
    d.mkdir(mode=0o700, parents=True, exist_ok=True)
    with raw.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=LIST_COLUMNS)
        w.writeheader()
        for r in companies.values():
            w.writerow({k: csv_cell(str(r.get(k) or "")) for k in LIST_COLUMNS})
    t.say(f"Pulled {len(rows)} rows from {len(plan['sources'])} free sources:")
    for n in notes:
        t.say(f"  {n}")
    summary = dedupe(raw, d / "deduped")
    kept = summary.get("clusters") or summary.get("golden_rows") or summary.get("people")
    if summary.get("ok"):
        t.say(f"Deduped: {merged_companies} repeat companies merged by website, then gtme-dedupe checked "
              f"the people; {kept} unique entries left ({d / 'deduped' / 'golden.csv'}).")
    else:
        t.say(f"Dedupe could not run ({summary.get('reason')}); the raw list is at {raw}.")
    t.say("Next, the list needs work emails. That lookup is called enrichment; it costs credits, so it "
          "waits for Clay and your approval.")
    result = {"rows": len(rows), "unique": kept, "raw": str(raw), "notes": notes, "at": stamp()}
    write_json(d / "list.json", result)
    return result


def company_key(r: dict) -> str:
    site = re.sub(r"^(https?://)?(www\.)?", "", (r.get("website") or "").lower()).split("/")[0].strip()
    return site or "name:" + re.sub(r"[^a-z0-9]", "", (r.get("company") or "").lower())


def csv_cell(value: str) -> str:
    """Defuse a cell a spreadsheet would run as a formula; public listings are
    written by strangers (OWASP CSV injection)."""
    return "'" + value if value.startswith(("=", "+", "-", "@", "\t", "\r")) else value


def dedupe(src: Path, out: Path) -> dict:
    try:
        p = subprocess.run(["bash", str(ROOT / "bin" / "gtme-dedupe"), str(src), "--no-splink", "--json",
                            "--out", str(out)], capture_output=True, text=True, timeout=180)
        body = json.loads(p.stdout or "{}")
    except (OSError, subprocess.SubprocessError, ValueError) as err:
        return {"ok": False, "reason": str(err)[:160]}
    if p.returncode != 0 or not isinstance(body, dict):
        return {"ok": False, "reason": (p.stderr or "").strip()[:160] or f"exit {p.returncode}"}
    body["ok"] = True
    if not any(body.get(k) for k in ("clusters", "golden_rows", "people")):
        golden = out / "golden.csv"
        if golden.exists():
            with golden.open() as f:
                body["clusters"] = max(0, sum(1 for _ in f) - 1)
    return body


def cmd_list(a, t: Teacher) -> int:
    plan = read_json(client_dir(a.client) / "plan.json", None)
    if not plan:
        t.say(f"There's no plan for {a.client} yet. Run `chewbacca gtme start --client \"{a.client}\"` first.")
        return 1
    build_list(t, plan)
    return 0


# ── the graph, read only ──────────────────────────────────────────────────


def credit_snapshots() -> list[dict]:
    path = home() / "credits.jsonl"
    out = []
    try:
        for line in path.read_text().splitlines():
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
    except OSError:
        pass
    return out


def credit_view(ws_ids: list[str]) -> dict | None:
    """Balance, burn per day and days left for these workspaces, from the
    newest snapshot of each. Burn comes from Clay's own last-7-days usage when
    the snapshot has it, else from the fall in balance between snapshots
    (top-ups are skipped, since a rise is not negative spend)."""
    snaps = [s for s in credit_snapshots() if str(s.get("ws")) in ws_ids and s.get("balance") is not None]
    if not snaps:
        return None
    balance, burn, as_of, how = 0.0, 0.0, "", []
    for ws in ws_ids:
        mine = sorted((s for s in snaps if str(s["ws"]) == ws), key=lambda s: s["at"])
        if not mine:
            continue
        last = mine[-1]
        balance += float(last["balance"])
        as_of = max(as_of, last["at"])
        if last.get("used_7d") is not None:
            burn += float(last["used_7d"]) / 7.0
            how.append("clay credit usage, last 7 days")
        else:
            spent, days = burn_from_balances(mine)
            if days:
                burn += spent / days
                how.append(f"balance drop over {days:.1f} days of snapshots")
    days_left = balance / burn if burn > 0 else None
    return {"balance": round(balance, 1), "burn_per_day": round(burn, 1), "days_left": days_left,
            "as_of": as_of, "source": "; ".join(sorted(set(how))) or "one snapshot, no burn yet"}


def burn_from_balances(snaps: list[dict]) -> tuple[float, float]:
    spent = 0.0
    for prev, cur in zip(snaps, snaps[1:]):
        drop = float(prev["balance"]) - float(cur["balance"])
        if drop > 0:
            spent += drop
    t0, t1 = parse_time(snaps[0]["at"]), parse_time(snaps[-1]["at"])
    days = (t1 - t0).total_seconds() / 86400 if t0 and t1 else 0
    return spent, days


def strip_html(text: str) -> str:
    """Reply text as the person typed it, on one line, through gtme_reply's
    cleaner (tags, entities, the quoted thread). A clipped snippet can end
    inside a tag, so an unclosed one is cut first; anything still tag-shaped
    after cleaning goes too."""
    import gtme_reply  # tools/gtme_reply.py, beside this file
    text = re.sub(r"<[^<>]{0,2000}$", " ", str(text or "")[:gtme_reply.MAX_CLEAN_INPUT])
    text = re.sub(r"<[^<>]{0,2000}>", " ", gtme_reply.clean_reply_text(text))
    return safe(" ".join(html.unescape(text).split()))


# Mailer-daemon notices arrive in the reply inbox looking like replies. These
# phrases are the ones Gmail and Outlook put in the first lines of one.
BOUNCE_NOTICE = re.compile(r"delivery status notification|error icon|undeliverable|address not found|"
                           r"mailer-daemon|message not delivered|delivery has failed|message blocked|"
                           r"has been blocked", re.IGNORECASE)
# A reply whose first words ask to be taken off the list. Clay left one
# unclassified on 2026-10-09 ("Remove <name>"); it is an unsubscribe, and
# answering it with a pitch is the worst possible reply.
UNSUBSCRIBE_ASK = re.compile(r"^\W*(please\s+)?(remove|unsubscribe|take me off|stop emailing|do not contact|"
                             r"opt\s*out)\b", re.IGNORECASE)


def is_unsubscribe_ask(r: dict) -> bool:
    return bool(UNSUBSCRIBE_ASK.search(strip_html(r.get("snippet") or "")))


def is_bounce_notice(r: dict) -> bool:
    return bool(BOUNCE_NOTICE.search(r.get("snippet") or ""))


def graph():
    try:
        import gtm_query as q
    except ImportError:
        return None, None
    try:
        return q, q.connect()
    except q.NoGraph:
        return q, None


def campaign_view(c: dict) -> dict:
    a = c.get("analytics") or {}
    steps = c.get("steps") or []
    leads = a.get("leads") or 0
    # Emails still queued: every lead not yet reached by every step. Counting
    # only step 1 called every live campaign dry the day it launched, since
    # Clay sends all of step 1 at once (first live run, 2026-10-09).
    counts = [(s or {}).get("sentCount") for s in steps]
    left = sum(max(0, leads - (n or 0)) for n in counts) if counts else None
    return {"id": c.get("campaign_id") or c.get("id"), "audience": c.get("audience"),
            "name": c.get("name"), "status": c.get("status"),
            "leads": leads, "sent": a.get("sent") or 0, "replies": a.get("repliesExcludingOoo") or 0,
            "bounces": a.get("bounces") or 0, "leads_left": left, "as_of": c.get("analytics_as_of")}


# ── the per-company scorecard and the real asks ───────────────────────────

# Ported from a client repo's scripts/scorecard.py (2026-10-09): a week-1
# summary said 59 replies and nothing could say how many were people or yeses.
# Bounces come from Clay's stats totals, not the funnel's per-step
# bouncedCount: for one client's week 1 the funnel said 11 and the totals 18.
SCORE_COLS = ("first_emails", "follow_ups", "replies", "human_replies", "tagged_positive", "bounces")


def company_of(campaign: dict) -> str:
    """The company (offer) a campaign sells: its recorded offer, else the
    second "|" part of a "Client | Company | List | Wave" name."""
    if campaign.get("offer"):
        return str(campaign["offer"])
    parts = [p.strip() for p in str(campaign.get("name") or "").split("|")]
    return parts[1] if len(parts) > 1 and parts[1] else (parts[0] or "unnamed")


def score_row(c: dict) -> dict:
    a = c.get("analytics") or {}
    steps = [s for s in c.get("steps") or [] if isinstance(s, dict)]
    first = next((int(s.get("sentCount") or 0) for s in steps if int(s.get("step") or 0) == 1), None)
    total = sum(int(s.get("sentCount") or 0) for s in steps)
    if first is None:  # no step data: every send counts as a first email, none as a follow up
        first, total = int(a.get("sent") or 0), int(a.get("sent") or 0)
    return {"first_emails": first, "follow_ups": total - first, "replies": int(a.get("replies") or 0),
            "human_replies": int(a.get("repliesExcludingOoo") or 0),
            "tagged_positive": sum(int(x.get("leads") or 0) for x in c.get("reply_categories") or []
                                   if isinstance(x, dict) and str(x.get("sentiment") or "").lower() == "positive"),
            "bounces": int(a.get("bounces") or 0)}


def scorecard(campaigns: list[dict]) -> dict[str, dict]:
    """Company -> the six columns, summed over its running campaigns."""
    out: dict[str, dict] = {}
    for c in campaigns:
        if c.get("status") != "active":
            continue
        row = score_row(c)
        slot = out.setdefault(company_of(c), dict.fromkeys(SCORE_COLS, 0))
        for k in SCORE_COLS:
            slot[k] += row[k]
    return dict(sorted(out.items()))


# Where a reply's own words stop and the quoted thread starts, in a snippet
# already flattened to one line. Bounded, so a stranger's body can't stall it.
QUOTED = re.compile(r"\bOn [^\n]{0,200}?wrote:|-{2,40} ?Original Message|\bFrom: |&gt;|>", re.I)
# A deck, a call or a meeting asked for in so many words. A bare "call" is
# left out: out-of-office notes say "if urgent, call my cell".
ASK = re.compile(r"\b(?:(?:pitch )?deck|(?:a|quick|short|intro|brief) (?:call|chat|zoom)|hop on a call|"
                 r"(?:schedule|set up|book|find) (?:a |some )?(?:call|meeting|time)|meeting|meet (?:with|up)|"
                 r"calendly|grab time)\b", re.I)
NOT_AN_ASK = frozenset({"negative", "unsubscribe", "bounce", "ooo"})


def own_words(snippet: str) -> str:
    text = strip_html(snippet)
    m = QUOTED.search(text)
    return text[:m.start()] if m else text


def real_asks(replies: list[dict], names: dict[str, str]) -> list[dict]:
    """Everyone whose own reply text asks for a deck, a call or a meeting,
    newest first, one line each: a real ask, read from words, not a tag."""
    out, seen = [], set()
    for r in sorted(replies, key=lambda r: r.get("time") or "", reverse=True):
        email = r.get("email") or ""
        if not email or email in seen or r.get("class") in NOT_AN_ASK:
            continue
        words = own_words(r.get("snippet") or "")
        m = ASK.search(words)
        if m:
            seen.add(email)
            out.append({"email": email, "name": names.get(email) or "", "campaign": r.get("campaign"),
                        "asked": m.group(0).lower(), "quote": words[:160], "time": r.get("time")})
    return out


def lead_names(db, cams: list[str]) -> dict[str, str]:
    if not cams:
        return {}
    import gtme_reply  # its name fixer drops the trailing "e" a lead feeder adds
    marks = ",".join("?" * len(cams))
    rows = [(r[0], r[1]) for r in db.execute(
        "SELECT json_extract(props, '$.email'), json_extract(props, '$.name') FROM edges "
        f"WHERE verb = 'ENROLLED' AND src IN ({marks})", cams) if r[0] and r[1]]
    feeder = gtme_reply.feeder_appends_e([n for _, n in rows])
    return {e: gtme_reply.clean_lead_name(n, e, feeder) for e, n in rows}


def history_alarm(client: str, sent: int, replies: int, as_of: str | None) -> dict | None:
    """Record this sync's totals once per as_of, then compare with the oldest
    record at least DROP_MIN_NEW_SENDS sends back: a recent reply rate under
    half the earlier one is a sudden drop."""
    path = home() / "history.jsonl"
    rows = []
    try:
        rows = [json.loads(x) for x in path.read_text().splitlines() if x.strip()]
    except (OSError, ValueError):
        rows = []
    mine = [r for r in rows if r.get("client") == client]
    if as_of and not any(r.get("as_of") == as_of for r in mine):
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with path.open("a") as f:
            f.write(json.dumps({"client": client, "as_of": as_of, "sent": sent, "replies": replies}) + "\n")
        mine.append({"client": client, "as_of": as_of, "sent": sent, "replies": replies})
    # Replies trail sends by days, so a window that ends today always looks
    # dry: the first live run called 4.4% -> 0.6% over 537 sends made that
    # morning. The window is two snapshots that are both REPLY_LAG_DAYS old.
    cutoff = utc_now() - timedelta(days=REPLY_LAG_DAYS)
    settled = sorted((r for r in mine if (parse_time(r["as_of"]) or utc_now()) <= cutoff),
                     key=lambda r: r["as_of"])
    if not settled:
        return None
    end = settled[-1]
    start = [r for r in settled if end["sent"] - r["sent"] >= DROP_MIN_NEW_SENDS and r["sent"] > 0]
    if not start:
        return None
    a = start[-1]
    before = a["replies"] / a["sent"]
    recent = (end["replies"] - a["replies"]) / (end["sent"] - a["sent"])
    if before > 0 and recent < before / 2:
        return {"before": before, "recent": recent, "since": a["as_of"], "until": end["as_of"],
                "new_sends": end["sent"] - a["sent"]}
    return None


def gtm_memory(client: str, *args: str) -> dict | None:
    """One `chewbacca gtm-memory` answer as JSON, or None when the store or
    the tool is missing. It owns commitments (refills, verdicts owed) and
    credits by table, so gtme reads them instead of recomputing them."""
    fx = os.environ.get("GTME_FIXTURES")
    if fx:
        body = read_json(Path(fx) / f"memory-{'-'.join(a.lstrip('-') for a in args)}.json", None)
        return body if isinstance(body, dict) else None
    tool = ROOT / "bin" / "gtm-memory"
    if not tool.exists():
        return None
    try:
        p = subprocess.run([sys.executable, str(tool), "--client", client, *args, "--json"],
                           capture_output=True, text=True, timeout=30)
        body = json.loads(p.stdout or "null")
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    return body if isinstance(body, dict) and p.returncode == 0 else None


def client_state(q, db, c: dict) -> dict:
    """Everything the brief, next and report need about one client."""
    detail = q.client(db, c["name"])
    cams = q.campaigns_of(db, c["id"])
    views = [campaign_view(x) for x in cams]
    f = detail["funnel"] or {}
    clay = f.get("clay") or {}
    sent, replies, bounces = clay.get("sent", 0), clay.get("repliesExcludingOoo", 0), clay.get("bounces", 0)
    try:
        # Every unanswered thread, closed classes included: an unsubscribe the
        # sync classified still owes a blocklist entry, so it is sorted here
        # rather than dropped by the query.
        waiting = [r for r in q.replies(db, c["name"], unanswered=True, include_all=True)["replies"]
                   if not r.get("forwarded")]
    except LookupError:
        waiting = []
    try:
        every = q.replies(db, c["name"])["replies"]
    except LookupError:
        every = []

    def bounce(r):
        return r.get("class") == "bounce" or is_bounce_notice(r)

    def removal(r):
        return not bounce(r) and (r.get("class") == "unsubscribe" or is_unsubscribe_ask(r))

    bounced = [r for r in waiting if bounce(r)]
    unsubscribes = [r for r in waiting if removal(r)]
    unanswered = sorted((r for r in waiting if not bounce(r) and not removal(r)
                         and r.get("class") not in q.SKIP_WHEN_UNANSWERED),
                        key=lambda r: (r.get("class") != "positive",
                                       -(parse_time(r.get("time")) or utc_now()).timestamp()))
    ws = detail["workspaces"]
    sync = detail["sync"]
    return {
        "name": c["name"], "id": c["id"], "workspaces": ws, "funnel": f, "campaigns": views,
        "sent": sent, "replies": replies, "bounces": bounces, "as_of": clay.get("as_of"),
        "positive": (f.get("people_positive") or {}).get("n", 0),
        "meetings": (f.get("meetings") or {}).get("n", 0),
        "unanswered": unanswered, "bounce_notices": len(bounced),
        "unsubscribe_asks": [r.get("email") for r in unsubscribes if r.get("email")], "credits": credit_view(ws), "sync": sync,
        "drop": history_alarm(c["name"], sent, replies, clay.get("as_of")),
        "rulings": rulings_for(c["name"]),
        "scorecard": scorecard(cams),
        "asks": real_asks(every, lead_names(db, [x["id"] for x in cams])),
        "memory": {"overdue": gtm_memory(c["name"], "overdue"),
                   "by_table": gtm_memory(c["name"], "credits", "--by", "table")},
    }


# ── the to-do list: one ranking for brief and next ────────────────────────


def refill_command(client: str, campaign: str | None, audience: str | None) -> str:
    """The whole refill chain for one campaign: who must never be emailed,
    find new people, grade the add, then add-leads with campaign= (required:
    chewbacca clay refuses add-leads without it, and checks the grade in
    code). Unknown ids stay visible placeholders, never a guess."""
    cam = campaign if campaign and CLAY_ARG_ID.match(campaign) else "<campaign id>"
    aud = audience if audience and CLAY_ARG_ID.match(audience) else "<its base segment>"
    return (f"chewbacca gtm suppress --client {shlex.quote(client)} --csv  then  chewbacca clay route find-people"
            f"  then  gtme-grade --campaign {cam} --action add-leads --leads <new leads csv>"
            f"  then  chewbacca clay add-leads audience={aud} filter='<segment filter with the new leads>' "
            f"campaign={cam} --allow-writes")


def memory_actions(name: str, overdue: dict, audiences: dict | None = None) -> list[dict]:
    """gtm-memory's late commitments, grouped by kind so 30 refills read as
    one job with a count instead of 30 lines."""
    late = [x for x in overdue.get("late") or [] if isinstance(x, dict)]
    fresh = (overdue.get("freshness") or {}).get("last_ingest") or "unknown"
    groups: dict[tuple, list] = {}
    for x in late:
        groups.setdefault((x.get("kind"), x.get("owed_by")), []).append(x)
    out = []
    for (kind, owed_by), items in groups.items():
        items.sort(key=lambda x: -(x.get("late_by_hours") or 0))
        oldest = items[0]
        days = (oldest.get("late_by_hours") or 0) / 24
        if kind == "refill":
            do = (f"Refill {len(items)} campaigns with nothing left to send: every lead has had every step "
                  f"(oldest: \"{oldest.get('campaign')}\", {days:.0f} days late)")
            gate, score, lesson = "read, then needs your approval to add leads", 40, "dry"
            cam = str(oldest.get("source_id") or "").removeprefix("campaign:clay:") or None
            cmd = refill_command(name, cam, (audiences or {}).get(cam))
        elif kind == "approval_owed":
            who = "the client" if owed_by == "client" else "you"
            do = (f"Get {len(items)} reply verdicts from {who} (oldest: {oldest.get('title')}, {days:.0f} days late)")
            gate, score, lesson = f"{who}: a yes/no per reply, nothing sends", 45, None
            cmd = f"chewbacca gtm-memory --client \"{name}\" overdue"
        else:
            do = f"{len(items)} overdue: {oldest.get('title')} ({days:.0f} days late)"
            gate, score, lesson = f"owed by {owed_by or 'us'}", 35, None
            cmd = f"chewbacca gtm-memory --client \"{name}\" overdue"
        item = {"score": score, "client": name, "kind": "owed" if kind != "refill" else "dry", "do": do,
                "command": cmd, "gate": gate,
                "why": f"gtm-memory overdue, ingested {fresh}; due dates are derived from the campaign and reply "
                       "records there."}
        if lesson:
            item["lesson"] = lesson
        out.append(item)
    return out


# What a reply command may carry as ws= and campaign_id=: chewbacca clay's own
# ID shape, so the printed command is one it accepts.
CLAY_ARG_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
REPLY_BODY_PLACEHOLDER = "<p>WRITE YOUR ANSWER HERE</p>"


def reply_command(r: dict, ws_fallback: str) -> str:
    """`chewbacca gtm lead`, then the whole `chewbacca clay reply` with the
    thread's real ids, the body left for the person to write. It is a write
    that sends email, so chewbacca clay still asks a person at a terminal.
    Ids the sync never stored name the sync to run instead of a guess."""
    ws = str(r.get("workspace_id") or ws_fallback or "")
    cid = str(r.get("campaign_id") or "")
    lead = f"chewbacca gtm lead {shlex.quote(str(r.get('email') or ''))}"
    if not (CLAY_ARG_ID.match(ws) and CLAY_ARG_ID.match(cid) and r.get("stats_id") and r.get("message_id")):
        return f"{lead}  then  chewbacca gtm sync --source inbox (this reply has no Clay ids stored yet)"
    data = {"email_stats_id": r["stats_id"], "reply_message_id": r["message_id"],
            "reply_email_time": r.get("time") or "", "email_body": REPLY_BODY_PLACEHOLDER}
    return (f"{lead}  then  chewbacca clay reply ws={ws} campaign_id={cid} "
            f"reply_data={shlex.quote(json.dumps(data, separators=(',', ':')))} --allow-writes")


def actions_for(s: dict) -> list[dict]:
    """Every action for one client, with a score, the command, the gate and
    the reason (rule + numbers). Higher score first. The scores order kinds
    of work the way a GTME triages a morning: a waiting positive reply loses
    half its booking chance in a day (playbook line 132), so it outranks a
    burning domain, which outranks running out of credits."""
    out = []
    name, ws = s["name"], (s["workspaces"] or [""])[0]
    memory_overdue = (s.get("memory") or {}).get("overdue")
    for r in s["unanswered"]:
        cls = r.get("class")
        hours = (utc_now() - parse_time(r["time"])).total_seconds() / 3600 if parse_time(r.get("time")) else 0
        base = 100 if cls == "positive" else 60
        out.append({
            "score": base + min(hours, 48) / 4, "client": name, "kind": "reply",
            "do": f"Answer {r.get('email')} ({cls or 'unclassified'} reply, {age(r.get('time'))}): "
                  f"{REPLY_NEXT.get(cls, REPLY_NEXT[None])}",
            "quote": strip_html(r.get("snippet") or "")[:160],
            "command": reply_command(r, ws),
            "gate": "read, then needs your approval to send",
            "why": f"Clay inbox, synced {age(s['as_of'])}. " + (
                f"Rule: answer positive replies within {POSITIVE_ANSWER_MINUTES} minutes; a day's wait loses "
                "about half the booking chance." if cls == "positive" else
                "Rule: questions and referrals count toward the positive rate once answered; answer the "
                "same day, after the positive ones."),
        })
    for c in s["campaigns"]:
        if c["status"] != "active" or not c["sent"]:
            continue
        br = c["bounces"] / c["sent"]
        if br > BOUNCE_TRIAGE and c["sent"] >= 50:
            pause = br > BOUNCE_PAUSE
            out.append({
                "score": 90 if pause else 70, "client": name, "kind": "bounce",
                "do": f"{'Pause' if pause else 'Check'} \"{c['name']}\": bounce rate {pct(c['bounces'], c['sent'])} "
                      f"({c['bounces']} of {c['sent']} sent)",
                "command": f"clay-go campaign --campaign {c['id']}" if pause
                           else f"chewbacca clay campaign-analytics campaign={c['id']}",
                "gate": "UI, needs your approval" if pause else "read only",
                "why": f"Clay analytics as of {c['as_of']}. Rule: above {BOUNCE_TRIAGE:.0%} triage, above "
                       f"{BOUNCE_PAUSE:.0%} pause and re-verify the list.",
                "lesson": "bounce",
            })
        if c["sent"] >= JUDGE_AFTER_SENDS and c["replies"] / c["sent"] < REPLY_FLOOR:
            out.append({
                "score": 50, "client": name, "kind": "floor",
                "do": f"Rework \"{c['name']}\": reply rate {pct(c['replies'], c['sent'])} after {c['sent']} sends, "
                      f"under the {REPLY_FLOOR:.0%} floor",
                "command": f"chewbacca clay campaign-variants ws={ws} campaign={c['id']}",
                "gate": "read only; a copy change needs your approval",
                "why": f"Clay analytics as of {c['as_of']}. Rule: floor 1%, target 2-4%; test the list, then the "
                       "offer, then the subject (playbook lines 34, 131).",
                "lesson": "floor",
            })
        if memory_overdue is None and c["leads_left"] is not None and c["leads_left"] < RUN_DRY_LEADS:
            out.append({
                "score": 40, "client": name, "kind": "dry",
                "do": f"Refill \"{c['name']}\": {c['leads_left']} emails left in its queue ({c['leads']} leads)",
                "command": refill_command(name, c["id"], c.get("audience")),
                "gate": "read, then needs your approval to add leads",
                "why": f"Clay analytics per-step sends vs leads, as of {c['as_of']}. Under {RUN_DRY_LEADS} "
                       "queued emails runs out in about two sending days.",
                "lesson": "dry",
            })
    for email in s.get("unsubscribe_asks") or []:
        out.append({
            "score": 75, "client": name, "kind": "unsubscribe",
            "do": f"Blocklist {email}: their reply asks to be removed",
            "command": f"chewbacca clay blocklist-add ws={ws} emailOrDomain={email} --allow-writes",
            "gate": "needs your approval (changes the suppression list)",
            "why": "Clay inbox reply text. Answering a removal ask with anything but the removal costs "
                   "deliverability; the playbook treats unsubscribes above 2% as a reason to pause.",
        })
    if memory_overdue is not None:
        out += memory_actions(name, memory_overdue, {c["id"]: c.get("audience") for c in s["campaigns"]})
    if s["drop"]:
        d = s["drop"]
        out.append({
            "score": 65, "client": name, "kind": "drop",
            "do": f"Reply rate fell from {d['before']:.1%} to {d['recent']:.1%} over the last {d['new_sends']} sends",
            "command": f"chewbacca gtm client \"{name}\"",
            "gate": "read only",
            "why": f"gtme history since {d['since']}. A sudden drop usually means emails started landing in spam.",
            "lesson": "drop",
        })
    cr = s["credits"]
    if cr and cr["days_left"] is not None and cr["days_left"] < CREDIT_DAYS_ALARM:
        out.append({
            "score": 80, "client": name, "kind": "credits",
            "do": f"Top up credits: {cr['balance']:.0f} left at {cr['burn_per_day']:.0f} a day, "
                  f"about {cr['days_left']:.1f} days",
            "command": f"chewbacca clay credit-usage ws={ws} days=7", "gate": "read; buying credits is your hands only",
            "why": f"{cr['source']}, as of {cr['as_of']}.", "lesson": "credits",
        })
    for row in s["sync"]:
        if row.get("ok") is None or (row.get("ran_at") and (utc_now() - parse_time(row["ran_at"])).total_seconds()
                                     > STALE_SYNC_HOURS * 3600):
            out.append({
                "score": 30, "client": name, "kind": "sync",
                "do": f"Refresh {row['source']}: " + ("never synced" if row.get("ok") is None
                                                      else f"last read {age(row['ran_at'])}"),
                "command": "chewbacca gtme sync", "gate": "read only",
                "why": f"gtm_sync table. A brief from data older than {STALE_SYNC_HOURS}h misses today's replies.",
            })
        elif row.get("ok") is False:
            fix = ("open Privacy & Security > Calendars and switch on your terminal app"
                   if "calendar" in (row.get("note") or "").lower() else (row.get("note") or "")[:120])
            out.append({
                "score": 25, "client": name, "kind": "sync",
                "do": f"{row['source']} failed: {fix}",
                "command": CALENDAR_PANE if "calendar" in (row.get("note") or "").lower() else "chewbacca gtme sync",
                "gate": "your hands only (a permission switch)" if "calendar" in (row.get("note") or "").lower()
                        else "read only",
                "why": f"gtm_sync table, {row.get('ran_at')}. Without it meetings read as missing, not zero.",
            })
    report = next((r for r in s.get("rulings") or [] if WEEKLY_REPORT.search(str(r.get("rule") or ""))), None)
    if report and local_weekday() == 4:
        out.append({
            "score": 85, "client": name, "kind": "report",
            "do": f"Send this week's numbers, per {report.get('who') or 'the client'}'s standing ruling",
            "command": f'chewbacca gtme report --client "{name}" --week',
            "gate": "read; it writes the summary to Downloads, and sending it is yours",
            "why": f"Ruling {report.get('date', '')}: {report.get('rule')}",
        })
    return sorted(hold_against_rulings(out, s.get("rulings") or []), key=lambda x: -x["score"])


# A ruling that asks for numbers on Fridays. The first client's "weekly
# numbers summary every Friday" sat in its DECISIONS.json with nothing that
# ever ran it (gtme-rules audit, 2026-10-11); now Friday's brief leads with it.
WEEKLY_REPORT = re.compile(r"\b(every|each) friday\b", re.I)


def local_weekday() -> int:
    """Today's weekday on this Mac (Monday 0), or GTME_TODAY=YYYY-MM-DD's in tests."""
    pinned = os.environ.get("GTME_TODAY")
    if pinned:
        return datetime.strptime(pinned, "%Y-%m-%d").weekday()
    return datetime.now().weekday()


# ── lessons tied to the person's own numbers ──────────────────────────────

LESSONS = {
    "bounce": "Bounces are addresses that don't exist. Inbox providers watch your bounce rate, and past "
              "about 3% they start sending your other emails to spam too. The fix is upstream: only email "
              "addresses a verifier marked valid, and pause the campaign while you clean the list.",
    "floor": "A reply rate under 1% after 200 sends means the message isn't landing. Change one thing at a "
             "time, in this order: who you email, what you offer, the subject, the first line. The list "
             "matters most, so check it first.",
    "dry": "Campaigns stop when they run out of people. Refill before they do, and check the new names "
           "against everyone already emailed so nobody gets the same email twice.",
    "drop": "When replies fall suddenly but nothing about the message changed, it's usually deliverability: "
            "emails started landing in spam. Slow down, check bounces, and test where your emails land.",
    "credits": "Every lookup in Clay costs credits. Before running a step on a whole list, run it on one "
               "row and read the cost; one expensive AI column can burn thousands of credits in an hour.",
    "small-sample": "Under about 200 sends a campaign hasn't told you anything yet: one reply moves the rate "
                    "by half a point. Let it reach 200 before you judge it, and 500 per version before you "
                    "compare two.",
    "speed": "The fastest way to lose a meeting is to answer a good reply tomorrow. Interested people go cold "
             "within a day, so positive replies come first every morning.",
}


# Each lesson's "go deeper" entries in library/learning/clay-navigation/
# WALKTHROUGHS.md, sourced Clay procedures. Titles are read from the file at
# run time so a renamed entry never prints a stale title.
LESSON_WALKTHROUGHS = {
    "bounce": ["W-173", "W-122", "W-131"],
    "floor": ["W-076", "W-074"],
    "dry": ["W-111", "W-202"],
    "drop": ["W-080", "W-173"],
    "credits": ["W-102", "W-103", "W-001"],
    "small-sample": ["W-174"],
    "speed": ["W-077"],
}
WALKTHROUGHS = ROOT / "library" / "learning" / "clay-navigation" / "WALKTHROUGHS.md"


def walkthrough_titles(ids: list[str]) -> list[str]:
    try:
        text = WALKTHROUGHS.read_text()
    except OSError:
        return []
    out = []
    for wid in ids:
        m = re.search(rf"^### ({re.escape(wid)} .+)$", text, re.MULTILINE)
        if m:
            out.append(m.group(1).strip())
    return out


def pick_lesson(t: Teacher, actions: list[dict], states: list[dict]) -> tuple[str, str]:
    """The lesson for the most urgent thing in this person's own data; one
    not yet taught wins over one already seen."""
    keys = []
    for a in actions:
        if a["kind"] == "reply" and "positive" in a["do"]:
            keys.append(("speed", a["do"].split(":")[0]))
        if a.get("lesson"):
            keys.append((a["lesson"], a["do"]))
    for s in states:
        for c in s["campaigns"]:
            if c["status"] == "active" and 0 < c["sent"] < JUDGE_AFTER_SENDS:
                keys.append(("small-sample", f"\"{c['name']}\" has {c['sent']} sends"))
    if not keys:
        return "", ""
    fresh = [k for k in keys if not t.lesson_seen(k[0])]
    key, context = (fresh or keys)[0]
    return key, context


# ── commands over the graph ───────────────────────────────────────────────


def load_states(client: str | None = None) -> tuple[list[dict], str]:
    q, db = graph()
    if db is None:
        return [], "no GTM data yet"
    try:
        rows = q.client_rows(db)
        if client:
            want = q.find_client(db, client)
            rows = [r for r in rows if r["id"] == want["id"]]
        return [client_state(q, db, c) for c in rows], ""
    finally:
        db.close()


def no_data(t: Teacher) -> int:
    t.say("There's no outbound data on this machine yet.")
    plans = sorted(p.parent.name for p in (home() / "clients").glob("*/plan.json"))
    if plans:
        t.say(f"Plans saved: {', '.join(plans)}. When Clay is connected, `chewbacca gtme setup` pulls in "
              "your campaigns and this brief fills in.")
    else:
        t.say("Start with `chewbacca gtme start`: seven plain questions about your business, then a plan.")
    return 0


def background_sync(t: Teacher) -> None:
    log = home() / "gtme-sync.log"
    home().mkdir(mode=0o700, parents=True, exist_ok=True)
    with open(log, "a") as f:
        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "sync"], stdout=f, stderr=subprocess.STDOUT,
                         start_new_session=True)
    t.say(f"Refreshing in the background; this brief is from the last sync. Log: {log}")


def cmd_brief(a, t: Teacher) -> int:
    if a.sync:
        background_sync(t)
    states, _ = load_states(a.client)
    if not states:
        return no_data(t)
    actions = [x for s in states for x in actions_for(s)]
    actions.sort(key=lambda x: -x["score"])
    if a.json:
        print(json.dumps({"clients": states, "actions": actions}, default=str, indent=1))
        return 0
    t.say(f"GTM brief, {utc_now():%a %b %d %H:%M} UTC. Every number says where it came from and when.")
    for s in states:
        t.say("")
        t.say(f"{s['name']}  (Clay analytics as of {s['as_of'] or 'never'}, {age(s['as_of'])})")
        active = [c for c in s["campaigns"] if c["status"] == "active"]
        t.say(f"  Funnel: {s['sent']} emails sent across {len(s['campaigns'])} campaigns ({len(active)} running), "
              f"{s['replies']} replies not counting out-of-office = reply rate {pct(s['replies'], s['sent'])} "
              f"(floor {REPLY_FLOOR:.0%} once past {JUDGE_AFTER_SENDS} sends)")
        emailed = (s["funnel"].get("people_emailed") or {}).get("n", 0)
        t.say(f"  Positive: {s['positive']} people (positive reply rate {pct(s['positive'], emailed)} of {emailed} "
              f"emailed, Clay inbox); meetings {s['meetings']} (calendar)")
        t.say(f"  Bounces: {s['bounces']} of {s['sent']} = bounce rate {pct(s['bounces'], s['sent'])} "
              f"(alarm above {BOUNCE_TRIAGE:.0%}, pause above {BOUNCE_PAUSE:.0%})")
        cr = s["credits"]
        if cr:
            left = f"about {cr['days_left']:.0f} days left" if cr["days_left"] is not None else "no spend measured"
            t.say(f"  Credits: {cr['balance']:.0f} left, burning {cr['burn_per_day']:.0f} a day, {left} "
                  f"({cr['source']}, as of {cr['as_of']})")
        else:
            t.say("  Credits: not read yet (`chewbacca gtme sync` records them)")
        by_table = (s.get("memory") or {}).get("by_table") or {}
        top = sorted((r for r in by_table.get("rows") or [] if isinstance(r, dict) and r.get("credits")),
                     key=lambda r: -r["credits"])[:1]
        if top:
            t.say(f"  Biggest spender: \"{top[0].get('table')}\", {top[0]['credits']:.0f} of "
                  f"{by_table.get('total', 0):.0f} credits in {by_table.get('window_days', '?')} days "
                  f"(gtm-memory credits, as of {by_table.get('as_of')})")
        for r in s.get("rulings") or []:
            t.say(f"  Ruling: \"{r.get('rule')}\" ({r.get('who') or '?'}, {r.get('date') or 'undated'}); "
                  "nothing below crosses it without saying so")
        need = [r for r in s["unanswered"]]
        t.say(f"  Replies waiting on you: {len(need)} (Clay inbox; left out: negative, unsubscribe, out-of-office, "
              f"{s['bounce_notices']} bounce notices and {len(s['unsubscribe_asks'])} removal asks)")
        for r in need[:5]:
            t.say(f"    {r.get('email')}  {r.get('class') or 'unclassified'}  {age(r.get('time'))}: "
                  f"\"{strip_html(r.get('snippet') or '')[:110]}\"")
            t.say(f"      next: {REPLY_NEXT.get(r.get('class'), REPLY_NEXT[None])}")
        dry = [c for c in active if c["leads_left"] is not None and c["leads_left"] < RUN_DRY_LEADS]
        refills = [x for x in ((s.get("memory") or {}).get("overdue") or {}).get("late") or []
                   if isinstance(x, dict) and x.get("kind") == "refill"]
        if refills:
            t.say(f"  Running dry: {len(refills)} campaigns have nothing left to send, every lead has had "
                  "every step (gtm-memory overdue)")
        elif dry:
            t.say(f"  Running dry: " + "; ".join(f"\"{c['name']}\" {c['leads_left']} emails queued" for c in dry[:4]))
        if s["drop"]:
            t.say(f"  Alarm: reply rate fell to {s['drop']['recent']:.1%} over the last {s['drop']['new_sends']} sends")
        bad = [r for r in s["sync"] if r.get("ok") is not True]
        for r in bad:
            t.say(f"  Not read: {r['source']} ({(r.get('note') or 'never synced')[:100]})")
    t.say("")
    t.say("Top 3 actions:")
    for n, x in enumerate(actions[:3], 1):
        t.say(f"  {n}. [{x['client']}] {x['do']}")
        t.say(f"     {x['command']}   ({x['gate']})")
    if not actions:
        t.say("  Nothing urgent. Keep the campaigns running.")
    key, context = pick_lesson(t, actions, states)
    if key:
        t.say("")
        t.say(f"Level up: {context}.")
        t.say(f"  {LESSONS[key]}")
        deeper = walkthrough_titles(LESSON_WALKTHROUGHS.get(key, []))
        if deeper:
            t.say(f"  Go deeper ({WALKTHROUGHS.relative_to(ROOT)}): " + "; ".join(deeper))
        t.lesson_done(key)
    if actions:
        remember_why("brief", actions[0]["do"], [actions[0]["why"]])
    return 0


def cmd_next(a, t: Teacher) -> int:
    states, _ = load_states(a.client)
    items = [x for s in states for x in actions_for(s)]
    for p in sorted((home() / "clients").glob("*/plan.json")):
        plan = read_json(p, {})
        for s in plan.get("steps") or []:
            if not s.get("done"):
                items.append({"score": 35, "client": plan.get("client"), "kind": "plan", "do": s["do"],
                              "command": s["command"], "gate": s["gate"], "why": "your saved plan, next step"})
                break
    items.sort(key=lambda x: -x["score"])
    if a.json:
        print(json.dumps(items, default=str, indent=1))
        return 0
    if not items:
        return no_data(t)
    t.say(f"Everything to do, most urgent first ({len(items)} items). Gate says whether it needs you.")
    for n, x in enumerate(items, 1):
        t.say(f"{n:>2}. [{x['client']}] {x['do']}")
        t.say(f"    {x['command']}")
        t.say(f"    gate: {x['gate']}. why: {x['why']}")
    remember_why("next", items[0]["do"], [items[0]["why"]])
    return 0


# ── the Friday report ─────────────────────────────────────────────────────


def week_numbers(client: str, start: date, end: date) -> dict:
    """Sends, replies, positives and meetings with a date inside [start, end],
    from the graph's per-lead send dates, reply times and meeting starts."""
    q, db = graph()
    if db is None:
        return {}
    try:
        c = q.find_client(db, client)
        cams = q.campaigns_of(db, c["id"])
        ids = [x["id"] for x in cams]
        if not ids:
            return {"sends": 0, "first": 0, "follow_ups": 0, "replies": 0, "positive": 0, "meetings": 0, "launched": []}
        marks = ",".join("?" * len(ids))
        sends = first = 0
        for r in db.execute(f"SELECT props FROM edges WHERE verb = 'ENROLLED' AND src IN ({marks})", ids):
            # A lead's earliest send date is its first email; every later one
            # is a follow up, so the week splits the way the scorecard does.
            for n, d in enumerate(sorted(json.loads(r["props"] or "{}").get("sent_dates") or [])):
                if start.isoformat() <= d[:10] <= end.isoformat():
                    sends += 1
                    first += n == 0
        reps = q.replies_in(db, ids)
        v = q.verdicts(db, [r["id"] for r in reps])
        inside = [r for r in reps if r.get("time") and start.isoformat() <= r["time"][:10] <= end.isoformat()]
        positive = {r["person"] for r in inside if (v.get(r["id"]) or {}).get("class") == "positive"}
        meetings = 0
        for r in db.execute(f"SELECT DISTINCT n.props FROM edges e JOIN nodes n ON n.id = e.src "
                            f"WHERE e.verb = 'BOOKED_FROM' AND e.dst IN ({marks})", ids):
            st = (json.loads(r["props"] or "{}").get("start") or "")[:10]
            if start.isoformat() <= st <= end.isoformat():
                meetings += 1
        launched = [x["name"] for x in cams if (x.get("created_at") or "")[:10] >= start.isoformat()
                    and (x.get("created_at") or "")[:10] <= end.isoformat()]
        return {"sends": sends, "first": first, "follow_ups": sends - first,
                "replies": len({r["person"] for r in inside if r["person"]}),
                "positive": len(positive), "meetings": meetings, "launched": launched}
    finally:
        db.close()


SCORE_HEADS = ("First emails", "Follow ups (step 2+)", "Replies", "Human replies (no out-of-office)",
               "Tagged positive (tagged, read the text)", "Bounces")


def scorecard_lines(card: dict) -> list[str]:
    """The per-company table, with a total row. Clay analytics, running
    campaigns only, bounces from Clay's stats totals."""
    if not card:
        return []
    total = dict.fromkeys(SCORE_COLS, 0)
    out = ["## By company", "", "| Company | " + " | ".join(SCORE_HEADS) + " |",
           "|---|" + "---:|" * len(SCORE_COLS)]
    for name, row in card.items():
        for k in SCORE_COLS:
            total[k] += row[k]
        out.append(f"| {md(name)} | " + " | ".join(str(row[k]) for k in SCORE_COLS) + " |")
    out.append("| Total | " + " | ".join(str(total[k]) for k in SCORE_COLS) + " |")
    out += ["", "Tagged positive is Clay's tag on a reply, not a read of it; the asks below come from the "
            "reply text itself.", ""]
    return out


def asks_lines(asks: list[dict]) -> list[str]:
    out = ["## Asked for a deck, a call or a meeting", ""]
    if not asks:
        return out + ["- Nobody yet, read from the reply text.", ""]
    for a in asks:
        who = f"{md(a['name'])} ({md(a['email'])})" if a.get("name") else md(a["email"])
        out.append(f"- {who}, {md(a.get('campaign') or '', 120)}: asked for {md(a['asked'])} "
                   f"(\"{md(a['quote'], 160)}\")")
    return out + [""]


def card_totals(card: dict) -> dict:
    return {k: sum(row[k] for row in card.values()) for k in SCORE_COLS}


def volume_ruled(s: dict) -> bool:
    return any(VOLUME_RULING.search(str(r.get("rule") or "")) for r in s.get("rulings") or [])


def update_text(s: dict) -> list[str]:
    """The client update: true numbers first, then who asked for a deck, a
    call or a meeting. Sends are "first emails plus N follow ups", never one
    total a reader compares against the list size and reads as a gap. Nobody
    is called interested from a tag, and nothing proposes sending less when a
    volume ruling stands (2026-10-09: "we'll narrow every list" went to a
    client who had asked for max volume)."""
    card = s.get("scorecard") or {}
    out = []
    if card:
        t = card_totals(card)
        sent = t["first_emails"] + t["follow_ups"]
        out.append(f"{t['first_emails']} first emails plus {t['follow_ups']} follow ups went out across "
                   f"{len(card)} {'company' if len(card) == 1 else 'companies'}, and {t['human_replies']} replies "
                   f"came from people ({t['replies']} counting out-of-office notes).")
        out.append(f"Clay tagged {t['tagged_positive']} of those replies positive; each one gets read before it "
                   f"counts. {t['bounces']} bounced ({pct(t['bounces'], sent)}).")
    else:
        out.append(f"{s['sent']} emails went out (first emails and follow ups together: the per-step split has "
                   f"not synced yet), and {s['replies']} replies came back not counting out-of-office notes.")
    asks = s.get("asks") or []
    if asks:
        who = "; ".join(f"{a.get('name') or a['email']} asked for {a['asked']}" for a in asks[:8])
        more = f", and {len(asks) - 8} more" if len(asks) > 8 else ""
        out.insert(1, f"Asked for a deck, a call or a meeting: {who}{more}.")
    else:
        out.insert(1, "Nobody has asked for a deck, a call or a meeting in their reply yet.")
    if volume_ruled(s):
        out = [x for x in out if not CUTS_VOLUME.search(x)]
    return out


def render_report(s: dict, this: dict, last: dict, start: date, end: date, actions: list[dict],
                  plan: dict | None) -> str:
    # The report goes to the client: an action a ruling holds is not proposed
    # in it at all (cmd_report says which, to the person, in the terminal).
    actions = [a for a in actions if not a.get("held_by")]
    if volume_ruled(s):
        actions = [a for a in actions if not CUTS_VOLUME.search(f"{a['do']} {a.get('command', '')}")]
    card = s.get("scorecard") or {}
    totals = card_totals(card) if card else None
    all_first = totals["first_emails"] if totals else f"{s['sent']} (with follow ups; split not synced)"
    all_follow = totals["follow_ups"] if totals else "?"

    def delta(k):
        if not last:
            return ""
        d = this.get(k, 0) - last.get(k, 0)
        return f" ({'+' if d >= 0 else ''}{d} vs last week)"

    lines = [f"# {md(s['name'])}: outbound week of {start:%b %d} to {end:%b %d, %Y}", "",
             f"Prepared {utc_now():%Y-%m-%d}. Campaign numbers from Clay analytics as of {s['as_of'] or 'never'}; "
             "weekly counts from per-lead send dates, reply times and calendar events in the local graph.", "",
             "## Summary", ""] + [md(x, 1000) for x in update_text(s)] + ["",
             "## This week", "",
             "| | This week | All time |", "|---|---:|---:|",
             f"| First emails | {this.get('first', 0)}{delta('first')} | {all_first} |",
             f"| Follow ups | {this.get('follow_ups', 0)}{delta('follow_ups')} | {all_follow} |",
             f"| People who replied (any reply, out-of-office included) | {this.get('replies', 0)}{delta('replies')} | "
             f"{(s['funnel'].get('people_replied') or {}).get('n', 0)} |",
             f"| Replies tagged positive (tagged, read the text) | {this.get('positive', 0)}{delta('positive')} | "
             f"{s['positive']} |",
             f"| Meetings booked | {this.get('meetings', 0)}{delta('meetings')} | {s['meetings']} |", "",
             f"All-time reply rate {pct(s['replies'], s['sent'])} (benchmark: at least 1%, target 2-4%). "
             f"Bounce rate {pct(s['bounces'], s['sent'])} (keep under 2%).", ""]
    lines += scorecard_lines(s.get("scorecard") or {}) + asks_lines(s.get("asks") or [])
    lines += ["## What changed", ""]
    changed = []
    if this.get("launched"):
        names = this["launched"]
        more = f", and {len(names) - 3} more" if len(names) > 3 else ""
        changed.append(f"{len(names)} new campaigns started: {', '.join(md(x) for x in names[:3])}{more}.")
    for a in actions:
        if a["kind"] in ("bounce", "floor", "drop", "dry"):
            changed.append(md(a["do"], 400) + ".")
    if not any(r.get("ok") for r in s["sync"] if "calendar" in r["source"]):
        changed.append("Meetings come from the calendar, which has not synced, so the meeting count may be low.")
    lines += [f"- {x}" for x in changed] or ["- No alarms this week."]
    lines += ["", "## Running campaigns", "", "| Campaign | Sent | Replies | Reply rate | Emails still queued |",
              "|---|---:|---:|---:|---:|"]
    for c in s["campaigns"]:
        if c["status"] == "active":
            lines.append(f"| {md(c['name'])} | {c['sent']} | {c['replies']} | "
                         f"{pct(c['replies'], c['sent'])} | {c['leads_left'] if c['leads_left'] is not None else '?'} |")
    lines += ["", "## Next week", ""]
    plan_items = [md(a["do"], 400) for a in actions if a["kind"] not in ("sync", "reply")][:5]
    if plan and not all(x.get("done") for x in plan.get("steps") or []):
        nxt = next(x for x in plan["steps"] if not x.get("done"))
        plan_items.append(f"Plan step: {md(nxt['do'])}.")
    if s["unanswered"]:
        pos = sum(1 for r in s["unanswered"] if r.get("class") == "positive")
        plan_items.insert(0, f"Answer the {len(s['unanswered'])} replies still waiting ({pos} of them "
                             "tagged positive, those first).")
    lines += [f"{n}. {x}" for n, x in enumerate(plan_items, 1)] or ["1. Keep the running campaigns going."]
    return "\n".join(lines) + "\n"


def unmd(text: str) -> str:
    """Undo md()'s backslash escapes for the PDF, where html.escape is the
    guard instead. The first PDF showed every pipe as a backslash and split
    campaign names across columns."""
    return re.sub(r"\\(.)", r"\1", text)


def md_to_html(md: str, title: str) -> str:
    body, in_table, in_list = [], False, False
    for raw in md.splitlines():
        line = raw if raw.startswith("|") else unmd(raw)
        esc = html.escape(line)
        if line.startswith("|"):
            cells = [unmd(c.strip()) for c in re.split(r"(?<!\\)\|", line.strip().strip("|"))]
            if all(re.fullmatch(r"-+:?|:?-+", c) for c in cells if c):
                continue
            if not in_table:
                body.append("<table>")
                in_table = True
                body.append("<tr>" + "".join(f"<th>{html.escape(c)}</th>" for c in cells) + "</tr>")
            else:
                body.append("<tr>" + "".join(f"<td>{html.escape(c)}</td>" for c in cells) + "</tr>")
            continue
        if in_table:
            body.append("</table>")
            in_table = False
        if re.match(r"^(- |\d+\. )", line):
            if not in_list:
                body.append("<ul>")
                in_list = True
            item = re.sub(r"^(- |\d+\. )", "", line)
            body.append(f"<li>{html.escape(item)}</li>")
            continue
        if in_list:
            body.append("</ul>")
            in_list = False
        if line.startswith("# "):
            body.append(f"<h1>{esc[2:]}</h1>")
        elif line.startswith("## "):
            body.append(f"<h2>{esc[3:]}</h2>")
        elif line.strip():
            body.append(f"<p>{esc}</p>")
    if in_table:
        body.append("</table>")
    if in_list:
        body.append("</ul>")
    css = ("body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1d1d1f;margin:40px;font-size:12px;"
           "background:#fff}h1{font-size:20px}h2{font-size:15px;margin-top:22px;border-bottom:1px solid #ddd}"
           "table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #eee;padding:5px;text-align:left}"
           "p{color:#444}")
    return (f"<!doctype html><html><head><meta charset='utf-8'><title>{html.escape(title)}</title>"
            f"<style>{css}</style></head><body>{''.join(body)}</body></html>")


CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def to_pdf(md: str, title: str, dest: Path) -> str:
    """Headless Chrome prints the HTML (a throwaway profile, never the
    person's); cupsfilter, which ships with macOS, prints plain text when
    Chrome is missing. Returns which route made the file, or ''."""
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "report.html"
        page.write_text(md_to_html(md, title))
        chrome = os.environ.get("GTME_CHROME") or CHROME
        # Chrome prints into the temp dir and the file is copied after: the
        # first live run printed straight into ~/Downloads and got nothing.
        printed = Path(tmp) / "report.pdf"
        if Path(chrome).exists():
            # Output goes to /dev/null, never a pipe: Chrome's helper processes
            # inherit the pipe and hold it open, so capture_output waited the
            # full timeout every time (measured 2026-10-10: 90 s, then the
            # cupsfilter fallback). Its own process group is killed after.
            try:
                proc = subprocess.Popen([chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                                         f"--user-data-dir={Path(tmp) / 'profile'}", f"--print-to-pdf={printed}",
                                         page.as_uri()], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                        start_new_session=True)
                # Headless Chrome on this Mac writes the PDF in about 5 s and then
                # stays alive, so the wait ends when the file stops growing.
                try:
                    last = -1
                    for _ in range(120):
                        if proc.poll() is not None:
                            break
                        size = printed.stat().st_size if printed.exists() else 0
                        if size and size == last:
                            break
                        last = size
                        time.sleep(0.5)
                finally:
                    try:
                        os.killpg(proc.pid, 9)
                    except OSError:
                        pass
                if printed.exists() and printed.stat().st_size > 0:
                    shutil.copyfile(printed, dest)
                    return "chrome"
            except (OSError, subprocess.SubprocessError):
                pass
        if shutil.which("cupsfilter"):
            txt = Path(tmp) / "report.txt"
            txt.write_text(md)
            try:
                p = subprocess.run(["cupsfilter", str(txt)], capture_output=True, timeout=60)
                if p.returncode == 0 and p.stdout:
                    dest.write_bytes(p.stdout)
                    return "cupsfilter"
            except (OSError, subprocess.SubprocessError):
                pass
    return ""


def cmd_report(a, t: Teacher) -> int:
    states, _ = load_states(a.client)
    if not states:
        return no_data(t)
    s = states[0]
    end = utc_now().date()
    start = end - timedelta(days=6) if a.week else date(2000, 1, 1)
    this = week_numbers(s["name"], start, end)
    last = week_numbers(s["name"], start - timedelta(days=7), start - timedelta(days=1)) if a.week else {}
    actions = actions_for(s)
    report = render_report(s, this, last, start, end, actions,
                           read_json(client_dir(s["name"]) / "plan.json", None))
    out_dir = Path(a.out or Path.home() / "Downloads")
    out_dir.mkdir(parents=True, exist_ok=True)
    base = f"{slug(s['name'])}-outbound-{end.isoformat()}"
    md_path = client_dir(s["name"]) / f"{base}.md"
    md_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    md_path.write_text(report)
    pdf = out_dir / f"{base}.pdf"
    how = "" if a.no_pdf else to_pdf(report, f"{safe(s['name'], 120)} outbound report", pdf)
    print(safe(report, 100000))
    t.say("Update text for the client, ready to paste:")
    for line in update_text(s):
        t.say(f"  {line}")
    for x in actions:
        if x.get("held_by"):
            t.say(f"Left out of the report: {x['do']}.")
    t.say(f"Markdown: {md_path}")
    t.say(f"PDF: {pdf} (made with {how})" if how else "PDF: not made (no Chrome and no cupsfilter)")
    return 0


# ── setup, sync, explain, why ─────────────────────────────────────────────


def record_credits(ws_ids: list[str], log=print) -> int:
    path = home() / "credits.jsonl"
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    n = 0
    for ws in ws_ids:
        bal = clay("credits", ws=ws)
        if not bal.get("ok"):
            log(f"credits {ws}: not read ({bal.get('reason') or 'failed'})")
            continue
        data = bal.get("data") or {}
        use = clay("credit-usage", ws=ws, days=7)
        used = sum_credits(use.get("data")) if use.get("ok") else None
        row = {"at": stamp(), "ws": ws, "balance": data.get("balance"), "used_7d": used,
               "source": f"chewbacca clay credits ({bal.get('surface')})"}
        with path.open("a") as f:
            f.write(json.dumps(row) + "\n")
        log(f"credits {ws}: balance {data.get('balance')}, used in 7 days {used}")
        n += 1
    return n


def sum_credits(data) -> float | None:
    """Total credits in Clay's usage tree. Each top-level entity's own number
    is used when it has one; a parent showing 0 with spending children is
    summed from the children instead, since Clay's folders did show 0 over
    their workbooks on the first read (2026-10-09)."""
    if not isinstance(data, dict) or not isinstance(data.get("entities"), list):
        return None

    def total(e):
        own = float(e.get("credits") or 0)
        kids = sum(total(k) for k in e.get("subentities") or [] if isinstance(k, dict))
        return max(own, kids)

    return round(sum(total(e) for e in data["entities"] if isinstance(e, dict)), 1)


GTM_SYNC_TIMEOUT = 1800  # guessed: a 26-campaign Clay read took ~3 minutes on 2026-10-09


def gtm_sync(t: Teacher) -> tuple[int, list[dict]]:
    """`chewbacca gtm sync --json`, reported one source per line. Returns the
    exit code and the per-source status objects; output that is not that JSON
    is a failed sync, never a silent one."""
    try:
        p = subprocess.run([sys.executable, str(ROOT / "tools" / "gtm.py"), "sync", "--json"], capture_output=True,
                           text=True, check=False, timeout=GTM_SYNC_TIMEOUT)
        body = json.loads(p.stdout or "null")
        rows = [r for r in body.get("sources") or [] if isinstance(r, dict)] if isinstance(body, dict) else None
    except (OSError, subprocess.SubprocessError, ValueError):
        p, rows = None, None
    if rows is None:
        err = (p.stderr if p is not None else "") or "no output"
        t.say(f"  Sync failed before reporting any source: {err.strip()[-200:]}")
        return (p.returncode if p is not None and p.returncode else 1), []
    for r in rows:
        if r.get("ok"):
            rep = r.get("report") or {}
            counts = ", ".join(f"{k} {rep[k]}" for k in ("campaigns", "leads", "replies", "events", "meetings")
                               if isinstance(rep.get(k), int))
            t.say(f"  {r.get('source')}: read{', ' + counts if counts else ''}")
        else:
            t.say(f"  {r.get('source')}: not read, {(r.get('note') or 'no reason given')[:160]}")
    return p.returncode, rows


def cmd_sync(a, t: Teacher) -> int:
    cfg = load_config()
    ws = [str(w) for c in cfg["clients"] for w in c.get("workspaces") or []]
    code = 0
    if not a.credits_only:
        code, _ = gtm_sync(t)
    record_credits(ws)
    return 0 if code in (0, 3) else code


def cmd_setup(a, t: Teacher) -> int:
    ask = Asker(t, a.yes)
    t.say("Connecting your outbound engine. I only read; nothing leaves this machine except reads from Clay.")
    cl = detect_clay()
    if not cl["ok"]:
        t.say("Clay isn't connected yet. If you have an account, sign in to it in Chrome and run this again; if "
              "not, signing up is your step (I'm opening the page).")
        if not a.no_open:
            open_url(CLAY_SIGNUP)
        t.say("Meanwhile, `chewbacca gtme start` builds your plan and a first list without Clay.")
        return 0
    t.say(f"Found Clay through {cl['how']}: {len(cl['workspaces'])} workspaces.")
    cfg = load_config()
    answers = []
    for w in cl["workspaces"]:
        current = owner_of(cfg, w["id"])
        hint = current or w["name"]
        name = ask.ask(f"Who is the workspace \"{w['name']}\" for? (a client or company name; 'skip' to leave it out)",
                       hint if (current or not a.only_named) else "skip")
        answers.append({"workspace": w["id"], "name": "" if name.lower() == "skip" else name})
    new = merge_clients(cfg, answers)
    write_json(config_path(), new)
    named = [x for x in answers if x["name"]]
    t.say(f"Saved {len(named)} workspaces to {config_path()}.")
    if not named:
        return 0
    if a.no_sync:
        t.say("Skipping the first sync (--no-sync).")
    else:
        t.say("First sync: reading campaigns, replies and your calendar. Read only; this can take a few minutes.")
        gtm_sync(t)
        record_credits([x["workspace"] for x in named])
    states, _ = load_states()
    for s in states:
        t.say(f"  {s['name']}: {len(s['campaigns'])} campaigns, {s['sent']} emails sent, {s['replies']} replies, "
              f"{len(s['unanswered'])} waiting on you")
        for r in s["sync"]:
            if r.get("ok") is False and "calendar" in (r.get("note") or "").lower():
                t.say("  Calendar: switch on your terminal app under Privacy & Security > Calendars "
                      "(opening that pane now).")
                if not a.no_open:
                    open_url(CALENDAR_PANE)
    t.say("Done. `chewbacca gtme brief` is your morning standup from here on.")
    return 0


def cmd_rule(a, t: Teacher) -> int:
    try:
        r = add_ruling(a.client, " ".join(a.rule), a.who, a.source)
    except ValueError as err:
        print(f"chewbacca gtme rule: {err}", file=sys.stderr)
        return 2
    t.say(f"Ruling saved for {a.client}: \"{r['rule']}\" ({r['who']}, {r['date']}).")
    t.say("brief, next and report now check every recommendation against it and say so, naming "
          f"{r['who']}, when one would cross it.")
    return 0


def cmd_explain(a, t: Teacher) -> int:
    want = " ".join(a.term).strip().lower()
    hit = next((k for k in GLOSSARY if k.lower() == want or k.lower() + "s" == want), None)
    if not hit:
        t.quiet = True
        t.say(f"I don't have \"{want}\" yet. Terms I can explain: {', '.join(sorted(GLOSSARY))}.")
        return 1
    print(GLOSSARY[hit])
    if not t.known(hit):
        t.teach(hit)
    return 0


def cmd_why(a, t: Teacher) -> int:
    last = read_json(home() / "last.json", None)
    if not last:
        t.say("No recommendation yet. Run `chewbacca gtme brief` or `chewbacca gtme start` first.")
        return 0
    t.say(f"Last recommendation ({last['kind']}, {last['at']}): {last['title']}")
    for r in last["reasons"]:
        t.say(f"  because: {r}")
    return 0


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] in ("sender", "find", "batch", "send", "inbox", "reply", "today", "package", "costs"):
        import gtme_solo
        return gtme_solo.main(argv)
    if not argv or argv[0].startswith("-") and argv[0] not in ("-h", "--help"):
        argv = ["start"] + argv
    ap = argparse.ArgumentParser(prog="chewbacca gtme", description=__doc__.splitlines()[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("start", help="plain questions about your business -> a plan")
    p.add_argument("--client")
    p.add_argument("--redo", action="store_true", help="ask the questions again")
    p.add_argument("--yes", action="store_true", help="take every default without asking")
    p.add_argument("--no-open", action="store_true", help="never open a web page")
    p = sub.add_parser("list", help="build and dedupe the first list from public sources")
    p.add_argument("--client", required=True)
    p = sub.add_parser("setup", help="connect Clay, name each workspace, run the first sync")
    p.add_argument("--yes", action="store_true")
    p.add_argument("--no-open", action="store_true")
    p.add_argument("--no-sync", action="store_true")
    p.add_argument("--only-named", action="store_true", help="default new workspaces to skip")
    p = sub.add_parser("brief", help="the morning standup")
    p.add_argument("--client")
    p.add_argument("--sync", action="store_true", help="refresh in the background first")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("next", help="every client's to-do list with commands and gates")
    p.add_argument("--client")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("report", help="the client summary as markdown and a PDF")
    p.add_argument("--client", required=True)
    p.add_argument("--week", action="store_true")
    p.add_argument("--out", help="PDF folder (default ~/Downloads)")
    p.add_argument("--no-pdf", action="store_true")
    p = sub.add_parser("rule", help="save a standing ruling from the client (always or never do X)")
    p.add_argument("--client", required=True)
    p.add_argument("rule", nargs="+", help="the ruling, in plain words")
    p.add_argument("--who", required=True, help="who made it, and so who owns changing it")
    p.add_argument("--source", help="where it was said (a thread, a call, a date)")
    p = sub.add_parser("explain", help="one plain sentence for a term")
    p.add_argument("term", nargs="+")
    sub.add_parser("why", help="why the last recommendation")
    p = sub.add_parser("sync", help="chewbacca gtm sync plus credit balances")
    p.add_argument("--credits-only", action="store_true")
    a = ap.parse_args(argv)
    t = Teacher(quiet=getattr(a, "json", False))
    try:
        if a.cmd in ("brief", "next", "report"):
            try:
                return {"brief": cmd_brief, "next": cmd_next, "report": cmd_report}[a.cmd](a, t)
            except LookupError as err:
                print(f"chewbacca gtme: {err}", file=sys.stderr)
                return 1
        return {"start": cmd_start, "list": cmd_list, "setup": cmd_setup, "explain": cmd_explain,
                "why": cmd_why, "sync": cmd_sync, "rule": cmd_rule}[a.cmd](a, t)
    finally:
        t.save()


if __name__ == "__main__":
    sys.exit(main())
