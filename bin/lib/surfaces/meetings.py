"""meetings: the latest calls, what was decided, and what is owed from them.

Replaces opening Granola (or Anarlog) to see what a call said. Meetings come
from Chewbacca's own capture first (mac/room-capture records the mic and the
call audio, bin/lib/meeting_capture.py transcribes on this Mac and writes
~/.chewbacca/meetings/) and from Anarlog's CLI second, for anyone who already
used it (bin/lib/ingest_meetings.py does the reading, read only,
`--source local`, telemetry pinned off): the list is the newest meetings with
who was there and when; Open on a row shows that meeting's summary, the lines
under its Decisions heading, its open action items, and one bounded page of
its transcript with Next. A meeting with a start and no end that began
within the last few hours is named as recording at the top.

FIRST RUN IS A STATE, NOT AN ERROR. With no meeting recorded yet the panel
says what to do in order, for someone who has never heard of any of this,
and offers one press, Start capture, which runs `bin/room-capture start`.
Anarlog is never required; when it is installed its own `doctor` answer shows
underneath, so the person can see what it reports. While capture runs the
top line says "Recording now" and the same button reads Stop capture.

THE ONE PRESS THAT WRITES. "Add to tasks" on an action item writes one
promoted Task into the OS graph (ingest_meetings.promote) and nothing else:
not Anarlog, not Reminders, not a message. The row it acts on is named by the
press itself (the Task node id is the row id), looked up in the last fetch,
and refused if it is not there. The action item's words are Anarlog's model's
guess, and the row says so before the press.

Every string from a meeting is someone else's words: stripped of control,
format and bidi characters before it reaches a `d` line, clipped, and never
read for an action. The activity log gets the action and its outcome line,
and no outcome line here quotes a meeting.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

import ingest_meetings as AM
import meeting_capture as MC
import osgraph

from . import ACTION_PREFIX, Bind, Context, Provider, Result, SurfaceError, ago, clip, clock, comp, note_for

# Miller's limit on the glass is nine rows; six leaves the detail of one
# meeting on screen under the list at the right column's height. Guessed,
# never measured on the glass.
MOST_ROWS = 6
SUMMARY_LINES = 6
DECISION_LINES = 4
ITEM_ROWS = 5
LINE_WIDTH = 96
# One transcript page is TRANSCRIPT_WORDS words; at about 5.5 characters a
# word (English average) that is ~1,100 characters, so this clips only a page
# of unusually long words. Guessed, never measured on Anarlog output.
PAGE_CHARS = 1400
# Anarlog answered in 0.00 to 0.05 s per read on 2026-10-05 (empty database),
# so a 30 s refresh costs nothing measurable; a meeting's summary lands after
# the call ends, and this is how long the panel can lag it.
REFRESH_S = 30.0
PURPOSE = "What your calls said, and what you owe from them"
NO_MEETINGS = "No meetings recorded yet."
STEPS = [
    "Press Start capture when a call begins. Chewbacca records this Mac's microphone and the call's "
    "audio, and nothing else.",
    "The first time, macOS asks to allow Microphone and Screen & System Audio Recording for the app "
    "running it. Both live in System Settings > Privacy & Security, and "
    "`chewbacca-permissions guide --for capture` walks you through them.",
    "Every 15 seconds of audio is transcribed on this Mac, then deleted. Press Stop capture when the "
    "call ends to record the end of it; Claude then writes a summary and action items from the "
    "transcript, unless CHEWBACCA_MEETING_SUMMARY=0 keeps it on this Mac.",
]
ANARLOG_OPEN_STEP = "Already use Anarlog? Open Anarlog once from Applications and its meetings show here too."
ANARLOG_READY_STEP = "Anarlog is set up as well, so anything it records shows here too."
# Kept for anyone importing it; the panel no longer asks anyone to install a
# second app (Caleb, 2026-10-05: "Anarlog shouldn't be it's own app").
INSTALL_STEP = "Install Anarlog (github.com/fastrepl/anarlog), which puts an `anarlog` command on this Mac."
ROOM_CAPTURE = Path(__file__).resolve().parents[2] / "room-capture"
# The first press builds the Swift helper (6.6 s on this Mac on 2026-10-05,
# about a minute for the permission guide's on a cold machine), so the press
# waits this long before calling it failed.
START_TIMEOUT_S = 180.0


def tilde(path: str, home: Path) -> str:
    text = str(path or "")
    home_text = str(home)
    return "~" + text[len(home_text):] if home_text and text.startswith(home_text) else text


def doctor_line(report: dict | None, home: Path) -> str:
    """Anarlog's own doctor answer, as one line."""
    if not report:
        return "Anarlog's doctor didn't answer."
    bits = [f"Anarlog {report.get('version') or ''}".strip() + " says ready: " + ("yes" if report["ready"] else "no"),
            f"database {tilde(report.get('path', ''), home) or 'unknown'}",
            "exists" if report.get("exists") else "not there yet"]
    if report.get("error"):
        bits.append(f"issue: {report['error']}")
    return " · ".join(bits)


def lines_of(markdown: str, most: int) -> list[str]:
    """The summary's own lines, headings out, in order."""
    out = []
    for heading, lines in AM.sections(markdown):
        if "decision" in heading.lower():
            continue
        for line in lines:
            out.append(clip(line, LINE_WIDTH))
            if len(out) >= most:
                return out
    return out


def duration(meeting: dict) -> str:
    start, end = AM.when(meeting.get("started_at")), AM.when(meeting.get("ended_at"))
    if not start or not end or end <= start:
        return ""
    minutes = int((end - start).total_seconds() // 60)
    return f"{minutes} min" if minutes < 90 else f"{minutes // 60} h {minutes % 60} min"


class Meetings(Provider):
    name = "meetings"
    title = "MEETINGS"
    region = "right"
    width = 420
    refresh = REFRESH_S
    replaces = "Granola"

    def __init__(self) -> None:
        super().__init__()
        self.actions = {f"{ACTION_PREFIX}open": self.open, f"{ACTION_PREFIX}add": self.add,
                        f"{ACTION_PREFIX}next": self.next_page, f"{ACTION_PREFIX}capture": self.capture}
        # The meeting whose detail shows, by Anarlog id. Set only by open().
        self.opened = ""
        # id -> (updated_at, meeting): an unchanged meeting is not re-read.
        self._details: dict[str, tuple[str, dict]] = {}
        # The transcript page on the glass, for one meeting id.
        self._page: dict | None = None

    # ── reading ──────────────────────────────────────────────────────────

    @staticmethod
    def capture_state(ctx: Context) -> dict:
        """Whether native capture is recording now, and since when."""
        try:
            state = MC.capture_state(Path(ctx.home))
        except OSError:
            return {"running": False, "since": None}
        return {"running": bool(state.get("running")), "since": state.get("since")}

    def fetch(self, ctx: Context) -> dict:
        now = ctx.now()
        capture = self.capture_state(ctx)
        try:
            listed = AM.list_meetings(ctx, AM.MOST_MEETINGS)
        except AM.AnarlogError as err:
            if AM.first_run(err):
                return self.setup(ctx, err, capture)
            raise SurfaceError(str(err)) from None
        if not listed:
            return self.setup(ctx, None, capture)
        # The panel shows the newest MOST_ROWS; the graph gets every listed
        # meeting inside the retention window, so a busy week past six calls
        # is not dropped from the graph by the panel's own row limit.
        floor = now - timedelta(days=osgraph.RETENTION_DAYS)
        by_id: dict[str, dict] = {}
        try:
            for n, item in enumerate(listed):
                start = AM.started(item)
                if n >= MOST_ROWS and (start is None or start < floor):
                    continue
                key, stamp = str(item["id"]), str(item.get("updated_at") or "")
                hit = self._details.get(key)
                by_id[key] = hit[1] if hit and stamp and hit[0] == stamp else AM.get_meeting(ctx, key)
                self._details[key] = (stamp, by_id[key])
        except AM.AnarlogError as err:
            raise SurfaceError(str(err)) from None
        self._details = {k: v for k, v in self._details.items() if k in by_id}
        details = [by_id[str(item["id"])] for item in listed[:MOST_ROWS]]
        graph_note = ""
        if ctx.graph is not None and ctx.ids is not None:
            try:
                AM.ingest_details(ctx.graph, list(by_id.values()), ctx.ids, now, osgraph.RETENTION_DAYS, ctx.env)
            except (osgraph.OntologyError, sqlite3.Error, OSError, ValueError) as err:
                graph_note = f"Not saved to the graph: {clip(str(err), 80)}"
        rows = []
        kept = AM.promoted(ctx.graph)
        ids = ctx.ids or osgraph.Identities("/nonexistent")
        mine = AM.me_emails(ctx.env)
        for meeting in details:
            rows.append(self.row(meeting, ids, mine, kept, now))
        shown = next((r for r in rows if r["id"] == self.opened), None) or (rows[0] if rows else None)
        if shown and (self._page is None or self._page.get("meeting_id") != shown["id"]):
            try:
                self._page = AM.transcript_page(ctx, shown["id"], 0)
            except AM.AnarlogError as err:
                self._page = {"meeting_id": shown["id"], "offset": 0, "text": "", "returned": 0, "next": None,
                              "error": str(err)}
        return {"rows": rows, "graph_note": graph_note or AM.anarlog_note,
                "live": next((r for r in rows if r["live"]), None), "capture": capture}

    def setup(self, ctx: Context, err: AM.AnarlogError | None, capture: dict | None = None) -> dict:
        """The first-run state: native capture's steps, then Anarlog's own
        doctor answer when it is installed. Never raised."""
        report = None
        if err is None or err.code != "not_installed":
            try:
                report = AM.doctor(ctx)
            except AM.AnarlogError:
                report = None
        installed = not (err is not None and err.code == "not_installed")
        steps = list(STEPS)
        if installed:
            # A database existing says nothing about whether macOS allowed
            # the mic, so the permission step above stays either way.
            steps.append(ANARLOG_READY_STEP if report and report["ready"] and err is None else ANARLOG_OPEN_STEP)
        return {"rows": [], "setup": {"headline": NO_MEETINGS, "steps": steps,
                                      "doctor": doctor_line(report, Path(ctx.home)) if installed else ""},
                "graph_note": "", "live": None, "capture": capture or {"running": False, "since": None}}

    @staticmethod
    def who(meeting: dict, ids: osgraph.Identities, mine: set[str]) -> list[str]:
        """Who was there: the people-store name for a known email, the raw
        email otherwise, and a bare display name marked as Anarlog's."""
        out = []
        for p in AM.participants(meeting):
            node = AM.attendee_node(ids, p, mine)
            if node is not None:
                if node.id == osgraph.ME:
                    continue
                out.append(node.label if not node.unresolved else AM.clean(p.get("email"), 40))
            elif AM.clean(p.get("display_name")):
                out.append(f"{AM.clean(p.get('display_name'), 30)} (unverified)")
        return out

    def row(self, meeting: dict, ids, mine, kept: dict, now: datetime) -> dict:
        mid = str(meeting["id"])
        start = AM.started(meeting)
        items = []
        for item in AM.open_items(meeting)[:ITEM_ROWS]:
            iid = str(item.get("id") or "")
            if not iid:
                continue
            tid = AM.task_id(mid, iid)
            by_human = {str(p.get("human_id")): p for p in AM.participants(meeting) if p.get("human_id")}
            assignee = by_human.get(str(item.get("assignee_human_id") or ""))
            owner = ""
            if assignee is not None:
                node = AM.attendee_node(ids, assignee, mine)
                if node is not None:
                    owner = "you" if node.id == osgraph.ME else (
                        node.label if not node.unresolved else AM.clean(assignee.get("email"), 40))
                elif AM.clean(assignee.get("display_name")):
                    owner = f"{AM.clean(assignee.get('display_name'), 24)} (unverified)"
            items.append({"id": tid, "text": AM.clean(item.get("text"), 100), "owner": owner,
                          "due": AM.due_day(item.get("due_at")), "added": tid in kept,
                          "item": item})
        return {"id": mid, "title": AM.clean(meeting.get("title"), 60) or "Untitled meeting",
                "start": start, "live": AM.is_live(meeting, now), "length": duration(meeting),
                "folder": AM.clean(meeting.get("folder_path"), 40), "who": self.who(meeting, ids, mine),
                "summary": lines_of(AM.summary_text(meeting), SUMMARY_LINES),
                "decisions": [clip(x, LINE_WIDTH) for x in AM.decisions(meeting)[:DECISION_LINES]],
                "items": items, "meeting": meeting, "native": AM.app_of(meeting) == MC.APP,
                "summary_note": AM.clean(meeting.get("summary_note"), LINE_WIDTH)}

    # ── drawing ──────────────────────────────────────────────────────────

    def layout(self) -> list[str]:
        ids = ["s", "purpose", "live", "capture", "note", "setup", "doctor", "list", "head", "meta", "summary", "decisions",
               "items", "transcript", "next", "status"]
        return [
            comp(self.cid("s"), "Screen", title=self.title),
            comp(self.cid("purpose"), "Text", value=PURPOSE, tone="muted"),
            comp(self.cid("live"), "Text", value=Bind(self.p("live"))),
            comp(self.cid("capture"), "Button", label=Bind(self.p("captureLabel")), action=f"{ACTION_PREFIX}capture",
                 variant="primary"),
            comp(self.cid("note"), "Text", value=Bind(self.p("note")), tone="muted"),
            comp(self.cid("setup"), "List", items=Bind(self.p("setup"))),
            comp(self.cid("doctor"), "Text", value=Bind(self.p("doctor")), tone="muted"),
            comp(self.cid("list"), "Events", caption=Bind(self.p("caption")), items=Bind(self.p("rows")),
                 action=f"{ACTION_PREFIX}open", actionLabel="Open"),
            comp(self.cid("head"), "Heading", text=Bind(self.p("head")), level=3),
            comp(self.cid("meta"), "Text", value=Bind(self.p("meta")), tone="muted"),
            comp(self.cid("summary"), "List", items=Bind(self.p("summary"))),
            comp(self.cid("decisions"), "List", items=Bind(self.p("decisions"))),
            comp(self.cid("items"), "Events", caption=Bind(self.p("itemsCaption")), items=Bind(self.p("items")),
                 action=f"{ACTION_PREFIX}add", actionLabel="Add to tasks"),
            comp(self.cid("transcript"), "Text", value=Bind(self.p("transcript"))),
            comp(self.cid("next"), "Button", label=Bind(self.p("nextLabel")), action=f"{ACTION_PREFIX}next"),
            comp(self.cid("status"), "Text", value=Bind(self.p("status")), tone="muted"),
            f"> {' '.join(self.cid(i) for i in ids)}",
            f"r {self.cid('s')}",
        ]

    def initial(self) -> dict:
        return {self.p("status"): ""}

    def blank(self) -> dict:
        return {self.p("live"): "", self.p("setup"): [], self.p("doctor"): "", self.p("caption"): "",
                self.p("rows"): [], self.p("head"): "", self.p("meta"): "", self.p("summary"): [],
                self.p("decisions"): [], self.p("itemsCaption"): "", self.p("items"): [],
                self.p("transcript"): "", self.p("nextLabel"): "Next", self.p("captureLabel"): "Start capture"}

    def shown(self, data) -> dict | None:
        rows = (data or {}).get("rows") or []
        return next((r for r in rows if r["id"] == self.opened), None) or (rows[0] if rows else None)

    def model(self, data, error, values, ctx) -> dict:
        out = self.blank()
        if data is None:
            out[self.p("note")] = note_for(None, error, "")
            return out
        now = ctx.now()
        capture = data.get("capture") or {}
        out[self.p("captureLabel")] = "Stop capture" if capture.get("running") else "Start capture"
        if capture.get("running"):
            since = ago(capture["since"], now) if capture.get("since") else ""
            began = f", started {since} ago" if since not in ("", "now") else ""
            out[self.p("live")] = (f"Recording now{began}: this Mac's mic and the call audio. The first lines "
                                   "show about 15 seconds after someone speaks.")
        setup = data.get("setup")
        if setup:
            out[self.p("note")] = note_for(data, error, setup["headline"], data.get("_at"))
            out[self.p("setup")] = [{"id": f"step{i}", "text": f"{i + 1}. {s}"} for i, s in enumerate(setup["steps"])]
            out[self.p("doctor")] = setup["doctor"]
            return out
        rows = data["rows"]
        live = data.get("live")
        if live and live["native"] and not capture.get("running"):
            # A native meeting with no end and no capture running: the
            # watcher is still writing its last lines and summary.
            out[self.p("live")] = f"Finishing {live['title']}: the last lines and the summary land shortly."
        elif live and live["native"]:
            since = ago(live["start"], now) if live["start"] else ""
            began = f"started {since} ago" if since not in ("", "now") else "just started"
            out[self.p("live")] = f"Recording now: {live['title']}, {began}. Press Stop capture when it ends."
        elif live:
            since = ago(live["start"], now) if live["start"] else ""
            began = f"started {since} ago" if since not in ("", "now") else "just started"
            out[self.p("live")] = f"Recording now: {live['title']}, {began}. Anarlog shows no end time yet."
        recent = [r for r in rows if r["start"] and (now - r["start"]).days < 7]
        week = len(recent)
        owed = sum(1 for r in recent for i in r["items"] if not i["added"])
        caption = f"{week} meeting{'s' if week != 1 else ''} this week · {owed} action item{'s' if owed != 1 else ''} to look at"
        out[self.p("note")] = note_for(data, error, data.get("graph_note") or caption, data.get("_at"))
        out[self.p("caption")] = "Latest"
        out[self.p("rows")] = [{
            "id": r["id"], "time": ago(r["start"], now) if r["start"] else "",
            "accent": r["id"] == (self.shown(data) or {}).get("id"),
            "text": clip(f"{r['title']}" + (f" · with {', '.join(r['who'][:3])}" if r["who"] else "")
                         + (f" +{len(r['who']) - 3}" if len(r["who"]) > 3 else ""), 90)} for r in rows]
        r = self.shown(data)
        if r is None:
            return out
        when_text = (f"{r['start'].strftime('%a %b %-d')}, {clock(r['start'])}" if r["start"] else "No start time")
        meta = [when_text] + ([r["length"]] if r["length"] else []) + ([r["folder"]] if r["folder"] else [])
        out[self.p("head")] = r["title"]
        out[self.p("meta")] = " · ".join(meta + ([f"with {', '.join(r['who'])}"] if r["who"] else []))
        if r["native"]:
            empty = r["summary_note"] or "No summary yet. Claude writes one from the transcript when capture stops."
            out[self.p("summary")] = ([{"id": "s-guess", "text": "Claude's guess from the transcript:"}]
                                      + [{"id": f"s{i}", "text": t} for i, t in enumerate(r["summary"])]
                                      if r["summary"] else [{"id": "s0", "text": empty}])
        else:
            out[self.p("summary")] = ([{"id": f"s{i}", "text": t} for i, t in enumerate(r["summary"])]
                                      or [{"id": "s0", "text": "No summary yet. Anarlog writes one after the call."}])
        whose = AM.whose(r["meeting"])
        out[self.p("decisions")] = ([{"id": f"d{i}", "text": f"Decided: {t}"} for i, t in enumerate(r["decisions"])]
                                    or [{"id": "d0", "text": f"No Decisions section in {whose} summary."}])
        out[self.p("itemsCaption")] = (f"Action items · {whose} guesses, check before adding" if r["items"]
                                       else "No open action items.")
        out[self.p("items")] = [{
            "id": i["id"], "accent": not i["added"],
            "time": i["due"][5:] if i["due"] else "",
            "text": clip(("Added · " if i["added"] else "(guess) ") + i["text"]
                         + (f" · {i['owner']}" if i["owner"] else ""), 120)} for i in r["items"]]
        page = self._page if self._page and self._page.get("meeting_id") == r["id"] else None
        if page is None:
            out[self.p("transcript")] = "Transcript: open the meeting to read it."
        elif page.get("error"):
            out[self.p("transcript")] = f"Transcript: {page['error']}"
        elif not page["text"]:
            out[self.p("transcript")] = "No transcript words yet." if page["offset"] == 0 else "End of the transcript."
        else:
            start = page["offset"] + 1
            out[self.p("transcript")] = (f"Transcript, words {start}-{page['offset'] + page['returned']}: "
                                         + clip(page["text"], PAGE_CHARS))
        out[self.p("nextLabel")] = f"Next {AM.TRANSCRIPT_WORDS} words" if page and page.get("next") else "Back to the start"
        return out

    # ── presses ──────────────────────────────────────────────────────────

    def open(self, ctx: Context, data, values: dict) -> Result:
        mid = str(values.get("row") or "")
        r = next((x for x in (data or {}).get("rows") or [] if x["id"] == mid), None)
        if r is None:
            return Result(False, "That meeting isn't on the list any more.")
        self.opened = mid
        try:
            self._page = AM.transcript_page(ctx, mid, 0)
        except AM.AnarlogError as err:
            self._page = {"meeting_id": mid, "offset": 0, "text": "", "returned": 0, "next": None, "error": str(err)}
        return Result(True, "Opened.")

    def next_page(self, ctx: Context, data, values: dict) -> Result:
        r = self.shown(data)
        if r is None:
            return Result(False, "No meeting to read.")
        page = self._page if self._page and self._page.get("meeting_id") == r["id"] else None
        offset = page["next"] if page and page.get("next") else 0
        try:
            self._page = AM.transcript_page(ctx, r["id"], offset)
        except AM.AnarlogError as err:
            return Result(False, f"Couldn't read the transcript: {err}")
        if offset == 0:
            return Result(True, "Back at the start of the transcript.")
        return Result(True, f"Words {offset + 1}-{offset + self._page['returned']}.")

    def add(self, ctx: Context, data, values: dict) -> Result:
        """Promote one action item into the person's tasks, in the graph only."""
        tid = str(values.get("row") or "")
        found = None
        for r in (data or {}).get("rows") or []:
            for i in r["items"]:
                if i["id"] == tid:
                    found = (r, i)
        if found is None:
            return Result(False, "That action item isn't on the list any more. Nothing was added.")
        r, i = found
        if i["added"]:
            return Result(False, "Already in your tasks.")
        if ctx.graph is None:
            return Result(False, "The OS graph isn't open, so nothing was added.")
        if ctx.graph.node(tid) is None:
            return Result(False, "That action item isn't in the graph yet. Wait for the next refresh.")
        try:
            AM.promote(ctx.graph, r["meeting"], i["item"], ctx.now())
        except (osgraph.OntologyError, sqlite3.Error, ValueError) as err:
            return Result(False, f"Not added: {clip(str(err), 80)}")
        i["added"] = True
        due = " It's due " + i["due"] + "." if i["due"] else ""
        return Result(True, f"Added to your tasks from the meeting. Still {AM.whose(r['meeting'])} words, "
                            f"so check them.{due}", refetch=True)

    def capture(self, ctx: Context, data, values: dict) -> Result:
        """Start capture, or stop it when it runs. The press is the approval;
        the outcome line is bin/room-capture's own, cleaned, never a meeting's
        words."""
        running = self.capture_state(ctx)["running"]
        tool = str((ctx.env or {}).get("KYBER_ROOM_CAPTURE") or ROOM_CAPTURE)
        argv = [tool, "stop", "--wait", "0", "--json"] if running else [tool, "start", "--json"]
        try:
            code, out, err = ctx.run(argv, timeout=START_TIMEOUT_S)
        except TypeError:
            code, out, err = ctx.run(argv)
        try:
            body = json.loads(out or "{}")
        except ValueError:
            body = {}
        line = AM.clean(body.get("message") if isinstance(body, dict) else "", 160)
        if not line:
            line = AM.clean((err or out or "").splitlines()[0] if (err or out) else "", 160)
        verb = "stop" if running else "start"
        if code != 0:
            return Result(False, line or f"room-capture {verb} failed ({code}).", refetch=True)
        return Result(True, line or ("Stopped." if running else "Recording."), refetch=True)
