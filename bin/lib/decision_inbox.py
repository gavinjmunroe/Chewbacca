"""The decision inbox: one feed of what only Caleb can decide, and receipts for the rest.

Caleb, 2026-10-13 8:36am: "I hv a feeling genius product engineers would hv
some genius way of completely flipping chewbacca around to be better". The
flip is the one Togari already runs for Jonah: agents answer everything, and
the person is tagged only when it truly needs him, with one receipt line for
the rest. Screen Time 10/7 to 10/13 had 34 of 64 hours in VS Code and the
Claude app, and on 10/12 he typed "Progress?" and "We good?" into tabs that
had the answer and never offered it.

This module is the feed's ONE owner (Daniel's rule). Every surface that shows
it, the HUD panel (surfaces/decisions.py) and the phone digest, calls
build_feed() and draws what it returns. It keeps no store of its own: it reads
what already exists.

    the jobs queue      ~/.chewbacca/jobs/<id>/job.json, and an agent job's
                        REPORT-<name>.md next to its prompt
    the work-ledger     ~/.chewbacca/work-ledger.sqlite, read only here
    the tab board       ~/.chewbacca/tabs.sqlite, for what is still working
    the verdict log     ~/.chewbacca/logs/verdicts.tsv, for sends held on him

Every item is exactly one of two kinds, and the Item constructor refuses the
mix:

    decision   needs Caleb: a question, its options, and a recommendation
    receipt    done (or failed, or stopped): one line, with proof (a sha on
               main, a job id and exit code, a ledger task's evidence)

A decision without a recommendation and two options, or a receipt without
proof, can't be built: Item refuses it. Every source yields a Draft, and only
Draft.ready() turns one into an Item. What isn't ready lands in `held` with
the reason, so the gap is a count an agent can close instead of a vague row
he has to research. On 10/13, 7 of the 11 calls agents handed him said "ur
call" and stopped; untaken() finds those lines in a report, and
`decision-inbox check` and the jobs runner both run it, so the agent that
wrote the line sees it before he does.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import subprocess
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Callable, Iterable

DECISION = "decision"
RECEIPT = "receipt"
KINDS = (DECISION, RECEIPT)

# A report line that hands Caleb a call. Read from the 10/12 and 10/13 report
# corpus: "Ur calls, no rush", "Two calls only u can make", "it's ur call",
# "(your call, nothing opened)", and the BLOCKED: lines agents write for a
# click only he can make.
CALL = re.compile(r"\b(?:ur|your) calls?\b|\bcalls? only (?:u|you)\b|\bonly (?:u|you) can (?:make|decide)\b"
                  r"|\bur decision\b|\bcaleb decides\b|\bcaleb'?s (?:call|decision)\b"
                  r"|^\s*(?:(?:[-*]|\d+[.)])\s*)?BLOCKED:", re.I)
# Where the agent's own recommendation starts. A take written later by
# another agent says so in brackets: "My take (takes-gate lane, 10/13): ...".
REC = re.compile(r"\b(?:my (?:rec|take|recommendation|pick|vote)|i'?d (?:recommend|go with|say)|rec)"
                 r"(?:\s*\([^()\n]{1,80}\))?\s*:\s*", re.I)
# Words about calls that hand none over: a quote ("7 of 11 said "ur call""),
# code, or the phrase used as a noun ("one feed of only ur calls", "never show
# as ur calls", "opens with the calls only u can make"). All were 10/13 report
# lines the feed held as calls. Plural only: "leaving it as ur call" and "only
# your call" hand one over (review on e80791e9).
QUOTED = re.compile(r'"[^"\n]*"|\u201c[^\u201d\n]*\u201d|`[^`\n]*`')
MENTION = re.compile(r"\b(?:as|of|only|shows?|these|those)\s+(?:ur|your)\s+calls\b"
                     r"|\bthe\s+calls?\s+only\s+(?:u|you)\b", re.I)
# A recap of calls raised elsewhere, takes included ("Ur calls, my take on
# each: keep the repo PRIVATE... Turn ON text-ur-own-Mac..."; the 10/13 day
# summary). Read as one call it glued four calls into one merged row.
RECAP = re.compile(r"\bmy takes? on (?:each|both|all)\b", re.I)
BLOCKED = re.compile(r"^\s*(?:(?:[-*]|\d+[.)])\s*)?BLOCKED:\s*", re.I)
SHA = re.compile(r"(?<![0-9a-zA-Z/])([0-9a-f]{8,40})(?![0-9a-zA-Z])")
# Ledger rows that are a decision by their own words. "Decide:" is how the
# ledger's 10/9 history-wipe and 10/13 Apple ID tasks were written; the rest
# is how agents marked a task as waiting on his call.
LEDGER_CALL = re.compile(r"^\s*decide\b|\bcaleb'?s call\b|\bcaleb decides\b|\bur call\b|\byour call\b"
                         r"|\bis caleb'?s\b|\bdecide yes\b", re.I)
# Words that carry no topic, for telling two wordings of one call apart.
STOP = set("""a an the and or but if of to in on for with without by at from as is are was were be been it its it's
this that these those u ur you your my me i we our they them their he his she her not no yes do does did done
can could would should will just still now then than so bc about into out over up down only one two all any
some more most less very what when where which who why how there here have has had get got go going call calls
decide decision rec take whether""".split())
# Merging two wordings of one call: the share of the shorter one's topic words
# found in the other. On the 10/13 corpus the Apple ID ledger task against the
# normal-person report line scored 0.62, the history wipe against "what comes
# out before it goes public" 0.33, and unrelated pairs (the Chrome extension
# against going public) 0.17 to 0.20. Measured on that one day only, 17 pairs.
SAME_CALL = 0.33
# Two shared topic words at least, so a three-word ledger title can't merge on
# one common word.
SAME_CALL_WORDS = 2
# The overnight morning summary (overnight/<night>/REPORT.md) hands over the
# calls the night raised, and those stay open into the day: 10/12's had the
# going-public call that every 10/13 lane re-raised without a take. One night
# back is what a day's inbox reads; older calls live on in the ledger.
MORNING_SUMMARY_S = 36 * 3600
# A tab seen in the last 15 minutes is still working. Guessed, never measured.
LIVE_TAB_S = 15 * 60
# Calls a phone digest spells out before "+N more on the HUD". Guessed, never
# measured as a limit: three put the 10/13 digest at 723 characters.
DIGEST_CALLS = 3


def why_not_drawn(item) -> str | None:
    """None when a row (Item or Draft) can be drawn, else the one reason it can't."""
    if not item.text.strip():
        return "no text"
    if item.kind == DECISION:
        if not item.recommendation.strip():
            return "no recommendation"
        if len(item.options) < 2:
            return "fewer than two options"
        return None
    if not item.proof.strip():
        return "no proof"
    return None


@dataclass(frozen=True)
class Draft:
    """A row as its source wrote it, take or no take. Only ready() makes an
    Item of it, so nothing half-made can reach a surface by another path."""
    kind: str
    key: str
    text: str
    source: str
    at: float = 0.0
    recommendation: str = ""
    options: tuple = ()
    proof: str = ""
    state: str = ""
    sources: tuple = ()

    def ready(self) -> tuple["Item | None", str | None]:
        reason = why_not_drawn(self)
        if reason:
            return None, reason
        return Item(**{f: getattr(self, f) for f in self.__dataclass_fields__}), None


@dataclass(frozen=True)
class Item:
    """A drawable row. A decision with no take or fewer than two options, or a
    receipt with no proof, raises: it can't exist, so it can't be drawn."""
    kind: str
    key: str
    text: str
    source: str
    at: float = 0.0
    recommendation: str = ""
    options: tuple = ()
    proof: str = ""
    state: str = ""
    sources: tuple = ()

    def __post_init__(self) -> None:
        if self.kind not in KINDS:
            raise ValueError(f"an item is a decision or a receipt, not {self.kind!r}")
        if self.kind == DECISION and (self.proof or self.state):
            raise ValueError("a decision carries no proof or state: it is not done yet")
        if self.kind == RECEIPT and (self.recommendation or self.options):
            raise ValueError("a receipt carries no options or recommendation: nothing is left to decide")
        reason = why_not_drawn(self)
        if reason:
            raise ValueError(f"a {self.kind} with {reason} can't be drawn: hold its Draft instead")


@dataclass
class Feed:
    day: str
    decisions: list = field(default_factory=list)
    receipts: list = field(default_factory=list)
    held: list = field(default_factory=list)      # (Draft, reason)
    working: list = field(default_factory=list)   # plain lines: what is still running
    built_at: float = 0.0

    def as_json(self) -> dict:
        def one(i) -> dict:
            out = {"kind": i.kind, "key": i.key, "text": i.text, "source": i.source}
            if i.kind == DECISION:
                out.update(recommendation=i.recommendation, options=list(i.options), sources=list(i.sources))
            else:
                out.update(proof=i.proof, state=i.state)
            return out
        return {"day": self.day, "built_at": self.built_at,
                "decisions": [one(i) for i in self.decisions],
                "receipts": [one(i) for i in self.receipts],
                "held": [dict(one(i), reason=r) for i, r in self.held],
                "working": self.working,
                "counts": {"decisions": len(self.decisions), "receipts": len(self.receipts),
                           "held": len(self.held), "working": len(self.working)}}


def clip(text: str, limit: int) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip(" ,.;:") + "…"


def plain(text: str) -> str:
    """Markdown off a report line: no bullets, no bold, no backticks."""
    text = re.sub(r"^\s*(?:[-*]|\d+[.)]|\([a-z]\))\s+", "", text)
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = text.replace("`", "")
    return " ".join(text.split())


def words(text: str) -> set:
    return {w for w in re.findall(r"[a-z][a-z0-9']+", text.lower()) if w not in STOP and len(w) > 2}


def overlap(a: str, b: str) -> float:
    """Containment: the share of the shorter text's topic words in the other."""
    x, y = words(a), words(b)
    shared = x & y
    if len(shared) < SAME_CALL_WORDS:
        return 0.0
    return len(shared) / min(len(x), len(y))


# ── reports ──────────────────────────────────────────────────────────────

HEADING = re.compile(r"^\s*(#{1,6})\s")
ITEM_START = re.compile(r"^\s*(?:[-*]|\d+[.)])\s")


def hands_a_call(line: str) -> bool:
    """The line hands him a call: call words outside quotes and code, used as
    a hand-over rather than as a noun, and not a heading or an intro line
    ("Calls only u can make (4):") over calls written below it."""
    said = MENTION.sub(" ", QUOTED.sub(" ", line))
    if not CALL.search(said) or RECAP.search(said):
        return False
    intro = HEADING.match(line) or line.rstrip().endswith(":")
    return not (intro and re.search(r"\bcalls\b", said, re.I))


def indent(line: str) -> int:
    return len(line) - len(line.lstrip())


def beside(lines: list[str], i: int) -> str:
    """What counts as next to line i: a heading's section, or an item's own
    continuation and sub-items (deeper lines, up to a blank line), plus a
    sibling bullet right under it that is a take ("- My take: ..."). Either
    stops at the next line that hands over a call of its own, so one call
    never borrows the take written for the next (review on e80791e9)."""
    out = []
    head = HEADING.match(lines[i])
    for line in lines[i + 1:]:
        h = HEADING.match(line)
        if hands_a_call(line):
            break
        if head:
            if h and len(h.group(1)) <= len(head.group(1)):
                break
        elif not line.strip() or h:
            break
        elif ITEM_START.match(line) and indent(line) <= indent(lines[i]):
            if REC.match(plain(line)):
                out.append(line)
            break
        out.append(line)
    return "\n".join(out)


def report_calls(text: str) -> list[tuple[int, str, str]]:
    """(line number, line, what is next to it) for every line in a report that
    hands him a call, outside fenced code and tables."""
    lines, fenced, out = text.splitlines(), False, []
    for i, line in enumerate(lines):
        if line.strip().startswith("```"):
            fenced = not fenced
            continue
        if fenced or not line.strip() or line.lstrip().startswith("|"):
            continue
        if hands_a_call(line):
            out.append((i + 1, line, beside(lines, i)))
    return out


def take_in(text: str) -> str:
    """The take written next to a call: the rest of the first line holding one."""
    for line in text.splitlines():
        m = REC.search(plain(line))
        if m:
            return plain(line)[m.end():].strip()
    return ""


def untaken(text: str) -> list[tuple[int, str]]:
    """(line number, line) for each call in a report with no take next to it.
    The check behind `decision-inbox check` and the jobs runner's note."""
    out = []
    for n, line, near in report_calls(text):
        for part in sub_calls(line):
            if not (split_call(part)[1] or take_in(near)):
                out.append((n, plain(line)))
                break
    return out


CALL_PREFIX = re.compile(r"^(?:(?:ur|your) calls?|(?:two|three|\d+) calls? only (?:u|you) can make)[^:.]*[:.]\s*", re.I)
CALL_ASIDE = re.compile(r"\s*\((?:ur|your) call\b[^()]*\)", re.I)
PAREN = re.compile(r"\(([^()]{8,})\)\s*\.?\s*$")


def split_call(block: str) -> tuple[str, str]:
    """(question, recommendation) from one call. The question is what the
    agent said the call is; the recommendation is what it said after "My
    take:" or "My rec:". A BLOCKED line's recommendation is its own step, and
    the step's how-to in brackets when it gave one."""
    body = re.sub(r"^\d+[.)]\s+", "", plain(HEADING.sub("", block)))
    # "(your call: $49 or $99, my take: $49)": the take inside the aside is
    # the take, so it is read before the aside goes (review on e80791e9).
    aside = CALL_ASIDE.search(body)
    if aside and not BLOCKED.match(block):
        m = REC.search(aside.group(0))
        if m:
            question = CALL_ASIDE.sub("", body).strip() or body
            return question, aside.group(0)[m.end():].rstrip(") ").strip()
    body = CALL_ASIDE.sub("", body).strip() or body
    if BLOCKED.match(block):
        step = BLOCKED.sub("", plain(block.strip()))
        m = REC.search(step)
        if m:
            return step[: m.start()].strip(), step[m.end():].strip()
        # A click with its how-to in brackets carries its own take. A bare
        # BLOCKED line ("BLOCKED: pricing") doesn't, and is held like any call.
        how = PAREN.search(step)
        return step, f"Do it: {how.group(1)}" if how else ""
    # The prefix ("Ur calls, no rush:") goes, but never the whole question: "Ur
    # call on pricing." stays as written rather than emptying to nothing and
    # dropping out of the feed (review on e80791e9).
    m = REC.search(body)
    if not m:
        return CALL_PREFIX.sub("", body).strip() or body, ""
    question, rec = body[: m.start()].strip(), body[m.end():].strip()
    return CALL_PREFIX.sub("", question).strip() or question, rec


def sub_calls(block: str) -> list[str]:
    """One line can hand over several calls: "Two calls only u can make. (a)
    Going public: ... My rec: ... (b) Switching on ... My rec: ..." (the 10/12
    morning summary). Each lettered part is its own call."""
    parts = re.split(r"\s(?=\([a-z]\)\s)", plain(block))
    if len(parts) < 2:
        return [block]
    return [re.sub(r"^\([a-z]\)\s*", "", p) for p in parts[1:]]


def decisions_in_report(text: str, source: str, at: float = 0.0) -> list[Draft]:
    out = []
    for _n, block, near in report_calls(text):
        for part in sub_calls(block):
            question, rec = split_call(part)
            rec = rec or take_in(near)
            options = ("Do it", "Later") if BLOCKED.match(part) else ("Go with my take", "Not now")
            out.append(Draft(DECISION, key=call_key(source, question, rec), text=question, source=source,
                             at=at, recommendation=rec, options=options if rec else (), sources=(source,)))
    return out


def call_key(source: str, question: str, rec: str) -> str:
    """A call's id is its content: a take that changes between the draw and
    the press is a different call, so the press can't approve words he never
    saw (security review on 0acab944)."""
    digest_ = hashlib.sha1(f"{question}\n{rec}".encode()).hexdigest()[:12]
    return f"report:{source}:{digest_}"


def report_title(text: str) -> str:
    for line in text.splitlines():
        if line.startswith("# "):
            return plain(line[2:])
    return ""


# ── the jobs queue ───────────────────────────────────────────────────────

PROMPT = re.compile(r"\$\(cat ([^)\s\"]+?\.md)\)")


def job_report(job: dict, overnight: Path | None = None) -> Path | None:
    """An agent job's report: REPORT-<name>.md next to the prompt <name>.md,
    the convention every 10/13 daytime lane wrote to."""
    cmd = " ".join(job.get("cmd") or [])
    m = PROMPT.search(cmd)
    if not m:
        return None
    prompt = Path(os.path.expanduser(m.group(1).strip("\"'")))
    for candidate in (prompt.with_name(f"REPORT-{prompt.stem}.md"), prompt.with_name(f"{prompt.stem}-report.md")):
        if candidate.is_file():
            return candidate
    return None


def local_day(stamp: float) -> str:
    return datetime.fromtimestamp(stamp).date().isoformat() if stamp else ""


def from_jobs(jobs_dir: Path, day: str, on_main: Callable[[str], bool]) -> tuple[list, list, list]:
    """(receipts, decisions, working) for every job submitted on `day`. A job
    resubmitted under the same title is one row: the newest attempt."""
    jobs = []
    for path in sorted(jobs_dir.glob("*/job.json")):
        try:
            job = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if local_day(job.get("created") or 0) == day:
            jobs.append(job)
    latest: dict = {}
    for job in jobs:
        title = job.get("title") or job.get("id")
        if title not in latest or (job.get("created") or 0) >= (latest[title].get("created") or 0):
            latest[title] = job
    tries = {}
    for job in jobs:
        title = job.get("title") or job.get("id")
        tries[title] = tries.get(title, 0) + 1
    receipts, decisions, working = [], [], []
    reported: dict = {}
    for title, job in sorted(latest.items(), key=lambda kv: kv[1].get("created") or 0):
        status = job.get("status") or ""
        at = job.get("ended") or job.get("created") or 0.0
        if status in ("queued", "running", "paused"):
            working.append(f"{clip(title, 70)} ({status})")
            continue
        report = job_report(job)
        if report is not None:
            # Two jobs (a killed first run and its rerun under a new title)
            # wrote one report: one receipt, the newest job's.
            if report in reported:
                receipts.remove(reported[report])
        text = ""
        if report:
            try:
                text = report.read_text(errors="replace")
            except OSError:
                text = ""
        shas = []
        for sha in SHA.findall(text):
            if sha not in shas and on_main(sha):
                shas.append(sha[:8])
        if shas:
            proof = "on main: " + ", ".join(shas[:4]) + (f" +{len(shas) - 4}" if len(shas) > 4 else "")
        elif report:
            proof = f"report {report.name}"
        else:
            proof = f"job {job.get('id')} exit {job.get('exit')}" if job.get("exit") is not None \
                else f"job {job.get('id')} {status}"
        again = tries[title] - 1
        line = report_title(text) or title
        if again:
            line += f" ({again} earlier {'try' if again == 1 else 'tries'})"
        state = {"done": "done" if job.get("exit") in (0, None) else "failed"}.get(status, status)
        receipt = Draft(RECEIPT, key=f"job:{job.get('id')}", text=line, source="jobs", at=at,
                       proof=proof, state=state)
        receipts.append(receipt)
        if report is not None:
            reported[report] = receipt
        if text and report is not None and all(d.source != report.name for d in decisions):
            decisions.extend(decisions_in_report(text, report.name, at))
    return receipts, decisions, working


def day_reports(jobs_dir: Path, day: str) -> list[Path]:
    """Every agent job report from jobs submitted on `day`, oldest first."""
    out = []
    for path in sorted(jobs_dir.glob("*/job.json")):
        try:
            job = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        report = job_report(job) if local_day(job.get("created") or 0) == day else None
        if report and report not in out:
            out.append(report)
    return out


def check_reports(paths: Iterable[Path]) -> list[tuple[Path, int, str]]:
    """(report, line number, line) for each call handed over with no take."""
    out = []
    for path in paths:
        try:
            text = Path(path).read_text(errors="replace")
        except OSError:
            continue
        out.extend((Path(path), n, line) for n, line in untaken(text))
    return out


def morning_calls(overnight: Path, now: float) -> list[Draft]:
    """The calls in the newest morning summary, if it is from the last night."""
    summaries = sorted(overnight.glob("*/REPORT.md"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not summaries or now - summaries[0].stat().st_mtime > MORNING_SUMMARY_S:
        return []
    newest = summaries[0]
    try:
        text = newest.read_text(errors="replace")
    except OSError:
        return []
    return decisions_in_report(text, f"{newest.parent.name}/REPORT.md", newest.stat().st_mtime)


def git_on_main(repo: Path) -> Callable[[str], bool]:
    """A check that a sha is a commit on origin/main of `repo`, cached."""
    seen: dict = {}

    def check(sha: str) -> bool:
        if sha not in seen:
            try:
                ok = subprocess.run(["git", "-C", str(repo), "merge-base", "--is-ancestor", sha, "origin/main"],
                                    capture_output=True, timeout=10).returncode == 0
            except (OSError, subprocess.TimeoutExpired):
                ok = False
            seen[sha] = ok
        return seen[sha]
    return check


# ── the work-ledger ──────────────────────────────────────────────────────

def ledger_rows(db: Path) -> list[dict]:
    if not db.is_file():
        return []
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
    except sqlite3.Error:
        return []
    try:
        con.row_factory = sqlite3.Row
        return [dict(r) for r in con.execute(
            "select id, scope, source_key, title, status, owner, next_action, evidence, reason, updated_at from tasks")]
    except sqlite3.Error:
        return []
    finally:
        con.close()


def from_ledger(rows: Iterable[dict], day: str) -> tuple[list, list, set]:
    """(receipts, decisions, chosen) where chosen holds the keys he already
    answered on the inbox (ledger source_key inbox:<key>)."""
    receipts, decisions, chosen = [], [], set()
    for r in rows:
        status, title = r.get("status"), plain(r.get("title") or "")
        key = r.get("source_key") or ""
        if key.startswith("inbox:"):
            chosen.add(key[len("inbox:"):])
            if (r.get("updated_at") or "")[:10] == day:
                receipts.append(Draft(RECEIPT, key=f"ledger:{r['id']}", text=title, source="ledger",
                                      proof=f"ledger {str(r['id'])[:8]}", state="chosen"))
            continue
        if status == "done" and (r.get("updated_at") or "")[:10] == day:
            receipts.append(Draft(RECEIPT, key=f"ledger:{r['id']}", text=title, source="ledger",
                                  proof=clip(plain(r.get("evidence") or ""), 80), state="done"))
        elif status in ("queued", "active", "blocked") and (r.get("owner") or "").lower() in ("", "caleb"):
            # An agent-owned task is the agents' work even when its words
            # mention a call: on 10/13 the inbox's own follow-up ("calls as
            # 'ur call' with no take") drew as one of his decisions.
            said = " ".join([title, r.get("next_action") or "", r.get("reason") or ""])
            if LEDGER_CALL.search(said):
                text = re.sub(r"^\s*decide\s*:\s*", "", title, flags=re.I)
                # A take on the task itself ("My take: ..." in its next
                # action) is the call's take, so a ledger call can be drawn
                # without a report line to merge with.
                rec = take_in(r.get("next_action") or "") or take_in(r.get("reason") or "")
                decisions.append(Draft(DECISION, key=f"ledger:{r['id']}", text=text, source="ledger",
                                       recommendation=rec, options=("Go with my take", "Not now") if rec else (),
                                       sources=("ledger",)))
    return receipts, decisions, chosen


# ── the verdict log and the tab board ────────────────────────────────────

def held_sends(log: Path, day: str) -> list[Draft]:
    """Sends a guard held for his approval today. CHEWBACCA_NO_SEND holds are
    dry runs (and the gtme tests write their fixture sends to this same log),
    so they are not waiting on anyone."""
    if not log.is_file():
        return []
    start = datetime.fromisoformat(day).timestamp() * 1000
    end = start + 86_400_000
    out, seen = [], set()
    try:
        lines = log.read_text(errors="replace").splitlines()
    except OSError:
        return []
    for line in lines:
        p = line.split("\t")
        if len(p) < 9 or not p[0].isdigit() or not start <= int(p[0]) < end:
            continue
        if p[1] != "send" or p[4] != "held" or "NO_SEND" in p[8]:
            continue
        subject = p[7] or p[2]
        if subject in seen:
            continue
        seen.add(subject)
        out.append(Draft(DECISION, key=f"verdict:{subject}", text=f"A send is held for you: {clip(subject, 70)}",
                        source="verdicts", at=int(p[0]) / 1000, sources=("verdicts",)))
    return out


def live_tabs(db: Path, now: float) -> list[str]:
    if not db.is_file():
        return []
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
        rows = con.execute("select repo, cwd, coalesce(last_task, first_task, '') from sessions "
                           "where ended is null and last_seen >= ?", (now - LIVE_TAB_S,)).fetchall()
        con.close()
    except sqlite3.Error:
        return []
    return [f"tab in {Path(repo or cwd or '?').name}" for repo, cwd, _task in rows]


# ── one feed ─────────────────────────────────────────────────────────────

def merge(decisions: list[Draft]) -> list[Draft]:
    """One row per call. Two wordings of the same call (by word overlap) are
    one decision that keeps the recommendation and every source that raised it."""
    groups: list[list[Draft]] = []
    for item in decisions:
        for group in groups:
            if any(overlap(item.text + " " + item.recommendation, g.text + " " + g.recommendation) >= SAME_CALL
                   for g in group):
                group.append(item)
                break
        else:
            groups.append([item])
    out = []
    for group in groups:
        best = max(group, key=lambda i: (bool(i.recommendation), i.at))
        sources = tuple(dict.fromkeys(s for g in group for s in (g.sources or (g.source,))))
        options = best.options or (("Go with my take", "Not now") if best.recommendation else ())
        out.append(Draft(DECISION, key=best.key, text=best.text, source=best.source, at=best.at,
                         recommendation=best.recommendation, options=options, sources=sources))
    return out


def build_feed(day: str | None = None, home: Path | None = None, repo: Path | None = None,
               on_main: Callable[[str], bool] | None = None, now: float | None = None) -> Feed:
    home = Path(home or os.environ.get("CHEWBACCA_HOME") or Path.home() / ".chewbacca")
    day = day or date.today().isoformat()
    now = time.time() if now is None else now
    repo = Path(repo or os.environ.get("CHEWBACCA_REPO") or Path.home() / "code" / "chewbacca")
    on_main = on_main or git_on_main(repo)
    feed = Feed(day=day, built_at=now)

    job_receipts, report_calls, working = from_jobs(home / "jobs", day, on_main)
    report_calls += morning_calls(home / "overnight", now)
    ledger_receipts, ledger_calls, chosen = from_ledger(ledger_rows(home / "work-ledger.sqlite"), day)
    sends = held_sends(home / "logs" / "verdicts.tsv", day)
    feed.working = working + live_tabs(home / "tabs.sqlite", now)

    for item in merge(report_calls + ledger_calls + sends):
        if item.key in chosen or any(s in chosen for s in item.sources if s.startswith("ledger:")):
            continue
        drawn, reason = item.ready()
        (feed.held.append((item, reason)) if reason else feed.decisions.append(drawn))
    seen = set()
    for item in job_receipts + ledger_receipts:
        # One row per key. On 10/13 one stopped job drew twice in a build
        # taken while the queue was writing; never reproduced, made impossible.
        if item.key in seen:
            continue
        seen.add(item.key)
        drawn, reason = item.ready()
        (feed.held.append((item, reason)) if reason else feed.receipts.append(drawn))
    # Calls with a click first (BLOCKED lines), then newest first.
    feed.decisions.sort(key=lambda i: (i.options[0] != "Do it", -i.at))
    feed.receipts.sort(key=lambda i: -i.at)
    return feed


# ── the phone digest ─────────────────────────────────────────────────────

def digest(feed: Feed) -> str:
    """One text message, never sent: the calls first, then one line for
    everything that got done. Plain words, his register."""
    lines = []
    n = len(feed.decisions)
    if n:
        lines.append(f"{n} call{'s' if n != 1 else ''} only u can make:")
        for i, item in enumerate(feed.decisions[:DIGEST_CALLS], 1):
            lines.append(f"{i}. {clip(item.text, 90)} My take: {clip(item.recommendation, 110)}")
        if n > DIGEST_CALLS:
            lines.append(f"+{n - DIGEST_CALLS} more on the HUD")
    else:
        lines.append("Nothing needs u rn")
    done = [r for r in feed.receipts if r.state in ("done", "chosen")]
    other = len(feed.receipts) - len(done)
    shas = sum(1 for r in feed.receipts if r.proof.startswith("on main"))
    tail = f"Done today: {len(done)}, {shas} of them landed code on main"
    if other:
        tail += f". {other} failed or stopped, each has its log"
    if feed.working:
        tail += f". Still working: {len(feed.working)}"
    lines.append(tail)
    return "\n".join(lines)


# ── the scoreboard (Cole's) ──────────────────────────────────────────────

# His status asks, short messages only. Read from the 10/12 and 10/13
# transcripts: "Progress?", "We good?", "WE good?".
STATUS_ASK = re.compile(r"^\W*(?:progress|we good|u good|status|update|updates|any updates?|how'?s it (?:going|looking)"
                        r"|where (?:are|r) we|what'?s the status|eta|is it done|done yet|still (?:working|going)"
                        r"|how far)\W*$", re.I)
WATCH_APPS = ("com.microsoft.VSCode", "com.anthropic.claudefordesktop")


def status_asks(projects: Path, day: str) -> dict:
    """His typed messages on `day` (local time) in Claude Code transcripts,
    and how many were a bare status ask. Headless job runs (sdk-cli) are not
    him and are skipped."""
    start = datetime.fromisoformat(day).astimezone()
    end = start + timedelta(days=1)
    human = asks = 0
    examples = []
    for path in projects.glob("*/*.jsonl"):
        try:
            if path.stat().st_mtime < start.timestamp():
                continue
            fh = path.open(errors="replace")
        except OSError:
            continue
        with fh:
            for line in fh:
                if '"type":"user"' not in line and '"type": "user"' not in line:
                    continue
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                if r.get("type") != "user" or r.get("isMeta") or r.get("isSidechain") \
                        or str(r.get("entrypoint") or "").startswith("sdk"):
                    continue
                content = (r.get("message") or {}).get("content")
                if isinstance(content, list):
                    if any(isinstance(x, dict) and x.get("type") == "tool_result" for x in content):
                        continue
                    content = " ".join(x.get("text", "") for x in content if isinstance(x, dict))
                text = str(content or "").strip()
                if not text or text.startswith("<") or len(text) > 4000:
                    continue
                try:
                    at = datetime.fromisoformat(str(r.get("timestamp", "")).replace("Z", "+00:00"))
                except ValueError:
                    continue
                if not start <= at < end:
                    continue
                human += 1
                if STATUS_ASK.match(text):
                    asks += 1
                    examples.append(f"{at.astimezone().strftime('%H:%M')} {clip(text, 20)}")
    return {"messages": human, "status_asks": asks, "examples": sorted(examples)}


def watching_minutes(day: str, run: Callable = subprocess.run) -> dict:
    """Minutes in VS Code and the Claude app on `day`, from screen-time."""
    try:
        out = run(["screen-time", "--end", day, "--days", "1", "--json"], capture_output=True, text=True,
                  timeout=60).stdout
        body = json.loads(out or "{}")
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {"minutes": None, "total_minutes": None}
    apps = {a.get("bundle"): a.get("minutes") or 0 for a in body.get("apps") or []}
    return {"minutes": sum(apps.get(b, 0) for b in WATCH_APPS),
            "by_app": {b: apps.get(b, 0) for b in WATCH_APPS},
            "total_minutes": body.get("total_minutes")}
