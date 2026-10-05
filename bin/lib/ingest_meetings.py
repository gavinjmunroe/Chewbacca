"""Meetings, read through Anarlog's CLI, as rows for the surface and facts for the OS graph.

Anarlog (MIT, github.com/fastrepl/anarlog) records the mic and the system
audio on this Mac, transcribes on device and keeps every meeting in its own
SQLite. It replaces Granola, whose cache is encrypted to Granola-signed code
(memory, reference_granola_live_transcript). This file never opens that
SQLite: Anarlog's own agent skill says "Never query or modify Anarlog's
SQLite database directly. The CLI and MCP servers handle application-schema
compatibility" (skills/anarlog/SKILL.md, read 2026-10-05 at 36715cc). Every
read is `anarlog --json`, and only reads are ever run: doctor, meetings list,
meetings get, meetings transcript. Proposals, export and auth are never called.

THE JSON SHAPES, from the CLI source at fastrepl/anarlog@36715cc, 2026-10-05:

- every success is {"schema_version": "1", "command", "data", "pagination"?}
  on stdout (apps/cli/src/output.rs:11-31)
- every failure is {"schema_version": "1", "error": {"code", "message",
  "exit_code"}} on stderr (apps/cli/src/error.rs:70-80, main.rs:58-64), with
  exit 2 not_found, 3 database_not_found, 1 otherwise (error.rs:50-58)
- `doctor` prints {"cli_version", "ready", "database": {"path", "exists",
  "opened_read_only", "schema_ready", "error"}} and exits 1 when ready is
  false (apps/cli/src/commands/doctor.rs:7-21, 62-66)
- `meetings list` data is a list of {"id", "title", "kind", "status",
  "created_at", "updated_at", "started_at", "ended_at", "series_id",
  "folder_path"} (crates/agent-access/src/lib.rs:130-143), newest first by
  started_at then created_at (crates/db-app/src/session_ops.rs:102)
- `meetings get` data adds "timezone", "language", "note", "summaries" (a
  Document: id, kind, template_id, title, markdown, sort_order, created_at,
  updated_at), "participants" (human_id, display_name, email, role,
  job_title, organization_id, organization_name) and "action_items" (id,
  assignee_human_id, status, text, due_at, completed_at)
  (crates/agent-access/src/lib.rs:188-251)
- `meetings transcript` data is {"meeting_id", "text", "words"} with a
  pagination block, 200 words by default and 500 at most
  (apps/cli/src/commands/meetings.rs:193-213, agent-access lib.rs:20-21)

Measured live on 2026-10-05 against Caleb's freshly launched Anarlog 1.4.28:
doctor said ready with an empty database, and `meetings list` returned
"data": [] with next_offset null. A missing database answered exit 3 with
code database_not_found. tests/fixtures/anarlog holds those answers verbatim.

PRIVACY. Two switches are set on every call, because both are read from the
environment the daemon inherits. `--source local`: the CLI's source flag
falls back to ANARLOG_SOURCE (apps/cli/src/cli.rs:89), and "cloud" there
would read hosted snapshots instead of this Mac. `ANARLOG_ANALYTICS=0`: the
CLI posts a command-completed event to PostHog and errors to Sentry only when
that variable says 1, true or yes (apps/cli/src/analytics.rs:68-72,
error_reporting.rs:4-7); it is opt-in today, and pinning it off keeps a
stray export in a shell profile from turning it on under the daemon.

Meeting content is someone else's words and is untrusted: control, format
and bidi characters are stripped before anything reaches a label, nothing
here reads it for instructions, and nothing here sends it anywhere.

WHAT GOES IN THE GRAPH. An Event per meeting in the retention window
(osgraph.RETENTION_DAYS, the same 7 days messages get), Persons for
attendees with an email, fused only through the people store's identities,
ATTENDS from each, and a Task per open action item, EXTRACTED_FROM its
meeting. Anarlog writes action items with its own model, so every one is a
guess: kind "meeting-action", "guess": True, confidence GUESS_CONFIDENCE, and
it does not reach the tasks lanes or the Docket until the person presses
"Add to tasks", which writes a separate promoted Task (PROMOTED_SOURCE).
The summary is kept as one SNIPPET_CHARS line on the Event, and only while
the meeting is inside the window; the transcript is never stored.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path

import osgraph
from osgraph import ME, Graph, Identities, Node, day_node, me_node, person_node, space_node

SOURCE = "meetings"
# Promoted action items live under their own source, so the meetings
# snapshot (which replaces everything it wrote on every pass) can never drop
# a task the person chose to keep, and `kyber-surfaces forget` still clears
# them because they are graph rows.
PROMOTED_SOURCE = "meetings-promoted"
APP = "Anarlog"
# Anarlog's own list default (crates/agent-access/src/lib.rs:18). A week of
# Caleb's calls has never been measured; if the oldest meeting in the window
# is missing, this is the number to raise (the CLI allows 200).
MOST_MEETINGS = 20
# Anarlog's own transcript page default; the CLI caps a page at 500 words
# (crates/agent-access/src/lib.rs:20-21) and its skill says to keep pages
# bounded.
TRANSCRIPT_WORDS = 200
# An action item Anarlog's model wrote is a guess. Lower than the 0.6 an
# iMessage request gets, because a text request at least quotes the person
# asking, and this is a model's paraphrase of a call. Guessed, never measured:
# no meeting had been recorded on this Mac on 2026-10-05.
GUESS_CONFIDENCE = 0.5
# Statuses an action item stops being owed at. Anarlog's own markdown export
# checks the box for exactly these two (crates/agent-access/src/lib.rs:619).
DONE_STATUSES = {"done", "completed"}
# A meeting with a start and no end that began within this many hours is
# shown as recording now. Anarlog's list has no recording flag, only
# started_at and ended_at (lib.rs:130-143). Guessed, never measured: a call
# longer than this, or a session Anarlog never closed, reads as finished.
LIVE_HOURS = 4
# Every id the CLI hands out is passed back as one argv element after `--`;
# this keeps a value that is not an id from reaching it at all. Anarlog's ids
# are UUID-like strings in its own tests ("meeting-1", "action-1"); never
# measured on a real meeting.
MEETING_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
# Unicode categories that never reach the glass: controls (Cc), format (Cf,
# where the bidi overrides live), surrogates, private use, unassigned, and
# the line and paragraph separators Python's splitlines breaks on.
STRIP = {"Cc", "Cf", "Cs", "Co", "Cn", "Zl", "Zp"}
# Zero-width joiner stays, or every multi-person emoji falls apart (the same
# exception ingest_whatsapp.py makes).
KEEP = {"\u200d"}
# Every character Python's splitlines ends a line at becomes a space, so the
# words on either side of one never run together.
BREAKS = set("\n\r\t\v\f\x1c\x1d\x1e\x85\u2028\u2029")

NOT_INSTALLED = "Anarlog isn't installed on this Mac."
NOT_SET_UP = "Anarlog hasn't made its database yet."


class AnarlogError(Exception):
    """The CLI answered with an error, or not at all. `code` is Anarlog's own
    machine code (not_found, database_not_found, ...) or "not_installed"."""

    def __init__(self, message: str, code: str = ""):
        super().__init__(message)
        self.code = code


def clean(text, limit: int | None = None) -> str:
    """Someone else's words, safe to draw on one line."""
    out = []
    for ch in str(text or ""):
        if ch in BREAKS:
            out.append(" ")
        elif ch in KEEP or unicodedata.category(ch) not in STRIP:
            out.append(ch)
    words = " ".join("".join(out).split())
    if limit is not None and len(words) > limit:
        return words[: limit - 1].rstrip() + "…"
    return words


def anarlog_bin(env: dict | None = None, home: Path | None = None) -> str:
    """The CLI to run. launchd hands its children a minimal PATH (memory,
    feedback_launchd_minimal_path_breaks_children), so the two places Anarlog
    puts it are tried by full path. Never Contents/MacOS/anarlog: that is the
    desktop app itself, and running it would open a window."""
    env = env or {}
    if env.get("KYBER_ANARLOG"):
        return env["KYBER_ANARLOG"]
    found = shutil.which("anarlog", path=env.get("PATH"))
    if found:
        return found
    home = Path(home or Path.home())
    for candidate in (home / ".local" / "bin" / "anarlog",
                      Path("/Applications/Anarlog.app/Contents/MacOS/anarlog-cli")):
        if candidate.exists():
            return str(candidate)
    return "anarlog"


def argv(ctx, *args: str) -> list[str]:
    """One read. `env` pins telemetry off for this child only; `--json` is a
    global flag, so it goes before the command."""
    return ["/usr/bin/env", "ANARLOG_ANALYTICS=0",
            anarlog_bin(getattr(ctx, "env", None), getattr(ctx, "home", None)), "--json", *args]


def parse(code: int, out: str, err: str, what: str, allow_codes: tuple = (0,)):
    """The whole JSON answer, or AnarlogError in words."""
    body = None
    for text in (out, err):
        try:
            body = json.loads(text or "")
            break
        except json.JSONDecodeError:
            continue
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        e = body["error"]
        raise AnarlogError(f"{what}: {clean(e.get('message'), 140) or 'failed'}", str(e.get("code") or ""))
    if code == 127:
        raise AnarlogError(NOT_INSTALLED, "not_installed")
    if code == 124:
        raise AnarlogError(f"{what}: Anarlog took too long to answer", "timeout")
    if isinstance(body, dict) and "data" in body and code in allow_codes:
        return body
    first = clean((err or out or "no output").splitlines()[0] if (err or out) else "no output", 120)
    raise AnarlogError(f"{what} failed: {first}", "operation_failed")


def call(ctx, what: str, *args: str, allow_codes: tuple = (0,)) -> dict:
    code, out, err = ctx.run(argv(ctx, *args))
    return parse(code, out, err, what, allow_codes)


def doctor(ctx) -> dict:
    """Anarlog's own readiness report. Exit 1 with ready:false is an answer,
    not a failure (doctor.rs:23-31 prints it, then main exits 1)."""
    body = call(ctx, "Anarlog doctor", "doctor", allow_codes=(0, 1))
    data = body.get("data")
    if not isinstance(data, dict):
        raise AnarlogError("Anarlog doctor answered with something that is not a report", "operation_failed")
    db = data.get("database") if isinstance(data.get("database"), dict) else {}
    return {"ready": bool(data.get("ready")), "version": clean(data.get("cli_version"), 20),
            "path": str(db.get("path") or ""), "exists": bool(db.get("exists")),
            "schema_ready": bool(db.get("schema_ready")), "error": clean(db.get("error"), 120)}


def list_meetings(ctx, limit: int = MOST_MEETINGS) -> list[dict]:
    body = call(ctx, "Anarlog meetings", "meetings", "--source", "local", "list", "--limit", str(limit),
                "--offset", "0")
    rows = body.get("data")
    return [m for m in rows if isinstance(m, dict) and MEETING_ID.match(str(m.get("id") or ""))] \
        if isinstance(rows, list) else []


def get_meeting(ctx, meeting_id: str) -> dict:
    if not MEETING_ID.match(meeting_id or ""):
        raise AnarlogError("That isn't an Anarlog meeting id", "invalid")
    data = call(ctx, "Anarlog meeting", "meetings", "--source", "local", "get", "--", meeting_id).get("data")
    if not isinstance(data, dict):
        raise AnarlogError("Anarlog answered with something that is not a meeting", "operation_failed")
    return data


def transcript_page(ctx, meeting_id: str, offset: int = 0, limit: int = TRANSCRIPT_WORDS) -> dict:
    """One bounded page: its words as one cleaned line, where it starts, how
    many words came back, and where the next page starts (None at the end)."""
    if not MEETING_ID.match(meeting_id or ""):
        raise AnarlogError("That isn't an Anarlog meeting id", "invalid")
    offset = max(0, int(offset))
    body = call(ctx, "Anarlog transcript", "meetings", "--source", "local", "transcript", "--limit",
                str(limit), "--offset", str(offset), "--", meeting_id)
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    page = body.get("pagination") if isinstance(body.get("pagination"), dict) else {}
    nxt = page.get("next_offset")
    return {"meeting_id": meeting_id, "offset": offset, "text": clean(data.get("text")),
            "returned": int(page.get("returned") or 0),
            "next": nxt if isinstance(nxt, int) and not isinstance(nxt, bool) and nxt > offset else None}


def when(stamp) -> datetime | None:
    """An Anarlog time ("2026-07-13T09:00:00Z", "...:00.123Z", or a bare
    date in its own tests). A naive one is read as UTC, as osgraph_ingest
    reads every other source."""
    if not isinstance(stamp, str) or not stamp.strip():
        return None
    try:
        moment = datetime.fromisoformat(stamp.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone()


def due_day(stamp) -> str:
    """The day an action item is due, as written. Anarlog's own test writes
    due_at as "2026-07-20" (crates/agent-access/src/lib.rs:1133); converting
    a midnight-UTC stamp to Pacific time moved it to the day before, so the
    date part is read as written and never shifted."""
    text = str(stamp or "").strip()[:10]
    return text if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text) else ""


def started(meeting: dict) -> datetime | None:
    """When it happened: started_at, else created_at, the CLI's own rule
    (apps/cli/src/commands/meetings.rs:284-288)."""
    return when(meeting.get("started_at")) or when(meeting.get("created_at"))


def is_live(meeting: dict, now: datetime) -> bool:
    start = when(meeting.get("started_at"))
    return (start is not None and not str(meeting.get("ended_at") or "").strip()
            and timedelta(0) <= now - start <= timedelta(hours=LIVE_HOURS))


def open_items(meeting: dict) -> list[dict]:
    items = meeting.get("action_items") if isinstance(meeting.get("action_items"), list) else []
    return [i for i in items if isinstance(i, dict) and clean(i.get("text"))
            and str(i.get("status") or "").lower() not in DONE_STATUSES and not i.get("completed_at")]


def participants(meeting: dict) -> list[dict]:
    rows = meeting.get("participants") if isinstance(meeting.get("participants"), list) else []
    return [p for p in rows if isinstance(p, dict)]


ME_FILE = Path(os.environ.get("KYBER_MEETINGS_ME_FILE") or Path.home() / ".chewbacca" / "meetings.json")


def me_emails(env: dict | None) -> set[str]:
    """The owner's own addresses, from KYBER_MEETINGS_ME (comma separated).
    Anarlog's get has no is_self on a participant (only its export does,
    lib.rs:286-291), and the people store does not hold the owner, so an
    action item assigned to the owner is only known through this."""
    raw = (env or {}).get("KYBER_MEETINGS_ME") or ""
    if not raw:
        # The daemon runs under launchd with a minimal environment, so the
        # addresses also live in a private file the owner keeps.
        try:
            raw = ",".join(json.loads(ME_FILE.read_text()).get("me", []))
        except (OSError, ValueError, AttributeError, TypeError):
            raw = ""
    return {k for k in (osgraph.email_key(x) for x in raw.split(",")) if k}


# Confidence for an attendee taken from an invite: a claim, not an observation.
# Guessed, never measured; it only has to sit below the walks' fact threshold.
CLAIMED_CONFIDENCE = 0.5


def attendee_node(ids: Identities, participant: dict, mine: set[str]) -> Node | None:
    """The Person an attendee is, by email only. No email, no node: a display
    name is whatever the calendar or the other side typed, and "Tyler" is two
    people in this store (memory, feedback_resolve_identity_before_writing)."""
    email = str(participant.get("email") or "").strip()
    # The address becomes a Person label, so one carrying a control or format
    # character (ESC and BEL seen in review, 2026-10-05) is not an address.
    if not email.isprintable():
        return None
    key = osgraph.email_key(email)
    if not key:
        return None
    if key in mine:
        return me_node()
    return person_node(ids, email, source_hint=SOURCE)


def summary_text(meeting: dict) -> str:
    """The first non-empty summary's markdown, else the note's."""
    for doc in meeting.get("summaries") or []:
        if isinstance(doc, dict) and str(doc.get("markdown") or "").strip():
            return str(doc["markdown"])
    note = meeting.get("note")
    if isinstance(note, dict) and str(note.get("markdown") or "").strip():
        return str(note["markdown"])
    return ""


MARKDOWN_LEAD = re.compile(r"^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,3}[.)]\s+|>\s*)")
MARKDOWN_LINK = re.compile(r"\[([^\]]*)\]\((https?://[^)\s]+)\)")


def plain_line(raw: str) -> str:
    """One markdown line as words: list and heading marks off, bold marks
    off, a link shown as its text."""
    line = MARKDOWN_LEAD.sub("", raw)
    line = MARKDOWN_LINK.sub(lambda m: m.group(1) or m.group(2), line)
    line = line.replace("**", "").replace("__", "")
    return clean(line)


def sections(markdown: str) -> list[tuple[str, list[str]]]:
    """(heading, lines) pairs, in order; text before any heading is under ""."""
    out: list[tuple[str, list[str]]] = [("", [])]
    for raw in str(markdown or "").splitlines():
        if re.match(r"^\s*#{1,6}\s+", raw):
            out.append((plain_line(raw), []))
        else:
            line = plain_line(raw)
            if line:
                out[-1][1].append(line)
    return [(h, lines) for h, lines in out if h or lines]


def decisions(meeting: dict) -> list[str]:
    """Lines under a heading that says "decision", from the summaries and the
    note. Anarlog has no decisions field, so this is only ever what its own
    summary put under that heading; nothing is inferred."""
    docs = [d for d in (meeting.get("summaries") or []) if isinstance(d, dict)]
    if isinstance(meeting.get("note"), dict):
        docs.append(meeting["note"])
    found: list[str] = []
    for doc in docs:
        for heading, lines in sections(doc.get("markdown")):
            if "decision" in heading.lower():
                found.extend(lines)
    return found


def snippet(meeting: dict) -> str:
    """The summary as one SNIPPET_CHARS line, decisions heading and all."""
    text = " ".join(line for _, lines in sections(summary_text(meeting)) for line in lines)
    return clean(text, osgraph.SNIPPET_CHARS)


def event_id(meeting_id: str) -> str:
    return osgraph.node_key("event", SOURCE, meeting_id)


def task_id(meeting_id: str, item_id: str) -> str:
    return osgraph.node_key("task", SOURCE, meeting_id, item_id)


def promoted_id(meeting_id: str, item_id: str) -> str:
    return osgraph.node_key("task", PROMOTED_SOURCE, meeting_id, item_id)


def promoted(graph: Graph | None) -> dict[str, dict]:
    """Every promoted task in the graph, by the guess task id it came from."""
    if graph is None:
        return {}
    out = {}
    for row in graph.query("SELECT id, props FROM nodes WHERE source = ? AND type = 'Task'", (PROMOTED_SOURCE,)):
        props = json.loads(row["props"] or "{}")
        if props.get("from_task"):
            out[props["from_task"]] = {"id": row["id"], **props}
    return out


def event_node(meeting: dict, now: datetime, days: int, keep_snippet: bool = True) -> Node:
    start = started(meeting)
    inside = start is not None and start >= now - timedelta(days=min(days, osgraph.RETENTION_DAYS))
    props = {"start": start.isoformat() if start else "", "end": str(meeting.get("ended_at") or ""),
             "all_day": False, "app": APP, "meeting_id": str(meeting.get("id")),
             "folder": clean(meeting.get("folder_path"), 60), "live": is_live(meeting, now)}
    if keep_snippet and inside:
        props["summary"] = snippet(meeting)
    return Node(event_id(str(meeting["id"])), "Event", clean(meeting.get("title"), 80) or "Untitled meeting",
                props, observed_at=start.isoformat() if start else "")


def build(details: list[dict], ids: Identities, now: datetime, days: int = osgraph.RETENTION_DAYS,
          keep: dict[str, dict] | None = None, mine: set[str] | None = None, mapping: dict | None = None):
    """The meetings snapshot, from meetings already read through the CLI.
    Pure: no CLI, no graph. `keep` is promoted() (whose meetings stay as bare
    Events after they leave the window, so EXTRACTED_FROM keeps holding)."""
    from osgraph_ingest import SPACE_BY_COMPANY, Snapshot, space_for  # noqa: PLC0415  heavy module

    keep = keep or {}
    mine = mine or set()
    window = min(days, osgraph.RETENTION_DAYS)
    floor = now - timedelta(days=window)
    snap = Snapshot()
    me = snap.add(me_node())
    seen_meetings = set()
    for meeting in details:
        mid_raw = str(meeting.get("id") or "")
        start = started(meeting)
        if not MEETING_ID.match(mid_raw) or start is None or start < floor:
            continue
        seen_meetings.add(mid_raw)
        eid = snap.add(event_node(meeting, now, days))
        # Recorded on this Mac, so the owner was there. Calendar events are
        # linked the same way (osgraph_ingest.calendar).
        snap.link(me, "ATTENDS", eid)
        by_human: dict[str, Node] = {}
        for p in participants(meeting):
            node = attendee_node(ids, p, mine)
            if node is None:
                continue
            if p.get("human_id"):
                by_human[str(p["human_id"])] = node
            if node.id == ME:
                # The owner is already linked by recording it. An invite that
                # lists the owner's address proves nothing more.
                continue
            pid = snap.add(node)
            # An attendee list is whatever the invite's author typed: anyone
            # can put Sagar's address on an invite (security review,
            # 2026-10-05). The person fusion stands, but "was in this meeting"
            # stays a claim, below the confidence a walk treats as fact.
            snap.link(pid, "ATTENDS", eid, confidence=min(node.confidence, CLAIMED_CONFIDENCE))
        # The space a meeting files under is not picked from a claimed attendee
        # either: one forged address would file a stranger's call under Amber.
        first_known = None
        space = space_for({"props": first_known.props} if first_known else None, mapping or SPACE_BY_COMPANY)
        snap.add(space_node(space))
        snap.link(eid, "BELONGS_TO", f"space:{space}")
        title = clean(meeting.get("title"), 40) or "a meeting"
        for item in open_items(meeting):
            iid = str(item.get("id") or "")
            if not iid:
                continue
            tid = task_id(mid_raw, iid)
            assignee = by_human.get(str(item.get("assignee_human_id") or ""))
            is_kept = tid in keep
            tnode = snap.add(Node(tid, "Task", clean(item.get("text"), 100), {
                "kind": "meeting-action", "status": "ready", "guess": True, "app": APP,
                "promoted": is_kept, "meeting_id": mid_raw, "item_id": iid,
                "item_status": clean(item.get("status"), 20),
                "provenance": f"from {title} {start.strftime('%-I:%M%p').lower()} (Anarlog's guess)",
                "at": start.isoformat()}, confidence=GUESS_CONFIDENCE, observed_at=start.isoformat()))
            snap.link(tnode, "EXTRACTED_FROM", eid)
            snap.link(tnode, "BELONGS_TO", f"space:{space}")
            if assignee is not None:
                # "When the CLI says so": the item names an assignee whose
                # participant row has an email. Still a model's guess.
                snap.link(tnode, "OWED_BY", assignee.id, confidence=min(GUESS_CONFIDENCE, assignee.confidence))
                snap.link(eid, "MENTIONS", assignee.id, confidence=GUESS_CONFIDENCE)
            day = due_day(item.get("due_at"))
            if day:
                snap.add(day_node(day))
                snap.link(tnode, "DUE_ON", f"day:{day}", confidence=GUESS_CONFIDENCE)
    # A promoted task's meeting keeps an Event node after it leaves the
    # window, with no summary, so the promoted EXTRACTED_FROM edge holds.
    for row in keep.values():
        m_id = str(row.get("meeting_id") or "")
        if m_id and m_id not in seen_meetings and MEETING_ID.match(m_id):
            seen_meetings.add(m_id)
            bare = {"id": m_id, "title": row.get("meeting_title") or "", "started_at": row.get("meeting_at") or ""}
            eid = snap.add(event_node(bare, now, days, keep_snippet=False))
            snap.link(me, "ATTENDS", eid)
    return snap


def ingest_details(graph: Graph, details: list[dict], ids: Identities, now: datetime,
                   days: int = osgraph.RETENTION_DAYS, env: dict | None = None) -> dict:
    snap = build(details, ids, now, days, keep=promoted(graph), mine=me_emails(env))
    return snap.write(graph, SOURCE)


def read_details(ctx, days: int, cache: dict | None = None) -> list[dict]:
    """Every listed meeting inside the window, read in full. `cache` maps a
    meeting id to (updated_at, meeting) so an unchanged one is not read again."""
    now = ctx.now()
    floor = now - timedelta(days=min(days, osgraph.RETENTION_DAYS))
    out = []
    for item in list_meetings(ctx):
        start = started(item)
        if start is None or start < floor:
            continue
        key, stamp = str(item["id"]), str(item.get("updated_at") or "")
        hit = (cache or {}).get(key)
        if hit and hit[0] == stamp and stamp:
            out.append(hit[1])
            continue
        meeting = get_meeting(ctx, key)
        if cache is not None:
            cache[key] = (stamp, meeting)
        out.append(meeting)
    return out


def meetings(graph: Graph, ctx, ids: Identities, days: int = 7) -> dict:
    """The INGESTER (osgraph_ingest's signature; registered there as "meetings").
    A Mac where Anarlog was never opened is a note in the report, never an
    error, the same way an unlinked WhatsApp is: an error would sit in the
    caption of every walk surface for as long as it stays unset."""
    try:
        details = read_details(ctx, days)
    except AnarlogError as err:
        if first_run(err):
            return {"nodes": 0, "edges": 0, "ready": False, "note": str(err)}
        raise
    report = ingest_details(graph, details, ids, ctx.now(), days, getattr(ctx, "env", None))
    report["ready"] = True
    return report


def first_run(err: "AnarlogError") -> bool:
    """Anarlog not installed, never opened, or opened but its database not
    built yet. The last one answered "no such table: sessions" in review
    (2026-10-05) and has to read as first run, not as a broken source."""
    return err.code in ("not_installed", "database_not_found") or "no such table" in str(err)


def promote(graph: Graph, meeting: dict, item: dict, now: datetime) -> str:
    """Make one action item the person's own task, in the graph only.

    Writes a Task under PROMOTED_SOURCE: kind "promise" (so the tasks lanes
    show it, and a due day inside 72 hours puts it on the Docket through
    osgraph_walks._attention), OWED_BY the owner, EXTRACTED_FROM the meeting.
    The words are still Anarlog's, so the provenance says so; what the press
    confirmed is that it is a task, not that the model heard it right.
    Nothing outside the graph is touched. Returns the promoted node id."""
    from osgraph_ingest import Snapshot  # noqa: PLC0415

    mid_raw, iid = str(meeting["id"]), str(item["id"])
    guess = task_id(mid_raw, iid)
    eid = event_id(mid_raw)
    start = started(meeting)
    snap = Snapshot()
    snap.add(me_node())
    with graph.lock:
        for row in graph.query("SELECT * FROM nodes WHERE source = ?", (PROMOTED_SOURCE,)):
            if row["type"] == "Task":
                snap.add(Node(row["id"], "Task", row["label"], json.loads(row["props"] or "{}"),
                              row["confidence"], bool(row["unresolved"]), row["observed_at"]))
            elif row["type"] == "Day":
                snap.add(Node(row["id"], "Day", row["label"]))
        alive = graph.types(r["dst"] for r in graph.query("SELECT dst FROM edges WHERE source = ?", (PROMOTED_SOURCE,)))
        for row in graph.query("SELECT * FROM edges WHERE source = ?", (PROMOTED_SOURCE,)):
            if row["src"] in snap.nodes and (row["dst"] in alive or row["dst"] in snap.nodes):
                snap.link(row["src"], row["verb"], row["dst"], props=json.loads(row["props"] or "{}"),
                          confidence=row["confidence"], observed_at=row["observed_at"])
        pid = promoted_id(mid_raw, iid)
        if pid not in snap.nodes:
            title = clean(meeting.get("title"), 40) or "a meeting"
            snap.add(Node(pid, "Task", clean(item.get("text"), 100), {
                "kind": "promise", "status": "ready", "app": APP, "promoted": True, "from_task": guess,
                "meeting_id": mid_raw, "item_id": iid, "meeting_title": clean(meeting.get("title"), 80),
                "meeting_at": start.isoformat() if start else "", "added_at": now.isoformat(),
                "provenance": f"added from {title} (Anarlog's words)", "at": now.isoformat()},
                1.0, observed_at=now.isoformat()))
            snap.link(pid, "OWED_BY", ME)
            if graph.node(eid):
                snap.link(pid, "EXTRACTED_FROM", eid)
            day = due_day(item.get("due_at"))
            if day:
                snap.add(day_node(day))
                snap.link(pid, "DUE_ON", f"day:{day}")
        snap.write(graph, PROMOTED_SOURCE)
        # The guess row says it was taken, until the next meetings pass
        # rewrites it the same way from promoted().
        graph.db.execute("UPDATE nodes SET props = json_set(props, '$.promoted', json('true')) WHERE id = ?",
                         (guess,))
        graph.db.commit()
    return pid
