#!/usr/bin/env python3
"""Replay "what am I missing" on past days and score it against hand labels.

    missing_eval.py snapshot                 cache the calendar, Gmail and ledger reads
    missing_eval.py candidates DAY [DAY ...] what a labeler reads to judge a day
    missing_eval.py run --split dev|sealed   the walk as of each day, scored
    missing_eval.py run --split all --show   every finding with its verdict

THE REPLAY. For a day D the graph is rebuilt as it stood at D 08:00: chat.db
read only with nothing after that moment (osgraph_ingest.imessage's ceiling),
calendar events that existed by then (Google Calendar's own `created`), Gmail
rows up to then, and the ledger as the coursework CLI would have read it then
(a "done" with a submission date after D counts as still open; a "done" with
no date is taken as done on time). The walk is the shipped
osgraph_missing.missing. WhatsApp, bridged chats and the people store's tasks
are not replayed: none of them can be read as of a past moment.

THE RULE, written with the labels and before any tuning (CHW-204):
  A finding is a CATCH when the thing it names was actually missed, known
  after the fact: an assignment handed in late or never, an ask answered a
  day or more late, two commitments with other people at the same time, a
  promise with nothing after it. It is WRONG when what it says was false at
  the time or is not a thing a person would act on: the ask was not an ask,
  the message was automated, an overlap is a block he set for himself, the
  item was already done. It is TRUE-NOT-MISSED when it was right at the time
  but handled in time, and UNKNOWN when nothing on disk says either way
  (a reading the ledger never closed). Only CATCH and WRONG are scored.
  A finding whose keys no label names is judged by hand after the run and
  reported as such, never silently dropped.

Labels and every result live in ~/.chewbacca/evals/missing/ (never in the
repo): they name his contacts and carry his messages' first words.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin" / "lib"))
os.environ.setdefault("KYBER_OS_GRAPH_NO_TM", "1")

import osgraph  # noqa: E402
import osgraph_ingest  # noqa: E402
import osgraph_missing  # noqa: E402
from surfaces import Context  # noqa: E402

HOME = Path.home()
EVAL_DIR = Path(os.environ.get("MISSING_EVAL_DIR") or HOME / ".chewbacca" / "evals" / "missing")
CHAT_DB = Path(os.environ.get("KYBER_SURFACES_CHAT_DB") or HOME / "Library" / "Messages" / "chat.db")
APPLE_EPOCH = datetime(2001, 1, 1, tzinfo=timezone.utc)
# The morning view: the question is asked before the day starts.
AS_OF = time(8, 0)
LEDGER_JS = r"""
const fs = require("fs"), Module = require("module"), path = require("path");
const file = process.argv[1];
const src = fs.readFileSync(file, "utf8").replace(/^#!.*\n/, "").replace(/\nmain\(\);\s*$/, "\nmodule.exports = { loadLedger };\n");
const m = new Module(file); m.paths = Module._nodeModulePaths(path.dirname(file)); m._compile(src, file);
const out = [];
for (const c of m.exports.loadLedger().courses)
  for (const d of c.deliverables || c.assignments || [])
    if (d && typeof d === "object")
      out.push({course: c.code || c.title, name: d.name, due: d.due ? String(d.due).slice(0, 10) : null,
                at: d.at || null, type: d.type || "assignment", status: d.status || "todo",
                notes: [d.notes, d.notes_done, d.excused].filter(Boolean).join(" | ")});
console.log(JSON.stringify(out));
"""
# The coursework CLI's two-day window (bin/coursework GRACE_DAYS).
GRACE_DAYS = 2


def moment(day: date) -> datetime:
    return datetime.combine(day, AS_OF).astimezone()


def apple(at: datetime) -> int:
    return int((at - APPLE_EPOCH).total_seconds() * 1e9)


def from_apple(ns: int) -> datetime:
    return (APPLE_EPOCH + timedelta(seconds=(ns or 0) / 1e9)).astimezone()


def short(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:8]


def first_word(text: str) -> str:
    words = str(text or "").split()
    return words[0] if words else ""


# ── snapshot: the three reads that cannot be replayed live ──────────────


def snapshot(start: str, end: str) -> None:
    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(EVAL_DIR, 0o700)
    cals = json.loads(subprocess.run(["gws", "calendar", "calendarList", "list"], capture_output=True, text=True,
                                     timeout=60).stdout)["items"]
    events = []
    for cal in cals:
        if "holiday" in cal["id"]:
            continue
        params = {"calendarId": cal["id"], "timeMin": f"{start}T00:00:00Z", "timeMax": f"{end}T00:00:00Z",
                  "singleEvents": True, "orderBy": "startTime", "maxResults": 2500}
        out = subprocess.run(["gws", "calendar", "events", "list", "--params", json.dumps(params)],
                             capture_output=True, text=True, timeout=120).stdout
        try:
            items = json.loads(out).get("items", [])
        except ValueError:
            print(f"calendar {short(cal['id'])}: unreadable, skipped", file=sys.stderr)
            continue
        for e in items:
            e["_calendar"] = cal.get("summary", "")
        events += items
    (EVAL_DIR / "events.json").write_text(json.dumps(events))
    gmail = subprocess.run(["python3", str(ROOT / "mac" / "lib" / "gmail.py"), "--json", "--days", "45"],
                           capture_output=True, text=True, timeout=600).stdout
    (EVAL_DIR / "gmail.json").write_text(gmail or "[]")
    ledger = subprocess.run(["node", "-e", LEDGER_JS, str(ROOT / "bin" / "coursework")], capture_output=True,
                            text=True, timeout=60).stdout
    (EVAL_DIR / "ledger.json").write_text(ledger or "[]")
    print(f"{len(events)} events, {len(json.loads(gmail or '[]'))} mail rows, "
          f"{len(json.loads(ledger or '[]'))} ledger rows in {EVAL_DIR}")


def load(name: str):
    return json.loads((EVAL_DIR / name).read_text())


# ── as-of views of the cached reads ──────────────────────────────────────


def done_on(row: dict) -> date | None:
    """The day the ledger stopped calling a "done" item open, if its notes
    say: "SUBMITTED 2026-10-03", "POSTED 2026-10-03", "Confirmed done by Caleb
    2026-09-20", "Caleb 2026-10-03: excused". Before that day the coursework
    CLI read it as todo, which is what the live walk would have seen. A done
    item with no date is taken as done on time (nothing says otherwise)."""
    import re  # noqa: PLC0415
    pairs = re.findall(
        r"(?i)(?:submitted|posted|confirmed done by caleb) (\d{4}-\d{2}-\d{2})|caleb (\d{4}-\d{2}-\d{2}): excused",
        row.get("notes") or "")
    found = [date.fromisoformat(stamp) for pair in pairs for stamp in pair if stamp]
    return min(found) if found else None


def ledger_as_of(rows: list, now: datetime, days: int = 14) -> dict:
    today = now.date()
    overdue, upcoming = [], []
    for r in rows:
        if not r.get("due"):
            continue
        due = date.fromisoformat(r["due"])
        status = r.get("status") or "todo"
        flipped = done_on(r)
        if status == "done" and flipped is not None and flipped >= today:
            status = "todo"  # the ledger still said open this morning
        if status != "todo" or (today - due).days > GRACE_DAYS:
            continue
        row = {"course": r["course"], "name": r["name"], "date": r["due"], "at": r.get("at"), "type": r["type"],
               "status": "todo"}
        if due < today:
            overdue.append(row)
        elif (due - today).days <= days:
            upcoming.append(row)
    return {"overdue": overdue, "upcoming": upcoming, "undated": []}


def mac_event(e: dict) -> dict:
    s, en = e.get("start", {}), e.get("end", {})
    return {"id": e.get("id", ""), "title": e.get("summary") or "(no title)",
            "start": s.get("dateTime") or s.get("date"), "end": en.get("dateTime") or en.get("date"),
            "isAllDay": "date" in s and "dateTime" not in s, "calendar": e.get("_calendar", ""),
            "attendees": [{"email": a.get("email", ""), "self": bool(a.get("self"))} for a in e.get("attendees") or []]}


def calendar_as_of(events: list, now: datetime, start: date, end: date) -> list:
    out = []
    for e in events:
        if e.get("status") == "cancelled":
            continue
        created = osgraph_ingest.osgraph_time(e.get("created"))
        if created is not None and created > now:
            continue
        row = mac_event(e)
        when = osgraph_ingest.osgraph_time(row["start"]) if "T" in str(row["start"]) else datetime.combine(
            date.fromisoformat(str(row["start"])[:10]), time(0)).astimezone()
        if when is None or not (start <= when.date() <= end):
            continue
        out.append(row)
    return out


class Replay:
    """Stands in for every CLI the ingesters call, answering as of `now`."""

    def __init__(self, now: datetime):
        self.now = now
        self.ledger = load("ledger.json")
        self.events = load("events.json")
        self.gmail = load("gmail.json")

    def __call__(self, argv):
        argv = [str(a) for a in argv]
        if argv[:2] == ["coursework", "due"]:
            return 0, json.dumps(ledger_as_of(self.ledger, self.now)), ""
        if argv[:3] == ["mac", "calendar", "list"]:
            frm = date.fromisoformat(argv[argv.index("--from") + 1])
            to = date.fromisoformat(argv[argv.index("--to") + 1])
            return 0, json.dumps(calendar_as_of(self.events, self.now, frm, to)), ""
        if len(argv) > 1 and Path(argv[1]).name == "gmail.py":
            return 0, json.dumps(self.gmail), ""
        return 1, "", f"not replayed: {argv[0]}"


def graph_for(day: date) -> tuple[osgraph.Graph, datetime, dict]:
    now = moment(day)
    ctx = Context(run=Replay(now), now=lambda: now, home=HOME, sleep=lambda s: None,
                  env={"KYBER_SURFACES_CHAT_DB": str(CHAT_DB), "KYBER_SURFACES_BACKLOG": ""})
    ctx.graph = osgraph.Graph(":memory:")
    ctx.ids = osgraph.Identities()
    report = osgraph_ingest.ingest_all(ctx.graph, ctx, days=7, ids=ctx.ids,
                                       only=["imessage", "mail", "coursework", "calendar"])
    return ctx.graph, now, report


# ── keys: what a finding names, in the labels' words ────────────────────


def keys_of(g: osgraph.Graph, row: dict) -> list[str]:
    node = g.node(row["id"]) or {"props": {}, "type": "", "id": row["id"]}
    target = g.node(row["target"]) if not str(row["target"]).startswith("day:") else None
    out = []

    def of(n):
        if not n:
            return None
        p = n.get("props") or {}
        if n["type"] == "Assignment":
            return f"assignment:{p.get('course', '')}|{p.get('name', '')}"
        if n["type"] == "Thread":
            return "thread:" + short(n["id"].removeprefix("thread:imessage:"))
        if n["type"] == "MailItem":
            return "mail:" + short(n["id"])
        if n["type"] == "Event":
            return "event:" + short(str(p.get("start", "")) + "|" + n["label"])
        if n["type"] == "Message":
            return "message:" + short(n["id"])
        if n["type"] == "Task":
            return "promise:" + short(n["id"])
        return None

    kind = row["kind"]
    if kind == "conflict":
        out.append("conflict:" + "|".join(sorted(filter(None, [of(node), of(target)]))))
    elif kind == "blocked" and node["type"] == "Event":
        out += [k for k in (of(target), "meeting:" + (of(node) or "")) if k]
    elif kind == "blocked":
        out += [k for k in (of(target),) if k]
    else:
        out += [k for k in (of(node),) if k]
    return out


# ── candidates: what the labeler reads ───────────────────────────────────


def candidates(day: date) -> dict:
    """Everything on and around `day` that could be a miss, from rules much
    wider than the walk's, with what happened after. For the labeler only."""
    now = moment(day)
    ids = osgraph.Identities()
    out: dict = {"day": day.isoformat(), "ledger": [], "threads": [], "overlaps": [], "promises": [], "groups": []}
    for r in load("ledger.json"):
        if r.get("due") and -GRACE_DAYS <= (date.fromisoformat(r["due"]) - day).days <= 3:
            out["ledger"].append({"key": f"assignment:{r['course']}|{r['name']}", "due": r["due"], "at": r.get("at"),
                                  "type": r["type"], "status_now": r["status"],
                                  "landed": str(done_on(r) or ""), "notes": (r.get("notes") or "")[:160]})
    db = sqlite3.connect(f"file:{CHAT_DB}?mode=ro", uri=True, timeout=5)
    try:
        floor, ceil = apple(now - timedelta(days=7)), apple(now)
        chats: dict[str, list] = {}
        for rowid, ident, style in db.execute(
                "SELECT c.ROWID, c.chat_identifier, c.style FROM chat c JOIN chat_message_join j ON j.chat_id=c.ROWID "
                "JOIN message m ON m.ROWID=j.message_id WHERE m.date > ? AND m.date <= ? GROUP BY c.ROWID",
                (floor, ceil)):
            chats.setdefault(ident, []).append((rowid, style))
        for ident, rows in chats.items():
            marks = ",".join("?" * len(rows))
            group = any(s == osgraph_ingest.STYLE_GROUP for _, s in rows)
            msgs = db.execute(
                f"SELECT m.guid, m.text, m.attributedBody, m.is_from_me, m.date FROM message m "
                f"JOIN chat_message_join j ON j.message_id=m.ROWID WHERE j.chat_id IN ({marks}) AND m.item_type=0 "
                f"AND m.associated_message_type=0 AND m.date > ? ORDER BY m.date",
                [r for r, _ in rows] + [floor]).fetchall()
            before = [m for m in msgs if m[4] <= ceil]
            after = [m for m in msgs if m[4] > ceil]
            who = ids.people.get(ids.resolve(ident) or "", {}).get("name", "") if not group else "(group)"
            if not group and before and not before[-1][3]:
                burst = []
                for m in reversed(before):
                    if m[3]:
                        break
                    burst.append(osgraph_ingest.body_text(m[1], m[2]))
                waited = (now - from_apple(before[-1][4])).total_seconds() / 3600
                reply = next((m for m in after if m[3]), None)
                out["threads"].append({
                    "key": "thread:" + short(ident), "who": first_word(who) or "(unsaved)", "saved": bool(who),
                    "waited_h": round(waited, 1), "burst": [b[:110] for b in reversed(burst)][-3:],
                    "replied_after_h": round((from_apple(reply[4]) - from_apple(before[-1][4])).total_seconds() / 3600, 1)
                    if reply else None})
            for m in before:
                text = osgraph_ingest.body_text(m[1], m[2])
                at = from_apple(m[4])
                low = text.lower().replace("\u2019", "'")
                if m[3] and any(w in low for w in ("i'll", "ill ", "i will", "imma", "ima ", "gonna", "will ")) \
                        and osgraph_missing.DAY_RE.search(text) and len(text) <= 240:
                    nxt = [x for x in msgs if x[4] > m[4] and x[3]][:2]
                    out["promises"].append({
                        "key": "promise:" + short(f"task:imessage:promise:{m[0]}"), "who": first_word(who),
                        "at": at.isoformat(timespec="minutes"), "text": text[:110],
                        "next_from_me": [(from_apple(x[4]).isoformat(timespec="minutes"),
                                          osgraph_ingest.body_text(x[1], x[2])[:60]) for x in nxt]})
                if group and not m[3] and osgraph_missing.CLOCK.search(text) and osgraph_missing.DAY_RE.search(text) \
                        and len(text) <= 240:
                    out["groups"].append({"key": "message:" + short(f"message:imessage:{m[0]}"),
                                          "at": at.isoformat(timespec="minutes"), "text": text[:120]})
    finally:
        db.close()
    rows = calendar_as_of(load("events.json"), now, day, day + timedelta(days=3))
    timed = []
    for r in rows:
        if r["isAllDay"]:
            continue
        s, e = osgraph_ingest.osgraph_time(r["start"]), osgraph_ingest.osgraph_time(r["end"])
        if s and e:
            timed.append((s, e, r))
    timed.sort(key=lambda x: x[0])
    for i, (s1, e1, a) in enumerate(timed):
        for s2, e2, b in timed[i + 1:]:
            if s2 >= e1:
                break
            ka = "event:" + short(s1.isoformat() + "|" + osgraph_ingest.clip(a["title"], 80))
            kb = "event:" + short(s2.isoformat() + "|" + osgraph_ingest.clip(b["title"], 80))
            out["overlaps"].append({"key": "conflict:" + "|".join(sorted([ka, kb])),
                                    "a": a["title"][:40], "b": b["title"][:40], "at": s1.isoformat(timespec="minutes"),
                                    "others": [osgraph_ingest.others_on(a, set()), osgraph_ingest.others_on(b, set())]})
    return out


# ── run and score ────────────────────────────────────────────────────────


def score(split: str, show: bool) -> dict:
    labels = load("labels.json")
    days = [d for d, s in labels["split"].items() if split == "all" or s == split]
    total = {"days": 0, "days_caught": 0, "catch": 0, "wrong": 0, "true_not_missed": 0, "unknown": 0,
             "unlabeled": 0, "judged_after": 0, "days_wrong": 0, "findings": 0}
    examples = []
    for d in sorted(days):
        g, now, report = graph_for(date.fromisoformat(d))
        errors = {k: v["error"] for k, v in report.items() if isinstance(v, dict) and v.get("error")}
        result = osgraph_missing.missing(g, now)
        verdicts = labels["days"].get(d, {})
        later = labels.get("posthoc", {}).get(d, {})
        caught, wrong = 0, 0
        for r in result["rows"]:
            ks = keys_of(g, r)
            verdict, posthoc = "unlabeled", False
            for want in ("catch", "wrong", "true_not_missed", "unknown"):
                if any(k in verdicts.get(want, []) for k in ks):
                    verdict = want
                    break
            if verdict == "unlabeled":
                for want in ("catch", "wrong", "true_not_missed", "unknown"):
                    if any(k in later.get(want, []) for k in ks):
                        verdict, posthoc = want, True
                        break
            total["judged_after"] += posthoc
            total[verdict] += 1
            total["findings"] += 1
            caught += verdict == "catch"
            wrong += verdict == "wrong"
            examples.append({"day": d, "kind": r["kind"], "verdict": verdict, "first_word": first_word(r["label"]),
                             "provenance_kind": r["provenance"].split(",")[0], "confidence": r["confidence"],
                             "keys": ks})
            if show:
                print(f"{d} {verdict:16} {r['kind']:9} {r['confidence']:.2f} {first_word(r['label']):14} "
                      f"{r['provenance'][:70]}  {ks}")
        total["days"] += 1
        total["days_caught"] += caught > 0
        total["days_wrong"] += wrong > 0
        if errors:
            print(f"{d} source errors: {errors}", file=sys.stderr)
    scored = total["catch"] + total["wrong"]
    total["precision"] = round(total["catch"] / scored, 3) if scored else None
    out = {"split": split, **total, "at": datetime.now().astimezone().isoformat(timespec="seconds")}
    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    with (EVAL_DIR / "runs.jsonl").open("a") as f:
        f.write(json.dumps({**out, "examples": examples}) + "\n")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("snapshot")
    s.add_argument("--from", dest="start", default="2026-09-01")
    s.add_argument("--to", dest="end", default=date.today().isoformat())
    c = sub.add_parser("candidates")
    c.add_argument("days", nargs="+")
    r = sub.add_parser("run")
    r.add_argument("--split", choices=("dev", "sealed", "all"), required=True)
    r.add_argument("--show", action="store_true")
    a = ap.parse_args()
    if a.cmd == "snapshot":
        snapshot(a.start, a.end)
    elif a.cmd == "candidates":
        for d in a.days:
            print(json.dumps(candidates(date.fromisoformat(d)), ensure_ascii=False, indent=1))
    else:
        print(json.dumps(score(a.split, a.show), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
