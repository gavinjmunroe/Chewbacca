#!/usr/bin/env python3
"""The call pill (CHW-190): who to call, the dial URL, and the pill FaceTime's
tree drives.

Nothing here places a call. A fake `open`, `chewie` (the accessibility layer),
`pgrep` and `lsappinfo` go first on PATH; the fake `open` only writes down what
it was asked to open, and the fake `chewie app` answers from a JSON file that
stands in for FaceTime and changes the way FaceTime would when a control is
pressed (Mute becomes Unmute, End takes the call window away). The people
store is a temp PEOPLE_DIR, checked before anything reads it.

CALL_PILL_TRANSCRIPT=1 prints the end-to-end "call Mark" run: the URL that
would have opened and every line the fake display received.
"""
from __future__ import annotations

import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="call-pill-test-"))
FAKES = TMP / "fakes"
STATE = TMP / "facetime.json"
CALLS_LOG = TMP / "calls.log"
# The environment the fakes need, set only while this file's tests run. Under
# pytest every file is imported before any test runs, so setting it at import
# put a fake `open` and `pgrep` first on PATH for the whole suite (the shape
# tests/conftest.py describes for HOME, 2026-10-05). pytest calls
# setup_module and teardown_module; script mode calls them in __main__.
ENV = dict(
    PEOPLE_DIR=str(TMP / "people"), BOB_DIR=str(TMP / "bob"), CALL_PILL_FAKE=str(STATE),
    CALL_PILL_LOG=str(CALLS_LOG), CALL_PILL_NO_DAEMON="1", CHEWBACCA_CALLS_DB=str(TMP / "no-calls.db"),
    BOB_HUD_SOCKET=str(TMP / "hud.sock"), PATH=f"{FAKES}:{os.environ.get('PATH', '')}",
    SUPERASSISTANT_DIR=str(TMP / "superassistant"), BOB_MEMORY_DIR=str(TMP / "mem"),
)
UNSET = ("PEOPLE_DB", "CALL_PILL_AX", "CALL_PILL_OPEN")
_saved_env: dict[str, str | None] = {}
_saved_path = list(sys.path)

sys.path.insert(0, str(ROOT / "bin" / "lib"))
import call_pill as cp  # noqa: E402


def load_bin(name: str):
    loader = SourceFileLoader(name.replace("-", "_") + "_bin", str(ROOT / "bin" / name))
    spec = spec_from_loader(loader.name, loader)
    module = module_from_spec(spec)
    sys.modules[loader.name] = module
    loader.exec_module(module)
    return module


pill = load_bin("call-pill")
# call-pill put bin/lib on sys.path when it loaded; left there, a later test in
# the same pytest process imports bin/lib's modules in place of its own (the
# `jev` collision in tests/test_call_listen.py, 2026-10-02).
sys.path[:] = _saved_path


def setup_module(_module=None) -> None:
    for key in list(ENV) + list(UNSET):
        _saved_env[key] = os.environ.get(key)
    os.environ.update(ENV)
    for key in UNSET:
        os.environ.pop(key, None)


def teardown_module(_module=None) -> None:
    for key, value in _saved_env.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    sys.path[:] = _saved_path

# ---------------------------------------------------------------- the fakes

FAKE_CHEWIE = r'''#!/usr/bin/env python3
import json, os, sys
state_path = os.environ["CALL_PILL_FAKE"]
log = open(os.environ["CALL_PILL_LOG"], "a")
log.write("chewie " + " ".join(sys.argv[1:]) + "\n"); log.close()
state = json.load(open(state_path))
args = sys.argv[1:]
assert args[0] == "app", args
cmd, rest = args[1], args[2:]
def out(x): print(json.dumps(x)); sys.exit(0)
def fail(msg, code=1): print(json.dumps({"error": msg}), file=sys.stderr); sys.exit(code)
if state.get("untrusted"):
    fail("accessibility is not granted to this process", 2)
if cmd == "windows":
    out(state.get("windows", {}).get(rest[0], []))
if cmd == "see":
    app, wid = rest[0], rest[rest.index("--window") + 1]
    out({"app": app, "window": int(wid), "elements": state.get("elements", {}).get(f"{app}:{wid}", [])})
if cmd == "menu":
    path = [a for a in rest[1:] if a != "--yes"]
    if len(path) == 1:
        out(state.get("menu", {}).get(path[0], []))
    hit = state.get("on_menu", {}).get(" > ".join(path))
    if hit is None:
        fail("no menu item")
    state.update(hit); json.dump(state, open(state_path, "w")); out({"pressed": path})
if cmd == "press":
    app, idx = rest[0], rest[1]
    wid = rest[rest.index("--window") + 1]
    if "--yes" not in rest:
        fail("refused without --yes", 4)
    els = state.get("elements", {}).get(f"{app}:{wid}", [])
    el = next((e for e in els if str(e["i"]) == idx), None)
    if el is None:
        fail("no element")
    hit = state.get("on_press", {}).get(f"{app}:{wid}:{el.get('label')}")
    if hit:
        state.update(hit); json.dump(state, open(state_path, "w"))
    out({"pressed": el, "action": "AXPress"})
fail("unknown " + cmd)
'''

FAKE_OPEN = r'''#!/usr/bin/env python3
import json, os, sys
log = open(os.environ["CALL_PILL_LOG"], "a")
log.write("open " + " ".join(sys.argv[1:]) + "\n"); log.close()
state_path = os.environ["CALL_PILL_FAKE"]
state = json.load(open(state_path))
if sys.argv[1:2] == ["-b"]:
    state["front"] = sys.argv[2]
elif sys.argv[1].startswith(("facetime-audio:", "tel:")):
    state["front"] = "com.apple.FaceTime"
json.dump(state, open(state_path, "w"))
'''

FAKE_PGREP = r'''#!/usr/bin/env python3
import json, os, sys
state = json.load(open(os.environ["CALL_PILL_FAKE"]))
if sys.argv[-1] == "FaceTime" and state.get("running"):
    print(4242); sys.exit(0)
sys.exit(1)
'''

# The window server's owner list: Notification Center is on screen exactly when the fake has a
# banner window for it, so a test with no banner proves the AX tree is never asked.
FAKE_OSASCRIPT = r'''#!/usr/bin/env python3
import json, os, sys
state = json.load(open(os.environ["CALL_PILL_FAKE"]))
print("Dock")
if state.get("windows", {}).get("Notification Center"):
    print("NotificationCenter")
'''

FAKE_LSAPPINFO = r'''#!/usr/bin/env python3
import json, os, sys
state = json.load(open(os.environ["CALL_PILL_FAKE"]))
if sys.argv[1] == "front":
    print("ASN:0x0-0x1:"); sys.exit(0)
print('"CFBundleIdentifier"="%s"' % state.get("front", "com.apple.Terminal"))
'''


def install_fakes() -> None:
    FAKES.mkdir(parents=True, exist_ok=True)
    for name, body in (("chewie", FAKE_CHEWIE), ("open", FAKE_OPEN), ("pgrep", FAKE_PGREP),
                       ("lsappinfo", FAKE_LSAPPINFO), ("osascript", FAKE_OSASCRIPT)):
        path = FAKES / name
        path.write_text(body, encoding="utf-8")
        path.chmod(0o755)


def set_state(**state) -> None:
    state.setdefault("front", "com.apple.Terminal")
    STATE.write_text(json.dumps(state), encoding="utf-8")


def calls_log() -> list[str]:
    try:
        return CALLS_LOG.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []


def reset() -> None:
    CALLS_LOG.unlink(missing_ok=True)
    for f in ("dialed.json", "ask.json", "show"):
        (cp.calls_dir() / f).unlink(missing_ok=True)


# ---------------------------------------------------------------- FaceTime, as data

IDLE_MENU = [{"title": "Mute", "enabled": False, "submenu": False},
             {"title": "Always on Top", "enabled": True, "submenu": False}]


def live_call(who="Mark Lin", timer="0:42", muted=False, end=True):
    els = [{"i": 0, "role": "AXStaticText", "value": who},
           {"i": 1, "role": "AXStaticText", "value": timer},
           {"i": 2, "role": "AXButton", "label": "Unmute" if muted else "Mute", "actions": ["AXPress"]}]
    if end:
        els.append({"i": 3, "role": "AXButton", "label": "End", "actions": ["AXPress"]})
    return dict(
        running=True,
        windows={"FaceTime": [{"window": 101, "title": "FaceTime", "minimized": False}]},
        elements={"FaceTime:101": els},
        menu={"Video": [{"title": "Unmute" if muted else "Mute", "enabled": True, "submenu": False}]},
    )


def with_presses(state: dict, timer: str = "") -> dict:
    """What FaceTime does when its controls are pressed: Mute becomes Unmute,
    and End takes the call window away and disables the menu item."""
    muted = live_call(muted=True, timer=timer)
    idle = dict(running=True, windows={"FaceTime": []}, elements={}, menu={"Video": IDLE_MENU})
    state["on_press"] = {
        "FaceTime:101:Mute": {"elements": muted["elements"], "menu": muted["menu"]},
        "FaceTime:101:Unmute": {"elements": live_call(timer=timer)["elements"], "menu": live_call()["menu"]},
        "FaceTime:101:End": idle,
    }
    return state


def incoming(text="FaceTime Audio", who="+1 (626) 555-0177"):
    return dict(
        running=False,
        windows={"Notification Center": [{"window": 7, "title": "", "minimized": False}]},
        elements={"Notification Center:7": [
            {"i": 0, "role": "AXStaticText", "value": text},
            {"i": 1, "role": "AXStaticText", "value": who},
            {"i": 2, "role": "AXButton", "label": "Accept", "actions": ["AXPress"]},
            {"i": 3, "role": "AXButton", "label": "Decline", "actions": ["AXPress"]},
        ]},
        on_press={"Notification Center:7:Accept": live_call(who="Ava Newton", timer="0:00")},
    )


# ---------------------------------------------------------------- the people store

def make_people(rows: list[tuple], identities: list[tuple] = ()) -> Path:
    path = cp.people_db()
    # The store this test writes has to be the temp one, never ~/.chewbacca.
    assert str(path).startswith(str(TMP)), path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.unlink(missing_ok=True)
    con = sqlite3.connect(path)
    con.executescript("""
        CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, email TEXT,
                             company TEXT, nickname TEXT, deleted_at TEXT);
        CREATE TABLE identities (person_id TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL,
                                 PRIMARY KEY (kind, value));
    """)
    con.executemany("INSERT INTO people (id, name, phone, email, company, nickname) VALUES (?,?,?,?,?,?)", rows)
    con.executemany("INSERT INTO identities VALUES (?,?,?)", identities)
    con.commit()
    con.close()
    return path


ONE_MARK = [("p1", "Mark Lin", "(626) 555-0103", "", "", ""),
            ("p2", "Marky Ramone", "6265550999", "", "", ""),
            ("p3", "Ava Newton", "", "", "", ""),
            ("p4", "Lamark Jones", "6265550444", "", "", "")]
TWO_MARKS = ONE_MARK + [("p5", "Mark Chen", "+1 213 555 0188", "", "USC", "")]


# ---------------------------------------------------------------- a fake display

class FakeLink:
    def __init__(self) -> None:
        self.sent: list[str] = []
        self.inbox: list[str] = []
        self.generation = 1

    def up(self) -> bool:
        return True

    def send(self, lines):
        self.sent += lines
        return True

    def take(self):
        out, self.inbox = self.inbox, []
        return out

    def down(self):
        pass


# ---------------------------------------------------------------- tests

def test_the_people_store_is_the_temp_one():
    assert str(cp.people_db()).startswith(str(TMP)), cp.people_db()
    assert not str(cp.people_db()).startswith(str(Path.home() / ".chewbacca"))


def test_parse_takes_a_name_and_refuses_words_that_are_not_somebody():
    assert cp.parse("call Mark") == cp.Ask("dial", "Mark")
    assert cp.parse("Can you call my mom?") == cp.Ask("dial", "mom")
    assert cp.parse("call Mark on my phone") == cp.Ask("dial", "Mark", "phone")
    assert cp.parse("facetime Tyler Larsen") == cp.Ask("dial", "Tyler Larsen")
    for said in ("call it a day", "call me back", "call history", "call Mark and tell him I'm late",
                 "call 911", "recall the email", ""):
        assert cp.parse(said) is None, said
    assert cp.parse("hang up").verb == "end"
    assert cp.parse("End the call.").verb == "end"
    assert cp.parse("mute the call").verb == "mute"
    assert cp.parse("answer the call").verb == "accept"
    assert cp.parse("show the call").verb == "show"


def test_one_mark_resolves_to_his_card_number_by_whole_name_words():
    make_people(ONE_MARK)
    res = cp.resolve("Mark")
    assert res.callee is not None and res.callee.name == "Mark Lin", res
    assert res.callee.handle == "+16265550103"
    # "Mark" never reaches Marky or Lamark.
    assert not res.options


def test_two_marks_is_a_question_never_a_pick():
    make_people(TWO_MARKS)
    res = cp.resolve("Mark")
    assert res.callee is None
    assert [o.name for o in res.options] == ["Mark Chen", "Mark Lin"]
    assert "Pick one on the glass" in res.line
    # The label someone else might see shows four digits, not the number.
    assert "ending 0188" in res.options[0].label() and "213" not in res.options[0].label()
    assert cp.resolve("Mark Lin").callee.name == "Mark Lin"


def test_no_one_and_no_number_say_so():
    make_people(ONE_MARK)
    assert cp.resolve("Zed").line == "No one called Zed in your people."
    assert cp.resolve("Ava").line == "Ava Newton has no number or email on file."


def test_two_numbers_and_none_on_the_card_is_a_question():
    make_people([("p1", "Sam Rivera", "", "", "", "")],
                [("p1", "phone", "+16265550001"), ("p1", "phone", "(626) 555-0002"),
                 ("p1", "phone", "626-555-0001")])
    res = cp.resolve("Sam")
    assert res.callee is None and len(res.options) == 2, res
    make_people([("p1", "Sam Rivera", "626 555 0002", "", "", "")],
                [("p1", "phone", "+16265550001"), ("p1", "phone", "6265550002")])
    assert cp.resolve("Sam").callee.handle == "+16265550002"


def test_dial_urls():
    c = cp.Callee("p1", "Mark Lin", "+16265550103", "phone")
    assert cp.dial_url(c) == "facetime-audio://+16265550103"
    assert cp.dial_url(c, "phone") == "tel:+16265550103"
    e = cp.Callee("p2", "Sam", "sam+x@example.com", "email")
    assert cp.dial_url(e) == "facetime-audio://sam+x@example.com"
    try:
        cp.dial_url(e, "phone")
        raise AssertionError("an email can't be a phone call")
    except ValueError:
        pass


def test_dry_run_opens_nothing():
    install_fakes()
    reset()
    set_state(running=False)
    make_people(ONE_MARK)
    assert pill.cmd_call("Mark", False, True, True) == 0
    assert calls_log() == [], calls_log()
    assert not cp.dialed_path().exists()


def test_call_opens_the_url_once_and_puts_the_previous_app_back():
    install_fakes()
    reset()
    set_state(running=False, front="com.apple.Notes")
    make_people(ONE_MARK)
    assert pill.cmd_call("Mark", False, False, True) == 0
    opens = [line for line in calls_log() if line.startswith("open ")]
    assert opens == ["open facetime-audio://+16265550103", "open -b com.apple.Notes"], opens
    assert cp.read_json(cp.dialed_path())["name"] == "Mark Lin"


def test_idle_facetime_is_no_call():
    install_fakes()
    reset()
    set_state(running=True, windows={"FaceTime": []}, menu={"Video": IDLE_MENU})
    state = cp.read_state(cp.Ax())
    assert state.kind == "none", state
    assert "Video menu: Mute disabled" in state.evidence


def test_idle_never_asks_notification_center_for_its_tree():
    """Caleb, 2026-10-17: the menu bar shook while the watcher polled Notification Center's AX
    windows every 2 s for 4 days. With no banner on screen it must never be asked."""
    install_fakes()
    reset()
    set_state(running=False, windows={}, menu={})
    for _ in range(5):
        assert cp.read_state(cp.Ax()).kind == "none"
    assert not [c for c in calls_log() if "Notification Center" in c], calls_log()


def test_a_live_call_window_gives_who_timer_mute_and_end():
    install_fakes()
    set_state(**live_call())
    state = cp.read_state(cp.Ax())
    assert state.kind == "live" and state.who == "Mark Lin" and state.timer == "0:42", state
    assert state.muted is False
    assert set(state.controls) == {"mute", "end"}


def test_mute_from_the_menu_only_offers_no_end_button():
    install_fakes()
    set_state(running=True, windows={"FaceTime": []},
              menu={"Video": [{"title": "Unmute", "enabled": True, "submenu": False}]})
    state = cp.read_state(cp.Ax(), dialed_name="Mark Lin")
    assert state.kind == "live" and state.muted is True
    assert [b[0] for b in cp.buttons(state)] == ["mute"]
    assert "End it in FaceTime" in cp.status_line(state, 12)


def test_an_incoming_banner_must_say_facetime():
    install_fakes()
    make_people([("p9", "Ava Newton", "6265550177", "", "", "")])
    set_state(**incoming())
    state = cp.read_state(cp.Ax())
    assert state.kind == "incoming" and state.who == "Ava Newton", state
    set_state(**incoming(text="Messages"))
    assert cp.read_state(cp.Ax()).kind == "none"


def test_the_pill_draws_once_then_ticks_with_data_lines():
    install_fakes()
    reset()
    set_state(**with_presses(live_call(timer="")))
    link = FakeLink()
    w = pill.Watcher(link=link, clock=lambda: 1000.0)
    w.tick(1000.0)
    assert link.sent[0] == "@ call-pill at=top w=340", link.sent
    assert 'c b-mute Button label="Mute" action=call-pill-mute' in link.sent
    assert 'c b-end Button label="End" action=call-pill-end variant=primary' in link.sent
    assert link.sent[-1] == "r s"
    link.sent.clear()
    w.tick(1005.0)
    assert link.sent == ['d /call/status "0:05"'], link.sent


def test_mute_presses_the_real_control_and_shows_what_facetime_says():
    install_fakes()
    reset()
    set_state(**with_presses(live_call(timer="")))
    link = FakeLink()
    w = pill.Watcher(link=link)
    w.tick(1000.0)
    link.inbox.append('e call-pill-mute b-mute surface="call-pill"')
    link.sent.clear()
    w.tick(1001.0)
    assert "chewie app press FaceTime 2 --window 101 --yes" in calls_log(), calls_log()
    assert 'c b-mute Button label="Unmute" action=call-pill-mute' in link.sent, link.sent
    assert 'd /call/status "Muted · 0:01"' in link.sent


def test_escape_hides_the_pill_and_never_ends_the_call():
    install_fakes()
    reset()
    set_state(**with_presses(live_call()))
    link = FakeLink()
    w = pill.Watcher(link=link)
    w.tick(1000.0)
    link.inbox.append("x")
    link.sent.clear()
    w.tick(1001.0)
    w.tick(1002.0)
    assert not any(" press " in line for line in calls_log()), calls_log()
    assert link.sent == [], link.sent
    assert w.state.kind == "live"
    # "show the call" brings it back.
    cp.show_flag().touch()
    w.tick(1003.0)
    assert link.sent and link.sent[0] == "@ call-pill at=top w=340"


def test_the_x_is_the_same_as_escape():
    install_fakes()
    reset()
    set_state(**with_presses(live_call()))
    link = FakeLink()
    w = pill.Watcher(link=link)
    w.tick(1000.0)
    link.inbox.append('e closed call-pill surface="call-pill"')
    w.tick(1001.0)
    assert w.hidden and not any(" press " in line for line in calls_log())


def test_end_presses_end_and_the_pill_leaves_when_the_tree_says_so():
    install_fakes()
    reset()
    set_state(**with_presses(live_call()))
    link = FakeLink()
    w = pill.Watcher(link=link)
    w.tick(1000.0)
    link.inbox.append('e call-pill-end b-end surface="call-pill"')
    link.sent.clear()
    w.tick(1001.0)
    assert "chewie app press FaceTime 3 --window 101 --yes" in calls_log()
    assert link.sent == ["- call-pill"], link.sent
    assert w.state.kind == "none"


def test_accept_on_an_incoming_call():
    install_fakes()
    reset()
    make_people([("p9", "Ava Newton", "6265550177", "", "", "")])
    set_state(**incoming())
    link = FakeLink()
    w = pill.Watcher(link=link)
    w.tick(1000.0)
    assert '@ call-pill at=top w=340' in link.sent and 'd /call/who "Ava Newton"' in link.sent
    assert 'c b-accept Button label="Accept" action=call-pill-accept variant=primary' in link.sent
    link.inbox.append('e call-pill-accept b-accept surface="call-pill"')
    link.sent.clear()
    w.tick(1001.0)
    assert "chewie app press Notification Center 2 --window 7 --yes" in calls_log(), calls_log()
    assert 'c s Screen title="ON A CALL"' in link.sent, link.sent


def test_an_unreadable_tree_keeps_the_pill_and_says_so():
    install_fakes()
    reset()
    set_state(**live_call())
    link = FakeLink()
    w = pill.Watcher(link=link)
    w.tick(1000.0)
    set_state(untrusted=True, running=True)
    link.sent.clear()
    w.tick(1001.0)
    assert w.state.kind == "live"
    assert 'd /call/status "Can\'t read FaceTime right now"' in link.sent, link.sent


def test_two_marks_ask_on_the_glass_and_a_pick_dials_that_one():
    install_fakes()
    reset()
    set_state(running=False)
    make_people(TWO_MARKS)
    assert pill.cmd_call("Mark", False, False, True) == 0
    assert not [line for line in calls_log() if line.startswith("open ")], "asked, so nothing dialed yet"
    link = FakeLink()
    w = pill.Watcher(link=link)
    w.tick(time.time())
    assert '@ call-ask at=top w=360' in link.sent and 'glance call-ask' in link.sent, link.sent
    assert any(line.startswith('c p1 Button label="Mark Lin') for line in link.sent), link.sent
    link.inbox.append('e call-pill-pick p1 surface="call-ask"')
    w.tick(time.time())
    opens = [line for line in calls_log() if line.startswith("open ")]
    assert opens[0] == "open facetime-audio://+16265550103", opens


def test_call_history_ends_a_call_the_tree_stopped_showing():
    install_fakes()
    reset()
    db = Path(os.environ["CHEWBACCA_CALLS_DB"])
    db.unlink(missing_ok=True)
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE ZCALLRECORD (ZDATE REAL)")
    con.commit()
    set_state(**live_call())
    link = FakeLink()
    w = pill.Watcher(link=link)
    w.tick(1_800_000_000.0)
    set_state(untrusted=True, running=True)
    w.tick(1_800_000_001.0)
    w.tick(1_800_000_011.0)
    assert w.state.kind == "live", "no record yet, so the pill stays"
    con.execute("INSERT INTO ZCALLRECORD VALUES (?)", (1_800_000_000.0 - 978307200,))
    con.commit()
    con.close()
    link.sent.clear()
    w.tick(1_800_000_012.0)
    assert w.state.kind == "none" and link.sent == ["- call-pill"], link.sent
    db.unlink()


def test_hud_listen_runs_call_pill_and_never_speaks_a_control():
    from unittest.mock import Mock
    stub = TMP / "call-pill-stub"
    stub.write_text("#!/bin/sh\necho \"$@\" >> \"$CALL_PILL_LOG\"\n"
                    "echo '{\"ok\": true, \"line\": \"Done.\"}'\n", encoding="utf-8")
    stub.chmod(0o755)
    reset()
    loader = SourceFileLoader("hud_listen_for_calls", str(ROOT / "bin" / "hud-listen"))
    module = module_from_spec(spec_from_loader(loader.name, loader))
    sys.modules[loader.name] = module
    loader.exec_module(module)
    module.CALL_PILL = stub
    for said, argv, spoken in (("call Mark", "call Mark --json", True),
                               ("hang up", "press end --json", False),
                               ("mute the call", "press mute --json", False)):
        listener = module.Listener.__new__(module.Listener)
        for method in ("send", "speak", "remember", "settle_unless_running", "log"):
            setattr(listener, method, Mock())
        listener.in_flight = Mock(return_value=False)
        listener.arrival = Mock(return_value=0.0)
        assert listener.call_request(said, typed=False), said
        deadline = time.time() + 10
        while not listener.settle_unless_running.called and time.time() < deadline:
            time.sleep(0.05)
        assert calls_log()[-1] == argv, calls_log()
        assert listener.speak.called is spoken, (said, listener.speak.call_args_list)
    assert module.fast_path("call Mark") == "call"


def serve_display(path: str, got: list[str], stop: threading.Event) -> threading.Thread:
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    Path(path).unlink(missing_ok=True)
    srv.bind(path)
    srv.listen(4)
    srv.settimeout(0.2)

    def loop():
        conns = []
        while not stop.is_set():
            try:
                c, _ = srv.accept()
                c.settimeout(0.05)
                conns.append(c)
            except socket.timeout:
                pass
            for c in conns:
                try:
                    data = c.recv(65536)
                except (socket.timeout, OSError):
                    continue
                got.extend(line for line in data.decode().splitlines() if line)
        srv.close()

    t = threading.Thread(target=loop, daemon=True)
    t.start()
    return t


def test_end_to_end_call_mark_on_a_fake_display():
    """`call-pill call Mark` as a process, then the watcher over a real socket."""
    install_fakes()
    reset()
    set_state(running=False, front="com.apple.Notes")
    make_people(ONE_MARK)
    got: list[str] = []
    stop = threading.Event()
    serve_display(os.environ["BOB_HUD_SOCKET"], got, stop)
    done = subprocess.run([sys.executable, str(ROOT / "bin" / "call-pill"), "call", "Mark", "--json"],
                          capture_output=True, text=True, timeout=30, env=dict(os.environ))
    out = json.loads(done.stdout)
    assert out["ok"] and out["url"] == "facetime-audio://+16265550103", (out, done.stderr)
    # FaceTime picks up: the fake tree now shows the call.
    set_state(**with_presses(live_call(who="Mark Lin", timer="")), front="com.apple.Notes")
    w = pill.Watcher()
    t0 = time.time()
    for t in (t0, t0 + 1, t0 + 2):
        w.tick(t)
    time.sleep(0.4)
    stop.set()
    w.link.down()
    assert any(line.startswith("listen") for line in got), got
    assert "@ call-pill at=top w=340" in got and 'd /call/who "Mark Lin"' in got, got
    assert 'd /call/status "0:02"' in got, got
    if os.environ.get("CALL_PILL_TRANSCRIPT"):
        print("\n--- call-pill call Mark --json")
        print(done.stdout.strip())
        print("--- what the fake opener was asked (nothing dialed)")
        print("\n".join(line for line in calls_log() if line.startswith("open ")))
        print("--- lines the fake display received")
        print("\n".join(got))


if __name__ == "__main__":
    setup_module()
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ok   {name}")
            except AssertionError as err:
                failed += 1
                print(f"  FAIL {name} {err}")
            except Exception as err:  # noqa: BLE001
                failed += 1
                print(f"  ERR  {name} {err.__class__.__name__}: {err}")
    teardown_module()
    print(f"{failed} failed" if failed else "all passed")
    sys.exit(1 if failed else 0)
