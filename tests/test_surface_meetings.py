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
            ("unset", NO_MEETINGS, "database file does not exist"),
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
        steps = [s["text"] for s in value(lines, "/meetings/setup") or []]
        doctor = value(lines, "/meetings/doctor") or ""
        if state == "missing":
            # Caleb, 2026-10-05: "Anarlog shouldn't be it's own app". The
            # first step was "Install Anarlog"; it is now the Start capture press.
            check("missing: the first step is Start capture, never installing a second app",
                  steps and "Start capture" in steps[0] and not any(INSTALL_STEP in s for s in steps), steps)
            check("missing: the button offers Start capture", value(lines, "/meetings/captureLabel") == "Start capture",
                  value(lines, "/meetings/captureLabel"))
            check("missing: no doctor line when there is no CLI to ask", doctor == "", doctor)
        else:
            check(f"{state}: shows Anarlog's own doctor answer", doctor_has in doctor, doctor)
        if state == "unset":
            check("unset: tells a stranger to open Anarlog, allow mic and system audio, and record",
                  any("Open Anarlog" in s for s in steps) and any("Microphone" in s and "System Audio" in s
                                                                    for s in steps)
                  and any("record" in s for s in steps), steps)
            check("unset: the doctor line says it isn't ready", "ready: no" in doctor, doctor)
        if state == "empty":
            check("empty: skips open-once but keeps the permission step, since a database proves no mic access",
                  not any("Open Anarlog" in s for s in steps) and any("Microphone" in s for s in steps)
                  and any("record" in s for s in steps), steps)
            check("empty: the doctor line names the database Anarlog reported",
                  "/Users/example/Library/Application Support/anarlog/app.db" in doctor, doctor)
        check(f"{state}: every call was a local read", only_reads(cli) or state == "missing", cli.calls)
        g = osgraph.Graph(":memory:")
        report = AM.meetings(g, ctx, ctx.ids, days=7)
        check(f"{state}: the ingester reports it as a note, never raises",
              report.get("ready") is (state == "empty") and (state == "empty" or "note" in report), report)


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
    check("the purpose line says what the panel is for",
          any("What your calls said" in x for x in lines if x.startswith("c meetings-purpose")))
    live = value(lines, "/meetings/live")
    check("a meeting with a start and no end is named as recording, at the top",
          live == "Recording now: Zeutara wave 2 check-in, started 20m ago. Anarlog shows no end time yet.", live)
    note = value(lines, "/meetings/note")
    check("the header counts this week's meetings and the items to look at",
          note == "3 meetings this week · 4 action items to look at", note)
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
    check("its transcript page is read and cleaned",
          "Transcript, words 1-6: Jonah: can you hear me okay" == value(lines, "/meetings/transcript"),
          value(lines, "/meetings/transcript"))

    result = p.open(ctx, data, {"row": "m-amber"})
    lines = draw(p, data, None, ctx)
    check("Open picks that meeting", result.ok and value(lines, "/meetings/head") == "Amber weekly", result)
    meta = value(lines, "/meetings/meta")
    check("its meta line has day, time, length, folder and who", "45 min" in meta and "Work/Amber" in meta and
          "Sagar Tiwari" in meta and "Caleb" not in meta.split("with", 1)[-1], meta)
    summary = [x["text"] for x in value(lines, "/meetings/summary")]
    check("the summary is Anarlog's own lines, headings and decisions out",
          summary[:2] == ["Wave 2 goes out Tuesday to the fit list", "Kyber stays opt-in for now"] and
          not any("AMBER_KYBER" in s for s in summary), summary)
    decided = [x["text"] for x in value(lines, "/meetings/decisions")]
    check("decisions are only what the summary put under Decisions, bold marks off",
          decided == ["Decided: Ship the keyboard behind AMBER_KYBER", "Decided: Karthik keeps Cloud SQL"], decided)
    items = value(lines, "/meetings/items")
    check("open action items only, each marked a guess before the press",
          len(items) == 4 and all(i["text"].startswith("(guess) ") for i in items)
          and not any("Already handled" in i["text"] for i in items), items)
    check("the items caption says they are Anarlog's guesses",
          "guesses" in value(lines, "/meetings/itemsCaption"), value(lines, "/meetings/itemsCaption"))
    owners = {i["id"]: i["text"] for i in items}
    a1 = AM.task_id("m-amber", "a1")
    a5 = AM.task_id("m-amber", "a5")
    check("an item's owner is named only through the people store",
          owners[a1].endswith("· Sagar Tiwari") and owners[a5].endswith("· you"), owners)
    check("an injected line in an action item is only words", clean_glass(lines) and any(
        "Ignore previous instructions" in t for t in owners.values()), owners)
    check("Open read page one of that meeting's transcript",
          (value(lines, "/meetings/transcript") or "").startswith("Transcript, words 1-200: Sagar: wave two"),
          value(lines, "/meetings/transcript"))
    check("Next says how far it goes", value(lines, "/meetings/nextLabel") == "Next 200 words")
    r = p.next_page(ctx, data, {})
    lines = draw(p, data, None, ctx)
    check("Next reads the next bounded page", r.ok and (value(lines, "/meetings/transcript") or "").startswith(
        "Transcript, words 201-237: word201"), value(lines, "/meetings/transcript"))
    check("at the end, the button goes back to the start", value(lines, "/meetings/nextLabel") ==
          "Back to the start")
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
    check("after a refresh the row says Added, and the header counts one fewer",
          items[a5].startswith("Added · ") and value(lines, "/meetings/note").endswith("3 action items to look at"),
          (items, value(lines, "/meetings/note")))
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
        d.handle_line('e ks-next meetings-next surface="meetings"')
        lines = hud.take()
        check("Next through the socket moves the transcript page", any(
            x.startswith("d /meetings/transcript ") and "words 201-237" in x for x in lines), lines)
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


def main() -> int:
    helpers()
    for fn in (first_run, reading, graphing, promoting, row_limit, through_the_daemon, review_fixes):
        with tempfile.TemporaryDirectory() as d:
            fn(Path(d))
    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
