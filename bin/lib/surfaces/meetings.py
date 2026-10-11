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

ONE PRESS PER ACTION ITEM, CHOSEN BY RULE (CHW-206). Go on an item does the
one thing its shape calls for (bin/lib/meeting_actions.py): a message to a
named person becomes a text draft in `people texts drafts`, never sent; a day
someone named becomes a tentative event with no invitees; anything else
becomes a work-ledger task. The row says what Go will touch before the press,
and after it the row reads "Done" with the line read back from where the
thing landed. Under the items, one line each says where the owner and the day
came from: the transcript line's clock when a line says it, "(guess)" when it
was inferred. The row is named by the press (the Task node id is the row id),
looked up in the last fetch, and refused if it is not there. The older "Add
to tasks" press (`ks-add`) still promotes one Task into the OS graph only.

Every string from a meeting is someone else's words: stripped of control,
format and bidi characters before it reaches a `d` line, clipped, and never
read for an action. The activity log gets the action and its outcome line,
and no outcome line here quotes a meeting.
"""
from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

import ingest_meetings as AM
import meeting_actions as MA
import meeting_capture as MC
import osgraph

from . import ACTION_PREFIX, Bind, Context, Provider, Result, SurfaceError, ago, clip, clock, comp, note_for

# Miller's limit on the glass is nine rows; six leaves the detail of one
# meeting on screen under the list at the right column's height. Guessed,
# never measured on the glass.
MOST_ROWS = 6
# Granola shows a handful of lines; two or three read at a glance.
SUMMARY_LINES = 3
DECISION_LINES = 3
ITEM_ROWS = 5
ROW_WIDTH = 60
LINE_WIDTH = 96
# One transcript page is TRANSCRIPT_WORDS words; at about 5.5 characters a
# word (English average) that is ~1,100 characters, so this clips only a page
# of unusually long words. Guessed, never measured on Anarlog output.
PAGE_CHARS = 1400
# Anarlog answered in 0.00 to 0.05 s per read on 2026-10-05 (empty database),
# so a 30 s refresh costs nothing measurable; a meeting's summary lands after
# the call ends, and this is how long the panel can lag it.
REFRESH_S = 30.0
PURPOSE = "What your calls said, and what you owe"
NO_MEETINGS = "No meetings recorded yet."
# Each step is one glance: the 2026-10-10 versions ran 150 to 190 characters
# and Caleb called the panel a wall of text (surface_lint.ROW_CHARS is 120).
STEPS = [
    "Zoom, Teams or a Slack huddle on your mic records itself and stops when the call ends.",
    "Any other call: press Record now.",
    "Audio is transcribed on this Mac and deleted; Claude writes the summary when it ends.",
]
ANARLOG_OPEN_STEP = "Anarlog's meetings show here once it has run."
ANARLOG_READY_STEP = "Anarlog's meetings show here too."
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


def distinct(lines: list[str], others: list[str]) -> list[str]:
    """Summary lines that say something a decision or an action item doesn't:
    the 2026-10-10 panel said "Ship the autopilot tonight" three times. Two
    lines are the same when most of the shorter one's words are in the other.
    Half the words is guessed, never measured."""
    def words(t: str) -> set[str]:
        return {w for w in re.findall(r"[a-z0-9']+", t.lower()) if len(w) > 2}
    out = []
    for line in lines:
        mine = words(line)
        if mine and any(len(mine & words(o)) * 2 >= min(len(mine), len(words(o)) or 1) for o in others + out):
            continue
        out.append(line)
    return out


def short_day(day: str) -> str:
    """"2026-10-12" -> "Oct 12"."""
    try:
        return datetime.strptime(day[:10], "%Y-%m-%d").strftime("%b %-d")
    except ValueError:
        return ""


def sentences(text: str) -> list[str]:
    parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", text) if p.strip()]
    return parts or [text]


def why_line(n: int, i: dict) -> str:
    """Where one item's owner and day came from, in one short line."""
    plan = i["plan"]
    o = plan["owner"]
    who = (o["name"] or "no owner") + (" (guessed)" if o["name"] and o["guess"] else " (said)" if o["name"] else "")
    w = plan.get("when")
    day = f" · {short_day(w['day'].isoformat())} ({'guessed' if w['guess'] else 'said'})" if w else ""
    line = plan.get("line")
    at = re.sub(r":\d\d(\s?[AP]M)", r"\1", str(line.get("clock") or "")) if line else ""
    return clip(f"{n}. {who}{day}" + (f" · heard at {at}" if at else " · not in the transcript"), 110)


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
                        f"{ACTION_PREFIX}act": self.act,
                        f"{ACTION_PREFIX}next": self.next_page, f"{ACTION_PREFIX}capture": self.capture,
                        f"{ACTION_PREFIX}why": self.why, f"{ACTION_PREFIX}transcript": self.transcript}
        # Folded by default: where an item came from, and the transcript.
        self.show_why = False
        self.show_transcript = False
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
        out = {"running": bool(state.get("running")), "since": state.get("since")}
        # What the autopilot says it is doing (bin/meeting-autopilot writes
        # it every look). Its words are its own, never a meeting's.
        pilot = MC.load(Path(ctx.home) / ".chewbacca" / "meeting-autopilot" / "state.json") or {}
        if pilot:
            fresh = MC.parse_iso(pilot.get("updated"))
            # The loop writes every 2 s; ten minutes of silence means it is gone.
            out["watching"] = bool(fresh and (ctx.now() - fresh).total_seconds() < 600)
            out["off"] = bool(pilot.get("off"))
            trigger = pilot.get("trigger") if isinstance(pilot.get("trigger"), dict) else {}
            if pilot.get("phase") in ("recording", "ending"):
                out["app"] = AM.clean(trigger.get("name"), 30)
        return out

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
        done = MA.acted(Path(ctx.home))
        ids = ctx.ids or osgraph.Identities("/nonexistent")
        mine = AM.me_emails(ctx.env)
        for meeting in details:
            rows.append(self.row(meeting, ids, mine, kept, now, self.lines_of(ctx, meeting), done))
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

    @staticmethod
    def lines_of(ctx: Context, meeting: dict) -> list[dict]:
        """The transcript's timed lines, for provenance. Only native capture
        keeps them; Anarlog's reads give words without clocks, so its items
        say no line was found."""
        if AM.app_of(meeting) != MC.APP:
            return []
        try:
            body = MC.read_meeting(Path(ctx.home), str(meeting["id"])) or {}
        except (OSError, ValueError):
            return []
        return [x for x in body.get("lines") or [] if isinstance(x, dict)]

    def row(self, meeting: dict, ids, mine, kept: dict, now: datetime, lines: list | None = None,
            done: dict | None = None) -> dict:
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
            names = [n for n in self.who(meeting, ids, mine) if not n.endswith("(unverified)")]
            plan = MA.plan(meeting, item, lines or [], names, owner)
            items.append({"id": tid, "text": AM.clean(item.get("text"), 100), "owner": owner, "plan": plan,
                          "done": (done or {}).get(tid),
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
    #
    # Granola's shape, calmer: one state line, two counts, the meetings, then
    # the open one as title, one meta line, two or three summary lines,
    # Decided only when something was, and the items as rows with a date and
    # one Go. Provenance and the transcript are behind a tap each (Caleb,
    # 2026-10-10: "its just a wall of text"; surface_lint holds the line).

    def layout(self) -> list[str]:
        ids = ["s", "purpose", "state", "capture", "note", "counts", "setup", "list", "detail", "status"]
        detail = ["head", "meta", "summary", "decisions", "items", "whyBtn", "why", "txBtn", "transcript", "next"]
        return [
            comp(self.cid("s"), "Screen", title=self.title),
            comp(self.cid("purpose"), "Text", value=PURPOSE, tone="muted"),
            # Recording wears the recording hue on every surface (hud
            # HUD.meaning); any other state is plain ink.
            comp(self.cid("state"), "Text", value=Bind(self.p("state")), tone=Bind(self.p("stateTone"))),
            comp(self.cid("capture"), "Button", label=Bind(self.p("captureLabel")), action=f"{ACTION_PREFIX}capture"),
            comp(self.cid("note"), "Text", value=Bind(self.p("note")), tone="muted"),
            comp(self.cid("counts"), "Stack", direction="grid", cols=2, gap=3),
            comp(self.cid("week"), "Metric", label="This week", value=Bind(self.p("week"))),
            comp(self.cid("owed"), "Metric", label="To look at", value=Bind(self.p("owed")),
                 thresholds=[{"at": 1, "tone": "warn"}]),
            f"> {self.cid('counts')} {self.cid('week')} {self.cid('owed')}",
            comp(self.cid("setup"), "List", items=Bind(self.p("setup"))),
            comp(self.cid("list"), "Events", items=Bind(self.p("rows")), action=f"{ACTION_PREFIX}open",
                 actionLabel="Open"),
            # The open meeting is one card that grows out of its row and goes
            # back into it when another row opens (hud ContainerTransform.swift).
            comp(self.cid("detail"), "Stack", gap=3, **{"from": Bind(self.p("shownRow"))}),
            comp(self.cid("head"), "Heading", text=Bind(self.p("head")), level=3),
            comp(self.cid("meta"), "Text", value=Bind(self.p("meta")), tone="muted"),
            comp(self.cid("summary"), "List", items=Bind(self.p("summary"))),
            comp(self.cid("decisions"), "List", items=Bind(self.p("decisions"))),
            comp(self.cid("items"), "Events", caption=Bind(self.p("itemsCaption")), items=Bind(self.p("items")),
                 action=f"{ACTION_PREFIX}act", actionLabel="Go"),
            comp(self.cid("whyBtn"), "Button", label=Bind(self.p("whyLabel")), action=f"{ACTION_PREFIX}why"),
            comp(self.cid("why"), "List", items=Bind(self.p("itemsWhy"))),
            comp(self.cid("txBtn"), "Button", label=Bind(self.p("txLabel")), action=f"{ACTION_PREFIX}transcript"),
            comp(self.cid("transcript"), "Transcript", items=Bind(self.p("transcript"))),
            comp(self.cid("next"), "Button", label=Bind(self.p("nextLabel")), action=f"{ACTION_PREFIX}next"),
            comp(self.cid("status"), "Text", value=Bind(self.p("status")), tone="muted"),
            f"> {self.cid('detail')} {' '.join(self.cid(i) for i in detail)}",
            f"> {' '.join(self.cid(i) for i in ids)}",
            f"r {self.cid('s')}",
        ]

    def initial(self) -> dict:
        return {self.p("status"): ""}

    def blank(self) -> dict:
        return {self.p("state"): "", self.p("stateTone"): "", self.p("setup"): [], self.p("rows"): [], self.p("shownRow"): "",
                self.p("week"): "", self.p("owed"): "", self.p("head"): "", self.p("meta"): "",
                self.p("summary"): [], self.p("decisions"): [], self.p("itemsCaption"): "", self.p("items"): [],
                self.p("itemsWhy"): [], self.p("whyLabel"): "", self.p("transcript"): [], self.p("txLabel"): "",
                self.p("nextLabel"): "", self.p("captureLabel"): "Record now"}

    def shown(self, data) -> dict | None:
        rows = (data or {}).get("rows") or []
        return next((r for r in rows if r["id"] == self.opened), None) or (rows[0] if rows else None)

    @staticmethod
    def state_line(capture: dict, now: datetime) -> str:
        """The one calm line about recording: never a paragraph."""
        if capture.get("running"):
            mins = int((now - capture["since"]).total_seconds() // 60) if capture.get("since") else 0
            app = capture.get("app") or ""
            return " · ".join(["Recording"] + ([app] if app else []) + ([f"{mins} min"] if mins else []))
        if capture.get("watching") is False:
            return "Not listening for calls"
        return "Auto-record is off" if capture.get("off") else "Listening for calls"

    def model(self, data, error, values, ctx) -> dict:
        out = self.blank()
        if data is None:
            out[self.p("note")] = note_for(None, error, "")
            return out
        now = ctx.now()
        capture = data.get("capture") or {}
        out[self.p("captureLabel")] = "Stop" if capture.get("running") else "Record now"
        out[self.p("state")] = self.state_line(capture, now)
        out[self.p("stateTone")] = "recording" if capture.get("running") else ""
        setup = data.get("setup")
        if setup:
            out[self.p("note")] = note_for(data, error, setup["headline"], data.get("_at"))
            out[self.p("setup")] = [{"id": f"step{i}", "text": clip(t, 110)} for i, t in enumerate(setup["steps"])] \
                + ([{"id": "doctor", "text": clip(setup["doctor"], 110)}] if setup["doctor"] else [])
            return out
        rows = data["rows"]
        live = data.get("live")
        if live and live["native"] and not capture.get("running"):
            out[self.p("state")] = f"Finishing {clip(live['title'], 40)}"
        elif live and not live["native"]:
            # Anarlog recording on its own, with no end time yet.
            mins = int((now - live["start"]).total_seconds() // 60) if live["start"] else 0
            out[self.p("state")] = " · ".join(["Recording", clip(live["title"], 40)] + ([f"{mins} min"] if mins else []))
            out[self.p("stateTone")] = "recording"
        recent = [r for r in rows if r["start"] and (now - r["start"]).days < 7]
        out[self.p("week")] = len(recent)
        out[self.p("owed")] = sum(1 for r in recent for i in r["items"] if not i["added"] and not i["done"])
        out[self.p("note")] = note_for(data, error, data.get("graph_note") or "", data.get("_at"))
        shown_id = (self.shown(data) or {}).get("id")
        out[self.p("rows")] = [{
            "id": r["id"], "time": ago(r["start"], now) if r["start"] else "", "accent": r["id"] == shown_id,
            "text": clip(r["title"] + (f" · {', '.join(r['who'][:2])}" if r["who"] else "")
                         + (f" +{len(r['who']) - 2}" if len(r["who"]) > 2 else ""), ROW_WIDTH)} for r in rows]
        r = self.shown(data)
        if r is None:
            return out
        out[self.p("shownRow")] = r["id"]
        when_text = r["start"].strftime("%a %b %-d") if r["start"] else ""
        who = [w for w in r["who"] if not w.endswith("(unverified)")] or r["who"]
        out[self.p("head")] = clip(r["title"], 60)
        out[self.p("meta")] = clip(" · ".join(x for x in [when_text, r["length"], ", ".join(who[:3])] if x), 90)
        summary = distinct(r["summary"], r["decisions"] + [i["text"] for i in r["items"]])[:SUMMARY_LINES]
        if summary:
            out[self.p("summary")] = [{"id": f"s{n}", "text": clip(t, 110)} for n, t in enumerate(summary)]
        elif r["native"]:
            out[self.p("summary")] = [{"id": "s0", "text": clip(r["summary_note"] or "Summary comes when the call ends.",
                                                                  110)}]
        out[self.p("decisions")] = [{"id": f"d{n}", "text": clip(f"Decided: {t}", 110)}
                                    for n, t in enumerate(r["decisions"])]
        out[self.p("itemsCaption")] = "Action items" if r["items"] else ""
        out[self.p("items")] = [self.item_row(i) for i in r["items"]]
        if r["items"]:
            out[self.p("whyLabel")] = "Hide where these came from" if self.show_why else "Where these came from"
        if self.show_why:
            out[self.p("itemsWhy")] = [{"id": f"why-{i['id']}", "text": why_line(n + 1, i)}
                                       for n, i in enumerate(r["items"])]
        page = self._page if self._page and self._page.get("meeting_id") == r["id"] else None
        out[self.p("txLabel")] = "Hide transcript" if self.show_transcript else "Transcript"
        if self.show_transcript:
            if page is None or page.get("error") or not page.get("text"):
                why = (page or {}).get("error") or ("No transcript yet." if not page or page["offset"] == 0
                                                    else "End of the transcript.")
                out[self.p("transcript")] = [{"id": "t0", "role": "assistant", "text": clip(why, 110)}]
            else:
                out[self.p("transcript")] = [{"id": f"t{page['offset']}-{n}", "role": "assistant", "text": part}
                                             for n, part in enumerate(sentences(clip(page["text"], PAGE_CHARS)))]
            out[self.p("nextLabel")] = "More" if page and page.get("next") else "From the start"
        return out

    @staticmethod
    def item_row(i: dict) -> dict:
        """What is owed, by whom, when, and what Go touches: the provenance
        is behind "Where these came from", never printed in the row."""
        day = i["due"] or (i["plan"]["when"]["day"].isoformat() if i["plan"].get("when") else "")
        owner = "" if i["owner"] in ("", "you") else i["owner"].replace(" (unverified)", "")
        words = clip(i["text"], 52) + (f" · {clip(owner, 20)}" if owner else "")
        if i["done"]:
            text = f"Done · {words}"
        elif i["added"]:
            text = f"Added · {words}"
        else:
            # What Go will touch, in one word (kyber-surfaces rule 4); the
            # full "Go puts a tentative event on..." sentence was the wall.
            touch = {"event": "calendar hold", "draft": "text draft", "task": "task"}.get(i["plan"].get("kind"), "")
            text = words + (f" · {touch}" if touch else "") + (" · guess" if i["item"].get("guess", True) else "")
        return {"id": i["id"], "accent": not (i["added"] or i["done"]),
                "time": short_day(day), "text": clip(text, 90)}

    def why(self, ctx: Context, data, values: dict) -> Result:
        self.show_why = not self.show_why
        return Result(True, "")

    def transcript(self, ctx: Context, data, values: dict) -> Result:
        self.show_transcript = not self.show_transcript
        return Result(True, "")

    # ── presses ──────────────────────────────────────────────────────────

    def act(self, ctx: Context, data, values: dict) -> Result:
        """Go on one action item: the one thing its plan names, then a read
        back. Never a send, never an invite."""
        tid = str(values.get("row") or "")
        found = None
        for r in (data or {}).get("rows") or []:
            for i in r["items"]:
                if i["id"] == tid:
                    found = (r, i)
        if found is None:
            return Result(False, "That action item isn't on the list any more. Nothing was done.")
        r, i = found
        if i["done"]:
            return Result(False, "Already done: " + i["done"]["line"])
        env = MA.env_with_home(ctx.env, Path(ctx.home))
        home = Path(ctx.home)
        # Marked pressed before anything outside is written: if this mark
        # can't be saved, nothing happens, so a lost write can't double-draft.
        try:
            MA.reserve(home, tid, i["plan"], ctx.now())
        except OSError as err:
            return Result(False, f"Nothing was done: couldn't record the press ({clip(str(err), 60)}).")
        try:
            result = MA.act(i["plan"], ctx.run, env)
        except (OSError, ValueError) as err:
            result = {"ok": False, "line": f"Nothing was done: {clip(str(err), 80)}", "unknown": True}
        if not result["ok"]:
            if not result.get("ref") and not result.get("unknown"):
                MA.release(home, tid)
            return Result(False, result["line"], refetch=True)
        try:
            MA.remember(home, tid, i["plan"], result, ctx.now())
        except OSError:
            pass  # the pending mark from reserve() still blocks a second press
        i["done"] = {"line": result["line"], "kind": i["plan"]["kind"]}
        if i["plan"]["kind"] == "task" and ctx.graph is not None and ctx.graph.node(tid) is not None \
                and not i["added"]:
            # The ledger is the task list he reads; the graph copy keeps it
            # on the tasks lanes and the Docket, as Add to tasks did.
            try:
                AM.promote(ctx.graph, r["meeting"], i["item"], ctx.now())
                i["added"] = True
            except (osgraph.OntologyError, sqlite3.Error, ValueError):
                pass
        return Result(True, result["line"], refetch=True)

    # ── the other presses ────────────────────────────────────────────────

    def open(self, ctx: Context, data, values: dict) -> Result:
        mid = str(values.get("row") or "")
        r = next((x for x in (data or {}).get("rows") or [] if x["id"] == mid), None)
        if r is None:
            return Result(False, "That meeting isn't on the list any more.")
        self.opened = mid
        self.show_why = self.show_transcript = False
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
