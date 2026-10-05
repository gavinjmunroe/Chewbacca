#!/usr/bin/env python3
"""kyber-surfaces: every surface draws valid Kyber Lines for loading, data,
empty and error; a refresh sends only `@` and `d`; nothing a message SAYS ever
reaches an action; a press is the only way anything is sent, and a sent reply
is read back; rows pivot to their node's walk; spaces persist; the badge is
written; and the daemon speaks the socket protocol against a fake display.

Fixture world from tests/surfaces_fixture.py and a fake display. No real
socket to Kyber, no real Messages, nothing sent.
"""
import json
import os
import re
import socket
import sys
import tempfile
import threading
import time
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import surfaces_fixture as fx  # noqa: E402

import osgraph  # noqa: E402
import surfaces  # noqa: E402
from surfaces import Context  # noqa: E402

BIN = fx.ROOT / "bin" / "kyber-surfaces"
loader = SourceFileLoader("kyber_surfaces", str(BIN))
ks = module_from_spec(spec_from_loader("kyber_surfaces", loader))
loader.exec_module(ks)

COMPONENTS = {"Screen", "Stack", "Heading", "Text", "List", "Metric", "Table", "Status", "Sparkline", "Bars",
              "Ring", "Events", "Diagram", "File", "Button", "Field", "Select", "Checkbox"}
ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
PROP = re.compile(r'(\w+)=("(?:[^"\\]|\\.)*"|\S+)')

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


class FakeHud:
    def __init__(self):
        self.lines: list[str] = []

    def send(self, lines):
        for line in lines:
            # One op per line, or a message could forge the next op.
            assert "\n" not in line and "\r" not in line, line
            self.lines.append(line)
        return True

    def take(self):
        out, self.lines = self.lines, []
        return out


def validate(lines: list[str]) -> list[str]:
    """Problems with a surface's drawing, by the grammar in hud/CLAUDE.md."""
    problems, made, bound, data = [], set(), set(), set()
    roots = []
    for line in lines:
        op = line.split(" ", 1)[0]
        if op not in ("@", "c", ">", "r", "d", "-"):
            problems.append(f"unknown op: {line[:40]}")
            continue
        if op == "c":
            parts = line.split(" ", 3)
            if len(parts) < 3 or not ID.match(parts[1]) or parts[2] not in COMPONENTS:
                problems.append(f"bad component: {line[:60]}")
                continue
            made.add(parts[1])
            for key, raw in PROP.findall(parts[3] if len(parts) > 3 else ""):
                if raw.startswith("@/"):
                    bound.add(raw[1:])
                    continue
                try:
                    value = json.loads(raw)
                except json.JSONDecodeError:
                    problems.append(f"{parts[1]}.{key} is not JSON: {raw[:30]}")
                    continue
                if isinstance(value, (list, dict)) and " " in raw.replace('" "', ""):
                    if re.search(r'[\[,{:]\s', raw):
                        problems.append(f"{parts[1]}.{key} has a space inside an array")
        elif op == ">":
            for cid in line.split()[1:]:
                if cid not in made:
                    problems.append(f"> names {cid} before or without a c")
        elif op == "r":
            roots.append(line.split()[1])
        elif op == "d":
            _, pointer, raw = line.split(" ", 2)
            try:
                json.loads(raw)
            except json.JSONDecodeError:
                problems.append(f"d {pointer} is not JSON")
            data.add(pointer)
    if lines and not roots:
        problems.append("no r: nothing would paint")
    for root in roots:
        if root not in made:
            problems.append(f"r names {root}, which was never made")
    for pointer in bound - data:
        problems.append(f"{pointer} is bound but never set")
    return problems


def make_daemon(ctx, tmp: Path):
    hud = FakeHud()
    d = ks.Daemon(hud, ctx=ctx, state_path=tmp / "state.json", activity_path=tmp / "activity.jsonl",
                  badges_path=tmp / "badges.json", spaces=dict(ks.DEFAULT_SPACES), clock=lambda: 0.0,
                  spawn=lambda fn: fn(), ingest=lambda c: {})
    return d, hud


def drawing(tmp: Path) -> None:
    g, ctx, run, _ = fx.world(tmp)
    d, hud = make_daemon(ctx, tmp)
    specs = [("needs-you", ""), ("today", ""), ("tasks", ""), ("people", ""), ("conversations", ""),
             ("person", "Sagar Tiwari"), ("space", "amber"), ("music", ""), ("files", "")]
    for kind, arg in specs:
        provider = surfaces.make(kind, arg) if arg else surfaces.make(kind)
        name = provider.name
        hud.take()
        live = ks.Live(provider, kind, arg, provider.region)
        d.open[name] = live
        d.draw(live, full=True)
        first = hud.take()
        check(f"{name}: loading draws valid ops", validate(first) == [], validate(first)[:3])
        loading = provider.model(None, None, {}, ctx)
        note = loading.get(provider.p("caption")) or loading.get(provider.p("note")) or loading.get(
            provider.p("track"))
        check(f"{name}: loading says so", note == "Loading…", note)
        d.refresh(name)
        after = hud.take()
        check(f"{name}: a refresh sends only @ and d", bool(after) and all(
            line.startswith(("@ ", "d ")) for line in after) and after[0] == f"@ {name}", after[:3])
        check(f"{name}: the data model after a refresh is still valid", validate(first + after) == [],
              validate(first + after)[:3])
        d.refresh(name)
        check(f"{name}: an unchanged refresh sends nothing", hud.take() == [])
        err = provider.model(live.data, "Calendar: access is off.", live.values, ctx)
        check(f"{name}: an error keeps the last data and says it", any(
            "Couldn't refresh" in str(v) or "access is off" in str(v) for v in err.values()), list(err.values())[:2])
        del d.open[name]
    # Empty and failed worlds.
    empty = Context(run=fx.FakeRun(), now=lambda: fx.NOW, env={"KYBER_SURFACES_DOWNLOADS": str(tmp / "nothing")})
    empty.graph = osgraph.Graph(":memory:")
    empty.ids = osgraph.Identities(tmp / "no-people.db")
    empty.runs = lambda: {}
    for kind in ("needs-you", "today", "tasks", "conversations", "people"):
        p = surfaces.make(kind)
        data = p.fetch(empty)
        note = p.model(data, None, {}, empty)[p.p("caption")]
        check(f"{kind}: empty says what is true", bool(note) and note != "Loading…", note)
    broken = Context(run=fx.FakeRun(), now=lambda: fx.NOW)
    try:
        surfaces.make("needs-you").fetch(broken)
        check("no graph is an error the panel can show", False)
    except surfaces.SurfaceError as e:
        check("no graph is an error the panel can show", "graph" in str(e), str(e))
    (tmp / "nothing").mkdir(exist_ok=True)
    f = surfaces.make("files")
    check("files: an empty Downloads says so",
          f.model(f.fetch(empty), None, {}, empty)[f.p("note")] == "Downloads is empty.")


def safety(tmp: Path) -> None:
    g, ctx, run, _ = fx.world(tmp)
    d, hud = make_daemon(ctx, tmp)
    d.open_surface("needs-you")
    d.open_surface("conversations")
    lines = hud.take()
    joined = "\n".join(lines)
    check("the injection is drawn as words inside a d line",
          any(line.startswith("d ") and "Ignore previous instructions" in line for line in lines)
          or "Ignore previous" not in joined)
    check("no line on the wire begins with e, whatever a message said",
          not any(line.startswith("e ") for line in joined.split("\n")))
    # The same words arriving FROM the display as speech, or as an action on a
    # component that isn't ours, do nothing.
    d.handle_line('h "' + fx.INJECTION.replace("\n", " ") + '"')
    d.handle_line('e ks-act somebody-elses-go row="thread:imessage:+13105550105"')
    d.handle_line('e send needs-you-go')
    check("speech, foreign components and non-ks actions never act", run.sent == [], run.sent)
    # Picking the injected thread and pressing Go with no reply typed sends nothing.
    data = d.open["needs-you"].data
    check("the injected thread is not on needs-you at all",
          not any(r["id"] == "thread:imessage:+13105550105" for r in data["rows"]))

    # A real press: pick Sagar's thread, type, press.
    sagar = next(r for r in data["rows"] if r["id"] == "thread:imessage:+16305550101")
    d.handle_line(f'v /needs-you/pick {json.dumps(sagar["pick"])}')
    d.handle_line("e ks-act needs-you-go")
    check("Go with no reply typed sends nothing", run.sent == [], run.sent)
    d.handle_line('v /needs-you/draft "On it, Monday works"')
    hud.take()
    d.handle_line("e ks-act needs-you-go")
    check("one press sends exactly one text, to the thread's own handle",
          run.sent == [["mac", "messages", "send", "+16305550101", "On it, Monday works", "--json"]], run.sent)
    check("the send was read back from the thread",
          any(c[:3] == ["mac", "messages", "history"] for c in run.calls))
    out = hud.take()
    check("the panel says it landed and clears the draft",
          any("It's in the thread" in line for line in out) and 'd /needs-you/draft ""' in out, out)
    log = (tmp / "activity.jsonl").read_text()
    check("the activity log has the action and outcome, never the body",
          '"action": "act"' in log and "Monday works" not in log, log)
    mail = next(r for r in d.open["needs-you"].data["rows"] if r["type"] == "MailItem") \
        if any(r["type"] == "MailItem" for r in d.open["needs-you"].data["rows"]) else None
    if mail:
        d.handle_line(f'v /needs-you/pick {json.dumps(mail["pick"])}')
        d.handle_line('v /needs-you/draft "Sounds right"')
        d.handle_line("e ks-act needs-you-go")
        check("a mail row makes a draft and sends nothing",
              any(c[:3] == ["mac", "mail", "draft"] for c in run.calls) and len(run.sent) == 1, run.sent)
    # Pivot: a row press opens that node's own walk.
    d.handle_line(f"e action ks-pivot row=person:{fx.SAGAR} surface=needs-you")
    check("a row press (hud/CLAUDE.md row-action contract) opens that person's walk",
          f"person-{fx.SAGAR}" in d.open, list(d.open))
    d.handle_line('e action ks-pivot row="space:amber" surface=needs-you')
    check("a JSON-quoted row id works too, and a space chip opens the space", "space-amber" in d.open,
          list(d.open))
    d.handle_line("e action ks-pivot row=person:nobody surface=not-open")
    check("a row press for a surface that isn't open does nothing", "person-nobody" not in d.open)
    d.handle_line("e ks-act needs-you-go surface=conversations")
    check("a press is routed by its component id, whatever surface= says, and an empty draft sends nothing",
          len(run.sent) == 1, run.sent)
    # Tasks Go hands off to an agent run (stubbed), and nothing is sent.
    started = []
    ctx.start_run = lambda task: started.append(task) or {"id": "r1"}
    d.open_surface("tasks")
    d.handle_line("e ks-act tasks-go")
    check("tasks Go starts one run for the picked task and sends nothing",
          len(started) == 1 and len(run.sent) == 1, (started, run.sent))
    ctx.ingest_errors = {"calendar": "Calendar: access is off. Run `mac doctor` to see the switch."}
    d.open_surface("today")
    check("a failed source is named on the surface that stands on it",
          "access is off" in d.open["today"].sent.get("/today/caption", ""), d.open["today"].sent.get("/today/caption"))
    check("and not on one that doesn't", "access is off" not in d.open["tasks"].sent.get("/tasks/caption", ""))
    badges = ks.Daemon.write_badges(d) or json.loads((tmp / "badges.json").read_text())
    check("the needs-you count is written for the badge", badges.get("needsYou", 0) >= 6, badges)
    check("the needs-you surface carries the badge in its data", any(
        line.startswith("d /badges/needsYou ") for line in joined.split("\n")))


def files_and_music(tmp: Path) -> None:
    g, ctx, run, _ = fx.world(tmp)
    downloads = Path(ctx.env["KYBER_SURFACES_DOWNLOADS"])
    (downloads / "notes.txt").write_text("hi")
    (downloads / "Installer.pkg").write_text("x")
    os.utime(downloads / "Installer.pkg", (time.time() + 5, time.time() + 5))
    d, hud = make_daemon(ctx, tmp)
    d.open_surface("files")
    d.handle_line("e ks-open files-open")
    opened = [c for c in run.calls if c[0] == "open"]
    check("Open reveals a runnable download instead of running it", opened and opened[-1][1] == "-R", opened)
    d.handle_line('v /files/pick "notes.txt"')
    check("picking another file moves the preview", any(
        line.startswith("d /files/path ") and "notes.txt" in line for line in hud.take()))
    d.handle_line("e ks-open files-open")
    check("Open opens an ordinary file", run.calls[-1][:1] == ["open"] and run.calls[-1][1].endswith("notes.txt"))
    d.open_surface("music")
    m = d.open["music"]
    check("music reads the player", m.data["now"]["track"] == "make heaven crowded" and m.data["now"]["paused"])
    d.handle_line("e ks-toggle music-toggle")
    check("Play on a paused song resumes it", any(c[-1] == "resume" for c in run.calls))
    check("the activity log records the music command", '"surface": "music"' in (tmp / "activity.jsonl").read_text())


def spaces_and_state(tmp: Path) -> None:
    g, ctx, run, _ = fx.world(tmp)
    d, hud = make_daemon(ctx, tmp)
    msg = d.open_space("school")
    check("a space opens its walk and its surfaces together",
          set(d.open) == {"space-school", "today", "files"}, (msg, list(d.open)))
    regions = [s.region for s in d.open.values()]
    check("no two surfaces share a region", len(regions) == len(set(regions)), regions)
    d.open_surface("music")
    d.open_space("amber")
    check("switching spaces closes what the new one does not hold",
          "music" not in d.open and "space-amber" in d.open, list(d.open))
    d.open_space("school")
    check("coming back restores what was open in that space, music included",
          set(d.open) == {"space-school", "today", "files", "music"}, list(d.open))
    d2, _ = make_daemon(ctx, tmp)
    d2.restore()
    check("a restarted daemon reopens the same surfaces", set(d2.open) == set(d.open), list(d2.open))
    d.handle_line("x")
    check("the display's clear (x) closes everything and remembers that",
          d.open == {} and json.loads((tmp / "state.json").read_text())["open"] == {})
    check("an unknown space is refused", d.open_space("mars").startswith("No space"))
    check("a person surface needs a name", d.open_surface("person").startswith("No surface called person"))


def socket_protocol(tmp: Path) -> None:
    """The real HudLink against a fake display on a temp socket."""
    g, ctx, run, _ = fx.world(tmp)
    path = str(tmp / "hud.sock")
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(path)
    server.listen(1)
    got: list[str] = []
    conn_box = {}

    def accept():
        conn, _ = server.accept()
        conn_box["c"] = conn
        buf = b""
        conn.settimeout(5)
        try:
            while True:
                chunk = conn.recv(65536)
                if not chunk:
                    break
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    got.append(line.decode())
        except OSError:
            pass

    threading.Thread(target=accept, daemon=True).start()
    link = ks.HudLink(path)
    d = ks.Daemon(link, ctx=ctx, state_path=tmp / "s.json", activity_path=tmp / "a.jsonl",
                  badges_path=tmp / "b.json", spaces=dict(ks.DEFAULT_SPACES), spawn=lambda fn: fn(),
                  ingest=lambda c: {})
    link.daemon = d
    threading.Thread(target=link.loop, daemon=True).start()
    deadline = time.time() + 5
    while not got and time.time() < deadline:
        time.sleep(0.05)
    check("the daemon subscribes with listen first", got[:1] == ["listen"], got[:2])
    d.open_surface("needs-you")
    before = len(got)
    d.refresh("needs-you")
    time.sleep(0.2)
    check("a refresh over the socket is @ and d only", all(x.startswith(("@ ", "d ")) for x in got[before:]),
          got[before:before + 3])
    data = d.open["needs-you"].data
    sagar = next(r for r in data["rows"] if r["id"] == "thread:imessage:+16305550101")
    conn = conn_box["c"]
    conn.sendall(f'v /needs-you/pick {json.dumps(sagar["pick"])}\nv /needs-you/draft "yes"\n'
                 f'e ks-act needs-you-go\n'.encode())
    deadline = time.time() + 5
    while not run.sent and time.time() < deadline:
        time.sleep(0.05)
    check("a Button press arriving over the socket sends the reply", run.sent and run.sent[0][4] == "yes", run.sent)
    server.close()


def listener_ignores_surface_actions() -> None:
    """hud-listen hands an unknown `e` to the model as a request; the
    surfaces' own presses must not become model turns."""
    from unittest.mock import Mock
    os.environ.setdefault("BOB_DIR", tempfile.mkdtemp())
    os.environ.setdefault("SUPERASSISTANT_DIR", tempfile.mkdtemp())
    listen_path = fx.ROOT / "bin" / "hud-listen"
    loader = SourceFileLoader("hud_listen_for_surfaces", str(listen_path))
    m = module_from_spec(spec_from_loader("hud_listen_for_surfaces", loader))
    sys.modules["hud_listen_for_surfaces"] = m
    loader.exec_module(m)
    listener = m.Listener.__new__(m.Listener)
    listener.log = Mock()
    listener.ask = Mock()
    for line in ("e action ks-pivot row=person:x surface=needs-you", "e ks-act needs-you-go surface=needs-you"):
        listener.handle(line)
    check("hud-listen never asks the model about a surface's own press", not listener.ask.called,
          listener.ask.call_args_list)


def payload_parse() -> None:
    check("payload reads row and collection as JSON",
          ks.payload('collection="x" row="person:p 1"') == {"collection": "x", "row": "person:p 1"},
          ks.payload('collection="x" row="person:p 1"'))


def main() -> int:
    payload_parse()
    listener_ignores_surface_actions()
    for fn in (drawing, safety, files_and_music, spaces_and_state, socket_protocol):
        with tempfile.TemporaryDirectory() as d:
            fn(Path(d))
    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
