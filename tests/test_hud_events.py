#!/usr/bin/env python3
"""Every Python reader of Kyber's event lines, against the shared fixture the
Swift side writes (tests/fixtures/hud-events.json, checked from Swift by
hud/Tests/KyberKitTests/EventFixtureTests.swift). A row id or a typed message
read back must equal what was sent, and must never add or replace a key.
Run: python3 tests/test_hud_events.py"""
import importlib.machinery
import json
import os
import stat
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import hud_events  # noqa: E402

FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "hud-events.json").read_text(encoding="utf-8"))
PASSED = 0
FAILED = 0


def check(name: str, cond: bool, detail: object = "") -> None:
    global PASSED, FAILED
    if cond:
        PASSED += 1
    else:
        FAILED += 1
        print(f"  FAIL  {name}  {detail!r}")


def surfaces_payload():
    """kyber-surfaces' own reader, if this checkout has it."""
    path = ROOT / "bin" / "kyber-surfaces"
    if not path.exists():
        return None
    module = importlib.machinery.SourceFileLoader("kyber_surfaces", str(path)).load_module()
    return getattr(module, "payload", None)


def test_shared_reader() -> None:
    print("bin/lib/hud_events.py reads every fixture line back exactly")
    for case in FIXTURE["cases"]:
        name, value = case["name"], case["value"]
        row = hud_events.event(case["row_line"])
        check(f"row: {name}", row == {"name": "reply", "component": "reply", "row": value,
                                     "surface": "messages"}, row)
        sent = hud_events.event(case["send_line"])
        check(f"send: {name}", sent == {"name": "send", "component": "send", "row": "s-abc",
                                       "surface": "s-abc", "text": value}, sent)
        for line in (case["row_line"], case["send_line"]):
            check(f"one line: {name}", len(line.splitlines()) == 1, line)


def test_kyber_surfaces_reader() -> None:
    payload = surfaces_payload()
    if payload is None:
        print("kyber-surfaces not in this checkout; skipped")
        return
    print("kyber-surfaces' payload() reads every fixture line back exactly")
    for case in FIXTURE["cases"]:
        rest = case["row_line"].split(None, 3)[3]
        got = payload(rest)
        check(f"kyber-surfaces row: {case['name']}", got == {"row": case["value"], "surface": "messages"}, got)


def test_kyber_sessions_reader() -> None:
    print("kyber-sessions reads through the shared reader")
    ks = importlib.machinery.SourceFileLoader("kyber_sessions", str(ROOT / "bin" / "kyber-sessions")).load_module()
    for case in FIXTURE["cases"]:
        got = ks.parse_event(case["send_line"])
        check(f"kyber-sessions send: {case['name']}", got and got["text"] == case["value"]
              and got["surface"] == "s-abc", got)


def legacy(value: str) -> str:
    """The encoding before 2026-10-04: bare unless it held whitespace, a quote
    or a backslash."""
    if value and not any(c.isspace() or c in '"\\' for c in value):
        return value
    return json.dumps(value)


def test_legacy_fails() -> None:
    print("the old encoding fails the same readers")
    broken = []
    for case in FIXTURE["cases"]:
        line = f"e action reply row={legacy(case['value'])} surface=messages"
        got = hud_events.event(line)
        if not got or got.get("row") != case["value"]:
            broken.append(case["name"])
    check("an id of true came back as a bool or not at all", "word true" in broken, broken)
    check("an id of 42 came back as a number or not at all", "number-looking" in broken, broken)


def test_refusals() -> None:
    print("anything that is not words then key=value pairs is refused whole")
    for line in [
        'e action reply row="x" surface="messages" row="y"',      # a second row
        'e action reply row="x"surface="evil"',                   # a value running into a key
        'e action reply row=x surface="messages"',               # a bare value
        'e action reply row="x" stray surface="messages"',        # a word after a key
        'e act"ion reply row="x"',                                # a quote in a word
    ]:
        check(f"refused: {line}", hud_events.event(line) is None, hud_events.event(line))
    check("a plain press", hud_events.event('e go b surface="notes"') ==
          {"name": "go", "component": "b", "surface": "notes"})


def test_listen_line() -> None:
    print("listen presents the token when it can be read")
    with tempfile.TemporaryDirectory() as d:
        sock = str(Path(d) / "hud.sock")
        check("no token file is a plain listen", hud_events.listen_line(sock) == "listen")
        token = "ab" * 32
        path = Path(d) / "hud.token"
        path.write_text(token)
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
        check("the token is presented", hud_events.listen_line(sock) == f"listen token={token}")
        path.write_text("not a token\nlisten")
        check("a malformed token is not passed on", hud_events.listen_line(sock) == "listen")


def main() -> int:
    test_shared_reader()
    test_kyber_surfaces_reader()
    test_kyber_sessions_reader()
    test_legacy_fails()
    test_refusals()
    test_listen_line()
    print(f"{PASSED} passed, {FAILED} failed")
    return 1 if FAILED else 0


def test_all() -> None:
    assert main() == 0


if __name__ == "__main__":
    sys.exit(main())
