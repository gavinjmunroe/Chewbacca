#!/usr/bin/env python3
"""surface_lint refuses the panels Caleb called a wall of text on 2026-10-10
and passes the ones that read at a glance. Run: python3 tests/test_surface_lint.py"""
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bin" / "lib"))
import surface_lint as sl  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


# The meetings panel from his 11:59pm screenshot, as the display received it.
ATROCIOUS = [
    "@ meetings at=right w=420",
    'c s Screen title="MEETINGS"',
    'c sub Text value="What your calls said, and what you owe from them"',
    'c sum Events caption="Meeting at 10:28pm" items=@/sum',
    'c act Events caption="Action items" action=go actionLabel="Go" items=@/acts',
    'c prov Events items=@/prov',
    'c tx Text value=@/tx',
    "> s sub sum act prov tx",
    "d /sum " + json.dumps([{"text": t} for t in [
        "Claude's guess from the transcript:", "Quick sync on the meeting autopilot test.",
        "The team decided to ship the autopilot tonight.", "Caleb will review the meeting autopilot change by Monday.",
        "Gavin needs the granola import notes by Tuesday, and Caleb will send them.",
        "The transcript repeats the same content about three times, likely a capture loop.",
        "Decided: Ship the meeting autopilot tonight."]]),
    "d /acts " + json.dumps([
        {"id": "a1", "text": "(guess) Review the meeting autopilot change · you · Go puts a tentative event on Mon Oct 12, no invitees.", "time": "10-12"},
        {"id": "a2", "text": "(guess) Send Gavin the granola import notes · you · Go puts a tentative event on Tue Oct 13, no invitees.", "time": "10-13"}]),
    "d /prov " + json.dumps([
        {"text": "1. owner you (guess, Claude's pick, no line names them); day Mon Oct 12 (guess, Claude's date, no line says it); from 10:28:28 PM: \"Okay, quick sync on the meeting autopilot test.\""},
        {"text": "2. owner you (guess, Claude's pick, no line names them); day Tue Oct 13, said at 10:28:43 PM; from 10:28:28 PM: \"Okay, quick sync\""}]),
    "d /tx " + json.dumps("Transcript, words 1-88: Okay, quick sync on the meeting autopilot test. We decided to ship the autopilot tonight. Caleb will review the meeting autopilot change by Monday. Gavin needs the granola import notes by Tuesday."),
]
found = sl.lint(ATROCIOUS)
check("the atrocious meetings panel is refused", bool(found), found)
check("it names the plumbing", any("provenance" in f or "second" in f or "word range" in f for f in found), found)
check("and the overlong rows", any("characters (limit" in f for f in found), found)

GOOD = [
    "@ meetings at=right w=420",
    'c s Screen title="MEETINGS"',
    'c n Metric label="Owed" value=@/n',
    'c m Events caption="Today" action=open actionLabel="Open" items=@/m',
    'c tx Transcript items=@/tx',
    "> s n m tx",
    "d /n 2",
    "d /m " + json.dumps([{"id": "m1", "text": "Firm Foundation sync", "time": "Gavin, Caleb · 32 min"},
                          {"id": "m2", "text": "WRIT office hours", "time": "Prof. Chappelow · 15 min"}]),
    "d /tx " + json.dumps([{"text": "word " * 400}]),
]
check("a calm panel passes, and opened-on-purpose text is not counted", sl.lint(GOOD) == [], sl.lint(GOOD))
RUN = ["@ x", 'c s Screen title="X"'] + [f'c t{i} Text value="row {i}"' for i in range(9)]
check("nine text rows with nothing visual between is a wall", any("in a row" in f for f in sl.lint(RUN)), sl.lint(RUN))
BROKEN = RUN[:6] + ['c n Metric label="A" value=1'] + RUN[6:]
check("a number in between breaks the run", not any("in a row" in f for f in sl.lint(BROKEN)), sl.lint(BROKEN))
MENU = ["@ x", 'c s Screen title="X"', 'c pick Select label="Act on" options=@/names value=@/pick',
        "d /names " + json.dumps([f"Option {i} " + "x" * 120 for i in range(12)]), 'd /pick "Option 1"']
check("a Select's closed menu is not on the first view; its value is",
      not any("first view" in f for f in sl.lint(MENU)), sl.lint(MENU))
LONG_PICK = MENU[:-1] + ["d /pick " + json.dumps("y" * 130)]
check("a chosen value that is a wall is still one", any("characters (limit" in f for f in sl.lint(LONG_PICK)),
      sl.lint(LONG_PICK))
PRESSES = RUN[:6] + ['c go Events caption="" items=@/go action=send actionLabel="Send"'] + RUN[6:]
check("an uncaptioned action row is a press and breaks the run",
      not any("in a row" in f for f in sl.lint(PRESSES)), sl.lint(PRESSES))
print("all passed" if not failed else f"{failed} failed")
sys.exit(1 if failed else 0)
