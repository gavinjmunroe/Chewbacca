#!/usr/bin/env python3
"""meetings: the Anarlog surface and ingester, against a fake `anarlog` CLI.

What is held here: every CLI call is a read, local only, telemetry pinned off;
a Mac where Anarlog was never opened (or isn't installed) is a first-run
state with steps and Anarlog's own doctor answer, never an error; the surface
draws valid Kyber Lines for loading, error, setup, empty and data; a meeting
with a start and no end says "Recording now" at the top; attendees become
Persons only through the people store, by email, never by a display name or
a first name; action items are guesses with their meeting as EXTRACTED_FROM
and stay out of the tasks lanes until "Add to tasks" promotes one, which
writes only the graph and puts a due one on the Docket's queue; transcripts
come in bounded pages with Next; and no control, format or bidi character
from a meeting reaches a `d` line.

THE FIXTURES (tests/fixtures/anarlog). Five are the real CLI's answers,
captured 2026-10-05 from Anarlog CLI 1.4.28 on Caleb's Mac, verbatim except
the home folder in doctor_ready.json's path:

- doctor_ready.json        `anarlog --json doctor` on the freshly launched app
- doctor_not_ready.json    the same with ANARLOG_DB_PATH=/nonexistent/app.db (exit 1)
- list_empty.json          `meetings --source local list` with no meetings yet
- error_database_not_found.json  list with no database (stderr, exit 3)
- error_not_found.json     `meetings get -- nope` (stderr, exit 2)

The rest are made up, in the shapes the CLI source serializes at
fastrepl/anarlog@36715cc: the envelope from apps/cli/src/output.rs:11-31,
MeetingListItem from crates/agent-access/src/lib.rs:130-143, Meeting with its
Document, Participant and ActionItem from lib.rs:188-251, the transcript data
object from apps/cli/src/commands/meetings.rs:201-207, and Pagination from
lib.rs:117-124. No meeting had been recorded on this Mac yet, so no real
meeting's JSON was available to copy.
"""
import json
import re
import sys
import tempfile
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import surfaces_fixture as fx  # noqa: E402
import test_kyber_surfaces as tks  # noqa: E402  validate(), FakeHud and the daemon

import ingest_meetings as AM  # noqa: E402
import osgraph  # noqa: E402
import osgraph_walks  # noqa: E402
import surfaces  # noqa: E402
from surfaces import Context  # noqa: E402
from surfaces.meetings import INSTALL_STEP, NO_MEETINGS, Meetings  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "anarlog"
BIN = "/opt/fake/anarlog"
BIDI = "\u202e"
LINE_SEP = "\u2028"

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


class FakeAnarlog:
    """Stands in for the `anarlog` CLI and nothing else. Answers from the
    fixtures the way the real one does (success on stdout, errors on stderr
    with their exit codes) and refuses anything that is not a read."""

    def __init__(self, state="ready"):
        # ready: meetings exist; empty: set up, none yet; unset: no database;
        # missing: not installed.
        self.state = state
        self.calls: list[list[str]] = []

    def __call__(self, argv, timeout=None):
        self.calls.append(list(argv))
        if self.state == "missing":
            return 127, "", f"{argv[0]} is not installed"
        if argv[:4] != ["/usr/bin/env", "ANARLOG_ANALYTICS=0", BIN, "--json"]:
            return 2, "", "fake anarlog: not called the expected way"
        words = argv[4:]
        if words == ["doctor"]:
            if self.state == "unset":
                return 1, fixture("doctor_not_ready.json"), ""
            return 0, fixture("doctor_ready.json"), ""
        if words[:3] != ["meetings", "--source", "local"]:
            return 2, "", "fake anarlog: only local meeting reads are allowed"
        if self.state == "unset":
            return 3, "", fixture("error_database_not_found.json")
        verb, rest = words[3], words[4:]
        if verb == "list":
            return 0, fixture("list_empty.json" if self.state == "empty" else "list.json"), ""
        if verb == "get" and rest[:1] == ["--"]:
            path = FIXTURES / f"get_{rest[1]}.json"
            return (0, path.read_text(), "") if path.exists() else (2, "", fixture("error_not_found.json"))
        if verb == "transcript" and "--" in rest:
            offset = rest[rest.index("--offset") + 1]
            path = FIXTURES / f"transcript_{rest[rest.index('--') + 1]}_{offset}.json"
            return (0, path.read_text(), "") if path.exists() else (2, "", fixture("error_not_found.json"))
        return 2, "", f"fake anarlog: unknown {words}"


def world(tmp: Path, cli: FakeAnarlog, graph=True):
    people = tmp / "people.db"
    ctx = Context(run=cli, now=lambda: fx.NOW, home=tmp, sleep=lambda s: None,
                  env={"KYBER_ANARLOG": BIN, "PATH": "/usr/bin", "PEOPLE_DB": str(people),
                       "KYBER_MEETINGS_ME": "caleb@usc.example"})
    ctx.ids = osgraph.Identities(people if people.exists() else fx.people_db(people))
    if graph:
        ctx.graph = osgraph.Graph(tmp / "graph.sqlite")
    return ctx


def draw(p: Meetings, data, error, ctx) -> list[str]:
    model = p.model(data, error, {}, ctx)
    return [f"@ {p.name} at={p.region} w={p.width}"] + p.layout() + [
        surfaces.data_line(k, v) for k, v in {**p.initial(), **model}.items()]


def value(lines: list[str], pointer: str):
    for line in reversed(lines):
        if line.startswith(f"d {pointer} "):
            return json.loads(line.split(" ", 2)[2])
    return None


def clean_glass(lines: list[str]) -> bool:
    return not any(BIDI in x or LINE_SEP in x or "\x1b" in x for x in lines)


def only_reads(cli: FakeAnarlog) -> bool:
    for argv in cli.calls:
        words = argv[4:]
        if argv[:4] != ["/usr/bin/env", "ANARLOG_ANALYTICS=0", BIN, "--json"]:
            return False
        if words != ["doctor"] and (words[:3] != ["meetings", "--source", "local"]
                                    or words[3] not in ("list", "get", "transcript")):
            return False
        if any(w in ("proposals", "export", "auth", "--force", "cloud") for w in words):
            return False
    return True


def first_run(tmp: Path) -> None:
    # Since native capture (2026-10-05) the headline is the same in all three
    # states: Anarlog's state is the doctor line's job, not the panel's.
    for state, headline, doctor_has in (
            ("unset", NO_MEETINGS, "database file does not"),
            ("empty", NO_MEETINGS, "ready: yes"),
            ("missing", NO_MEETINGS, "")):
        cli = FakeAnarlog(state)
        (tmp / state).mkdir()
        ctx = world(tmp / state, cli)
        p = Meetings()
        data = p.fetch(ctx)
        lines = draw(p, data, None, ctx)
        check(f"{state}: draws valid Kyber Lines", not tks.validate(lines), tks.validate(lines))
        check(f"{state}: is a first-run state, not an error", value(lines, "/meetings/note") == headline,
              value(lines, "/meetings/note"))
        rows_ = value(lines, "/meetings/setup") or []
        steps = [s["text"] for s in rows_ if s["id"] != "doctor"]
        doctor = next((s["text"] for s in rows_ if s["id"] == "doctor"), "")
        if state == "missing":
            # Caleb, 2026-10-05: "Anarlog shouldn't be it's own app". The
            # first step was "Install Anarlog"; it is now the Start capture press.
            check("missing: the first step says calls record themselves, never installing a second app",
                  steps and "records itself" in steps[0] and not any(INSTALL_STEP in s for s in steps), steps)
            check("missing: a small Record press stays for any other call",
                  value(lines, "/meetings/captureLabel") == "Record", value(lines, "/meetings/captureLabel"))
            check("missing: the state line is one small word or phrase",
                  value(lines, "/meetings/state") in ("Listening", "Not listening for calls",
                                                      "Auto-record is off"), value(lines, "/meetings/state"))
            check("missing: no doctor line when there is no CLI to ask", doctor == "", doctor)
        else:
            check(f"{state}: shows Anarlog's own doctor answer", doctor_has in doctor, doctor)
        if state == "unset":
            check("unset: says Anarlog's meetings show once it has run, and every step is one short line",
                  any("once it has run" in s for s in steps) and all(len(s) <= 110 for s in steps), steps)
            check("unset: the doctor line says it isn't ready", "ready: no" in doctor, doctor)
        if state == "empty":
            check("empty: skips the run-it-once step",
                  not any("once it has run" in s for s in steps) and any("show here too" in s for s in steps), steps)
            check("empty: the doctor line names Anarlog's database, clipped to one row",
                  "Application Support/anarlog" in doctor or "/Users/example" in doctor, doctor)
        check(f"{state}: every call was a local read", only_reads(cli) or state == "missing", cli.calls)
        g = osgraph.Graph(":memory:")
        report = AM.meetings(g, ctx, ctx.ids, days=7)
        check(f"{state}: the ingester reports it as a note, never raises",
              report.get("ready") is (state == "empty") and (state == "empty" or "note" in report), report)


def transcript_text(lines) -> str:
    return " ".join(x["text"] for x in value(lines, "/meetings/transcript") or [])


def reading(tmp: Path) -> None:
    cli = FakeAnarlog()
    ctx = world(tmp, cli)
    p = Meetings()
    for state, data, error in (("loading", None, None), ("error", None, "Anarlog meetings failed: x")):
        problems = tks.validate(draw(p, data, error, ctx))
        check(f"{state} draws valid Kyber Lines", not problems, problems)
    data = p.fetch(ctx)
    lines = draw(p, data, None, ctx)
    check("data draws valid Kyber Lines", not tks.validate(lines), tks.validate(lines))
    check("every call is a read, local only, with telemetry pinned off", only_reads(cli), cli.calls)
    check("no control, format or bidi character from a meeting reaches the glass", clean_glass(lines),
          [x for x in lines if BIDI in x or LINE_SEP in x])
    check("on the glass the purpose line is gone: the content says what the panel is for",
          value(lines, "/meetings/purpose") == "", value(lines, "/meetings/purpose"))
    live = value(lines, "/meetings/state")
    check("a meeting with a start and no end is named as recording, at the top, in one calm line",
          live == "Recording · Zeutara wave 2 check-in · 20 min", live)
    check("the counts are two numbers: this week's meetings and the items to look at",
          (value(lines, "/meetings/week"), value(lines, "/meetings/owed")) == (3, 4),
          (value(lines, "/meetings/week"), value(lines, "/meetings/owed")))
    rows = value(lines, "/meetings/rows")
    texts = [r["text"] for r in rows]
    check("the latest meetings, newest first, with when", [r["id"] for r in rows] ==
          ["m-live", "m-amber", "m-tts", "m-old"] and rows[0]["time"] == "20m", rows)
    check("a stranger's email shows as the email, never the name he gave",
          "jonah@zeutara.example" in texts[0] and "Karthik" not in texts[0], texts[0])
    check("a known email shows the people-store name; a bare first name is marked unverified",
          "Sagar Tiwari" in texts[1] and "Tyler (unverified)" in texts[1], texts[1])
    check("the newest meeting is shown before anything is opened", value(lines, "/meetings/head") ==
          "Zeutara wave 2 check-in", value(lines, "/meetings/head"))
    check("the transcript is folded until asked for", value(lines, "/meetings/transcript") == []
          and value(lines, "/meetings/txLabel") == "Transcript", value(lines, "/meetings/transcript"))
    p.transcript(ctx, data, {})
    lines = draw(p, data, None, ctx)
    check("one tap shows its transcript page, read and cleaned, in a Transcript",
          transcript_text(lines) == "Jonah: can you hear me okay", transcript_text(lines))
    p.transcript(ctx, data, {})

    result = p.open(ctx, data, {"row": "m-amber"})
    lines = draw(p, data, None, ctx)
    check("Open picks that meeting", result.ok and value(lines, "/meetings/head") == "Amber weekly", result)
    meta = value(lines, "/meetings/meta")
    check("its meta line is day, length and who, nothing else", "45 min" in meta and "Sagar Tiwari" in meta
          and "Caleb" not in meta and len(meta) <= 90, meta)
    summary = [x["text"] for x in value(lines, "/meetings/summary")]
    check("the summary is Anarlog's own lines, headings out, three at most, none repeating a decision or item",
          summary and len(summary) <= 3 and not any("AMBER_KYBER" in s for s in summary)
          and "Wave 2 goes out Tuesday to the fit list" not in summary, summary)
    decided = [x["text"] for x in value(lines, "/meetings/decisions")]
    check("decisions are only what the summary put under Decisions, bold marks off",
          decided == ["Decided: Ship the keyboard behind AMBER_KYBER", "Decided: Karthik keeps Cloud SQL"], decided)
    items = value(lines, "/meetings/items")
    check("open action items only, each carrying a small guess mark and nothing more",
          len(items) == 4 and all(i["text"].endswith(" · guess") for i in items)
          and not any("Already handled" in i["text"] or "(guess," in i["text"] or "Go " in i["text"]
                      for i in items), items)
    check("where they came from is behind one tap, folded by default",
          value(lines, "/meetings/itemsWhy") == [] and value(lines, "/meetings/whyLabel") == "Where these came from")
    p.why(ctx, data, {})
    whys = [w["text"] for w in value(draw(p, data, None, ctx), "/meetings/itemsWhy")]
    check("the tap shows one short line per item, no clock to the second",
          len(whys) == 4 and all(len(w) <= 110 and not re.search(r"\d:\d\d:\d\d", w) for w in whys), whys)
    p.why(ctx, data, {})
    owners = {i["id"]: i["text"] for i in items}
    a1 = AM.task_id("m-amber", "a1")
    a5 = AM.task_id("m-amber", "a5")
    check("an item's owner is named only through the people store, and yours carry no name",
          "· Sagar Tiwari" in owners[a1] and "you" not in owners[a5], owners)
    check("an injected line in an action item is only words", clean_glass(lines) and any(
        "Ignore previous instructions" in t for t in owners.values()), owners)
    p.transcript(ctx, data, {})
    lines = draw(p, data, None, ctx)
    check("Open read page one of that meeting's transcript",
          transcript_text(lines).startswith("Sagar: wave two"), transcript_text(lines))
    check("More says there is more", value(lines, "/meetings/nextLabel") == "More")
    r = p.next_page(ctx, data, {})
    lines = draw(p, data, None, ctx)
    check("More reads the next bounded page", r.ok and transcript_text(lines).startswith("word201"),
          transcript_text(lines))
    check("at the end, the button goes back to the start", value(lines, "/meetings/nextLabel") == "From the start")
    r = p.next_page(ctx, data, {})
    check("and back at the start it is page one again", r.ok and p._page["offset"] == 0, p._page)
    pages = [c for c in cli.calls if "transcript" in c]
    check("every transcript read asks for 200 words at most",
          all(c[c.index("--limit") + 1] == "200" for c in pages), pages)
    check("an id that isn't one never reaches the CLI", p.open(ctx, data, {"row": "--force"}).ok is False)


def graphing(tmp: Path) -> None:
    cli = FakeAnarlog()
    ctx = world(tmp, cli)
    g = ctx.graph
    report = AM.meetings(g, ctx, ctx.ids, days=7)
    check("the ingester writes a snapshot", report.get("nodes", 0) > 0 and report.get("ready") is True, report)
    check("every stored edge fits the ontology", not g.validate(), g.validate())
    events = {n["props"]["meeting_id"]: n for n in g.nodes("Event")}
    check("one Event per meeting inside the 7-day window, none for the old one",
          set(events) == {"m-live", "m-amber", "m-tts"}, set(events))
    check("the old meeting was never even read in full",
          not any(c[-1] == "m-old" and "get" in c for c in cli.calls), [c for c in cli.calls if "get" in c])
    amber = events["m-amber"]
    check("an Event keeps the summary as one snippet line",
          0 < len(amber["props"]["summary"]) <= osgraph.SNIPPET_CHARS and amber["props"]["folder"] == "Work/Amber",
          amber["props"])
    check("the transcript is never stored", not any("word201" in json.dumps(n) for n in g.nodes()))
    attendees = {n["id"] for n in g.into(amber["id"], "ATTENDS")}
    check("attendees fuse by email through the people store, and the owner was there",
          attendees == {f"person:{fx.SAGAR}", osgraph.ME}, attendees)
    check("a first name with no email is nobody, never Tyler Law or Tyler Larsen",
          not any("Tyler" in n["label"] for n in g.nodes("Person")) and
          f"person:{fx.TYLER_LAW}" not in attendees and f"person:{fx.TYLER_LARSEN}" not in attendees)
    jonah = g.into(events["m-live"]["id"], "ATTENDS")
    stranger = [n for n in jonah if n["id"] != osgraph.ME]
    check("a stranger is an unresolved Person labelled with the raw email, never the name he gave",
          len(stranger) == 1 and stranger[0]["unresolved"] and stranger[0]["label"] == "jonah@zeutara.example",
          stranger)
    tasks = {n["props"]["item_id"]: n for n in g.nodes("Task") if n["props"].get("meeting_id")}
    check("a Task per open action item, none for done ones or meetings outside the window",
          set(tasks) == {"a1", "a2", "a3", "a5"}, set(tasks))
    check("each is a guess with lowered confidence and says so",
          all(t["props"]["guess"] and t["confidence"] == AM.GUESS_CONFIDENCE and
              t["props"]["kind"] == "meeting-action" and "(Anarlog's guess)" in t["props"]["provenance"]
              for t in tasks.values()), [t["props"] for t in tasks.values()])
    check("each keeps its meeting as EXTRACTED_FROM", all(
        [n["id"] for n in g.out(t["id"], "EXTRACTED_FROM")] == [amber["id"]] for t in tasks.values()))
    owed = {k: [n["id"] for n in g.out(t["id"], "OWED_BY")] for k, t in tasks.items()}
    check("OWED_BY only where the CLI names an assignee with an email",
          owed == {"a1": [f"person:{fx.SAGAR}"], "a2": [], "a3": [], "a5": [osgraph.ME]}, owed)
    check("a due action item is due on its day", [n["id"] for n in g.out(tasks["a1"]["id"], "DUE_ON")] ==
          ["day:2026-10-06"])
    check("bidi and line separators are gone from every label",
          not any(BIDI in n["label"] or LINE_SEP in n["label"] for n in g.nodes()))
    lanes = osgraph_walks.tasks(g, {}, fx.NOW)["lanes"]
    check("a guess stays out of the tasks lanes", not any(r["id"] == tasks["a5"]["id"]
                                                          for lane in lanes.values() for r in lane), lanes)
    queue = osgraph_walks.needs_you(g, fx.NOW)["rows"]
    check("and out of the Docket's queue", not any(r["id"] == tasks["a5"]["id"] for r in queue), queue)

    later = AM.build([json.loads(fixture("get_m-amber.json"))["data"]], ctx.ids, fx.NOW + timedelta(days=8))
    check("past the retention window a meeting writes nothing", not any(
        n.type in ("Event", "Task") for n in later.nodes.values()), list(later.nodes))


def promoting(tmp: Path) -> None:
    cli = FakeAnarlog()
    ctx = world(tmp, cli)
    p = Meetings()
    data = p.fetch(ctx)
    p.open(ctx, data, {"row": "m-amber"})
    g = ctx.graph
    before = g.counts()
    r = p.add(ctx, data, {"row": "task:nope"})
    check("a row that isn't an action item adds nothing", not r.ok and g.counts() == before, r)
    a5 = AM.task_id("m-amber", "a5")
    r = p.add(ctx, data, {"row": a5})
    check("Add to tasks says it worked and never quotes the item", r.ok and "Wave 2" not in r.line, r)
    promoted = AM.promoted(g)
    check("it writes one promoted Task in the graph", list(promoted) == [a5], promoted)
    pid = promoted[a5]["id"]
    node = g.node(pid)
    check("the promoted Task is owed by me, still says the words are Anarlog's",
          node["props"]["kind"] == "promise" and "Anarlog's words" in node["props"]["provenance"]
          and [n["id"] for n in g.out(pid, "OWED_BY")] == [osgraph.ME], node)
    check("and keeps its meeting as EXTRACTED_FROM", [n["id"] for n in g.out(pid, "EXTRACTED_FROM")] ==
          [AM.event_id("m-amber")])
    check("every stored edge still fits the ontology", not g.validate(), g.validate())
    lanes = osgraph_walks.tasks(g, {}, fx.NOW)["lanes"]
    check("it is in the Ready lane now", any(x["id"] == pid for x in lanes["ready"]), lanes["ready"])
    queue = osgraph_walks.needs_you(g, fx.NOW)["rows"]
    check("due within 72 hours, it feeds the Docket's queue as a promise",
          any(x["id"] == pid for x in queue), [x["id"] for x in queue])
    r = p.add(ctx, data, {"row": a5})
    check("a second press adds nothing", not r.ok and len(AM.promoted(g)) == 1, r)
    data = p.fetch(ctx)
    lines = draw(p, data, None, ctx)
    items = {i["id"]: i["text"] for i in value(lines, "/meetings/items")}
    check("after a refresh the row says Added, and the count is one fewer",
          items[a5].startswith("Added · ") and value(lines, "/meetings/owed") == 3,
          (items, value(lines, "/meetings/owed")))
    check("a refresh never drops a promoted task", pid in {n["id"] for n in g.nodes("Task")})
    AM.ingest_details(g, [], ctx.ids, fx.NOW + timedelta(days=9), env=ctx.env)
    check("after its meeting leaves the window, the task stays, with a bare Event and no summary",
          g.node(pid) is not None and [n["id"] for n in g.out(pid, "EXTRACTED_FROM")] == [AM.event_id("m-amber")]
          and "summary" not in g.node(AM.event_id("m-amber"))["props"] and not g.validate(), g.validate())
    (tmp / "x").mkdir()
    nograph = world(tmp / "x", FakeAnarlog(), graph=False)
    q = Meetings()
    d2 = q.fetch(nograph)
    check("without a graph, Add says so and writes nothing", not q.add(nograph, d2, {"row": a5}).ok)


def row_limit(tmp: Path) -> None:
    """The panel's row limit is for the glass, not the graph."""
    import surfaces.meetings as SM

    ctx = world(tmp, FakeAnarlog())
    most = SM.MOST_ROWS
    SM.MOST_ROWS = 2
    try:
        data = Meetings().fetch(ctx)
    finally:
        SM.MOST_ROWS = most
    events = {n["props"]["meeting_id"] for n in ctx.graph.nodes("Event")}
    check("two rows on the glass, every meeting in the window in the graph",
          len(data["rows"]) == 2 and events == {"m-live", "m-amber", "m-tts"}, (len(data["rows"]), events))


def through_the_daemon(tmp: Path) -> None:
    cli = FakeAnarlog()
    ctx = world(tmp, cli)
    kinds = surfaces.KINDS
    surfaces.KINDS = kinds + ("meetings",)
    try:
        hud = tks.FakeHud()
        d = tks.ks.Daemon(hud, ctx=ctx, state_path=tmp / "state.json", activity_path=tmp / "activity.jsonl",
                          badges_path=tmp / "badges.json", spaces={}, clock=lambda: 0.0, spawn=lambda fn: fn(),
                          ingest=lambda c: {},
                          make=lambda kind, arg="": Meetings() if kind == "meetings" else surfaces.make(kind, arg))
        d.open_surface("meetings")
        drawn = hud.take()
        check("the daemon draws it valid", not tks.validate(drawn), tks.validate(drawn))
        check("the daemon's lines carry no bidi or line separator", clean_glass(drawn))
        d.handle_line('e action ks-open row="m-amber" surface="meetings"')
        lines = hud.take()
        check("a row's Open press draws that meeting", any(
            x.startswith("d /meetings/head ") and "Amber weekly" in x for x in lines), lines)
        a1 = AM.task_id("m-amber", "a1")
        d.handle_line(f'e action ks-add row="{a1}" surface="meetings"')
        check("Add to tasks through the socket promotes exactly that item", list(AM.promoted(ctx.graph)) == [a1],
              AM.promoted(ctx.graph))
        d.handle_line('e ks-transcript meetings-txBtn surface="meetings"')
        hud.take()
        d.handle_line('e ks-next meetings-next surface="meetings"')
        lines = hud.take()
        check("Next through the socket moves the transcript page", any(
            x.startswith("d /meetings/transcript ") and "word201" in x for x in lines), lines)
        activity = (tmp / "activity.jsonl").read_text()
        check("the activity log records the presses and never a meeting's words",
              '"action": "add"' in activity and "terms one-pager" not in activity and "Amber weekly" not in activity,
              activity)
        check("nothing but reads went to the CLI", only_reads(cli), cli.calls)
    finally:
        surfaces.KINDS = kinds


def helpers() -> None:
    check("clean strips controls, bidi and line separators and keeps the ZWJ",
          AM.clean("a" + BIDI + "b\u2028c\x1bd\u200de\u200bf") == "ab cd\u200def", AM.clean("a" + BIDI + "b\u2028c"))
    check("the CLI path never resolves to the desktop app binary",
          not AM.anarlog_bin({"PATH": "/nonexistent"}, Path("/nonexistent")).endswith("MacOS/anarlog"))
    check("an error envelope raises with Anarlog's own code",
          _raises(lambda: AM.parse(3, "", fixture("error_database_not_found.json"), "x")) == "database_not_found")
    check("doctor's exit 1 with ready:false is an answer",
          AM.parse(1, fixture("doctor_not_ready.json"), "", "x", (0, 1))["data"]["ready"] is False)
    check("a not-installed CLI is its own code", _raises(lambda: AM.parse(127, "", "", "x")) == "not_installed")
    check("a summary's Decisions are found under any heading that says decision",
          AM.decisions({"summaries": [{"markdown": "# Key decisions\n- one\n# Other\n- two"}]}) == ["one"])


def _raises(fn) -> str:
    try:
        fn()
    except AM.AnarlogError as err:
        return err.code
    return ""


def review_fixes(d: Path) -> None:
    """Four leftovers from the 2026-10-05 verifier."""
    cli = FakeAnarlog()
    ctx = world(d, cli)
    g = ctx.graph
    AM.meetings(g, ctx, ctx.ids, days=7)
    guesses = {n["label"] for n in g.nodes("Task") if n["props"].get("guess")}
    days = {e["dst"] for n in g.nodes("Task") if n["props"].get("guess") for e in g.edges(src=n["id"], verb="DUE_ON")}
    shown = set()
    for day in days:
        when = ctx.now().replace(year=int(day[4:8]), month=int(day[9:11]), day=int(day[12:14]))
        shown |= {r.get("label") for r in osgraph_walks.today(g, when)["rows"]}
    check("a guessed action item never draws on Today", days and not (guesses & shown), (days, guesses & shown))
    check("an address with an escape character makes no Person",
          AM.attendee_node(osgraph.Identities(), {"email": "evil\x1b[2J@x.com"}, set()) is None)
    attends = [e for e in g.edges(verb="ATTENDS") if e["src"] != osgraph.ME]
    check("an invite's attendee is a claim, never above CLAIMED_CONFIDENCE",
          attends and all(e["confidence"] <= AM.CLAIMED_CONFIDENCE for e in attends),
          [(e["src"], e["confidence"]) for e in attends])
    sagar = g.node(f"person:{fx.SAGAR}")
    if sagar:
        page = osgraph_walks.person(g, ctx.ids, sagar["label"], ctx.now())
        invited = [r for r in page.get("rows", []) if r.get("why") == "listed on the invite"]
        check("Sagar's page shows an invite-listed meeting as a guess, not as fact",
              invited and all(r.get("confidence", 1.0) <= AM.CLAIMED_CONFIDENCE for r in invited)
              and not any(r.get("why") == "you'll both be there" for r in page.get("rows", [])),
              [(r.get("label"), r.get("why"), r.get("confidence")) for r in page.get("rows", [])])
    err = AM.AnarlogError("no such table: sessions", "anarlog_error")
    check("a database with no tables yet is first run, not an error", AM.first_run(err))
    me = d / "meetings.json"
    me.write_text(json.dumps({"me": ["Caleb@Example.com"]}))
    old = AM.ME_FILE
    AM.ME_FILE = me
    try:
        check("the owner's addresses come from the private file when the env is empty",
              "caleb@example.com" in AM.me_emails({}), AM.me_emails({}))
    finally:
        AM.ME_FILE = old


def glass_bugs(tmp: Path) -> None:
    """Caleb's screenshot of the live panel, 2026-10-11 01:56: health care by
    name on the glass, "&apos;", a zero count, and an empty meeting drawn as
    a stack of empty parts."""
    import surfaces.meetings as SM

    ctx = world(tmp, FakeAnarlog())
    now = fx.NOW

    def row(mid, title, hours, **kw):
        base = {"id": mid, "title": SM.AM.clean(SM.decode(title), 60), "start": now - timedelta(hours=hours),
                "live": False, "length": "", "who": ["Sagar Tiwari"], "summary": [], "decisions": [], "items": [],
                "native": True, "summary_note": "", "has_lines": False, "folder": "", "meeting": {}}
        base["private"] = SM.is_private(title)
        base.update(kw)
        return base

    rows = [row("m1", "Chewbacca", 1), row("m2", "Caleb&apos;s psychiatric intake and medication management", 2),
            row("m3", "Therapy", 3), row("m4", "SHIPPP", 30, summary=["Ship it"])]
    data = {"rows": rows, "capture": {"running": False, "watching": True}, "graph_note": "", "live": None}
    p = Meetings()
    lines = draw(p, data, None, ctx)
    drawn = "\n".join(lines)
    check("health and therapy titles never reach the glass",
          "psychiatric" not in drawn and "Therapy" not in drawn and "medication" not in drawn,
          [x for x in lines if "sychiatric" in x or "Therapy" in x])
    texts = [r["text"] for r in value(lines, "/meetings/rows")]
    check("they read Private, with no names after them", texts[1] == "Private" and texts[2] == "Private", texts)
    check("no HTML entity reaches a row", not any("&apos;" in t or "&amp;" in t for t in texts), texts)
    check("SM.decode turns entities into characters", SM.decode("Caleb&apos;s &amp; co") == "Caleb's & co")
    # The commit review, 2026-10-11: the check and the drawing must read
    # one value. Every one of these drew a medical word and passed before.
    sneaky = ["Caleb&#39;s psych&#x200b;iatric intake", "&#116;&#104;&#101;&#114;&#97;&#112;&#121;",
              "Caleb&amp;#39;s thera&amp;#112;y", "psych\u200diatric intake", "th\u0435rapy",
              "\uff34\uff48\uff45\uff52\uff41\uff50\uff59", "T\u200bherapy", "\u202etherapy",
              "Dr. Kim follow-up", "THERAPY", "t\u0570erapy"]
    leaks = [t for t in sneaky if not SM.is_private(t)]
    check("encoded, zero-width, bidi, full-width and lookalike medical titles are all private", not leaks, leaks)
    check("an ordinary title is not private, lookalike letters and all",
          not SM.is_private("Chewbacca") and not SM.is_private("SHIPPP") and not SM.is_private("\u041ceeting with Ana"))
    check("decode draws what the check read: no zero-width, no entity",
          SM.decode("psych&#x200b;iatric") == "psychiatric" and SM.decode("a&amp;amp;b") == "a&b",
          SM.decode("psych&#x200b;iatric"))
    tricky = [row("x1", "Caleb&#39;s psych&#x200b;iatric intake", 4), row("x2", "th\u0435rapy", 5)]
    trick_lines = draw(Meetings(), {**data, "rows": tricky}, None, ctx)
    trick_texts = [r["text"] for r in value(trick_lines, "/meetings/rows")]
    check("they draw as Private on the glass", trick_texts == ["Private", "Private"], trick_texts)
    check("a zero to-look-at count is not drawn", value(lines, "/meetings/owed") == "", value(lines, "/meetings/owed"))
    check("idle is a dim dot, never a lit word that reads as a call",
          (value(lines, "/meetings/state"), value(lines, "/meetings/stateTone")) == ("Listening", "idle"),
          value(lines, "/meetings/stateTone"))
    rec = draw(p, {**data, "capture": {"running": True, "since": now - timedelta(minutes=4)}}, None, ctx)
    check("recording is the one state in colour, with its word",
          value(rec, "/meetings/stateTone") == "recording" and value(rec, "/meetings/state").startswith("Recording"),
          value(rec, "/meetings/state"))
    rail = value(lines, "/meetings/rows")
    check("the rail names a day only where it changes, and spaces by the gap",
          [r["day"] for r in rail] == ["Today", "", "", "Yesterday"] and rail[3]["gap"] > rail[1]["gap"] > 0,
          [(r["day"], r["gap"]) for r in rail])
    check("the glass is the default and the card is the fallback",
          p.chrome == "glass" and SM.CHROME in ("glass", "card"))
    # Pressing a private meeting opens it as Private with one press to show.
    p.open(ctx, data, {"row": "m2"})
    lines = draw(p, data, None, ctx)
    check("an opened private meeting shows only Private and a Show press",
          value(lines, "/meetings/head") == "Private" and value(lines, "/meetings/revealLabel") == "Show"
          and value(lines, "/meetings/summary") == [] and "psychiatric" not in "\n".join(lines),
          (value(lines, "/meetings/head"), value(lines, "/meetings/revealLabel")))
    p.reveal(ctx, data, {})
    lines = draw(p, data, None, ctx)
    check("Show reveals it in the card, and the list row stays Private",
          "psychiatric" in str(value(lines, "/meetings/head")) and value(lines, "/meetings/rows")[1]["text"] == "Private",
          value(lines, "/meetings/head"))
    p.open(ctx, data, {"row": "m3"})
    check("opening another meeting hides it again", p.revealed == "")
    # A meeting with nothing in it is one quiet line.
    p.open(ctx, data, {"row": "m1"})
    lines = draw(p, data, None, ctx)
    check("an empty meeting is one quiet line and no empty parts",
          value(lines, "/meetings/summary") == [{"id": "s0", "text": SM.EMPTY_LINE}]
          and value(lines, "/meetings/txLabel") == "" and value(lines, "/meetings/itemsCaption") == ""
          and value(lines, "/meetings/whyLabel") == "" and value(lines, "/meetings/transcript") == [],
          [(k, value(lines, f"/meetings/{k}")) for k in ("summary", "txLabel", "whyLabel", "transcript")])
    p.open(ctx, data, {"row": "m4"})
    lines = draw(p, data, None, ctx)
    check("a meeting with a summary and no transcript offers no Transcript press",
          value(lines, "/meetings/summary")[0]["text"] == "Ship it" and value(lines, "/meetings/txLabel") == "",
          value(lines, "/meetings/txLabel"))


def main() -> int:
    helpers()
    for fn in (first_run, reading, graphing, promoting, row_limit, through_the_daemon, review_fixes,
               glass_bugs):
        with tempfile.TemporaryDirectory() as d:
            fn(Path(d))
    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
