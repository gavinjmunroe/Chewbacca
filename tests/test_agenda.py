"""agenda: the sentences that read the calendar aloud with no model, the near
misses that must still go to the model, and the spoken line. The calendar is
stubbed: nothing reads the real one."""
import json
import sys
from datetime import date
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bin" / "lib"))
import agenda  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def main() -> int:
    # Real sentences from the voice log to 2026-10-03, then close variants.
    takes = [
        ("What do I have today?", "today"),
        ("What is my schedule look like this week?", "week"),
        ("What does my week look like", "week"),
        ("What do I have tomorrow", "tomorrow"),
        ("whats on my calendar today", "today"),
        ("OK what's my schedule today", "today"),
    ]
    for said, span in takes:
        got = agenda.parse(said)
        check(f"takes {said!r}", got is not None and got.span == span, got)
    for said in [
        "What do I have today, and move the Otis call to 8",
        "Add call with Otis at 7 PM on Saturday",
        "What do I have to do for ANTH",
        "What is this?",
    ]:
        check(f"leaves {said!r} to the model", agenda.parse(said) is None, agenda.parse(said))

    today = date(2026, 10, 3)
    rows = [
        {"title": "Rylee Lipp's birthday", "start": "2026-10-03T05:00:00Z", "isAllDay": True},
        {"title": "Rylee Lipp’s Birthday", "start": "2026-10-03T05:00:00Z", "isAllDay": True},
        {"title": "Jury duty", "start": "2026-10-05T13:30:00Z", "isAllDay": False},
        {"title": "Call with Otis", "start": "2026-10-03T23:00:00Z", "isAllDay": False},
    ]
    stub = lambda argv: json.dumps(rows)  # noqa: E731
    line = agenda.perform(agenda.Window("today"), run=stub, today=today).line
    check("a birthday in two calendars is said once", line.lower().count("birthday") == 1, line)
    check("today leaves out Monday", "Jury" not in line, line)
    week = agenda.perform(agenda.Window("week"), run=stub, today=today).line
    check("the week names the day", "Jury duty, Monday" in week, week)
    empty = agenda.perform(agenda.Window("tomorrow"), run=lambda argv: "[]", today=today)
    check("an empty day says so", empty.line == "Nothing on the calendar tomorrow.", empty.line)
    broken = agenda.perform(agenda.Window("today"), run=lambda argv: None, today=today)
    check("a failed read is reported as one", not broken.ok, broken)
    many = [{"title": f"E{i}", "start": f"2026-10-03T{14 + i}:00:00Z", "isAllDay": False} for i in range(8)]
    long = agenda.perform(agenda.Window("today"), run=lambda argv: json.dumps(many), today=today).line
    check("past five, the rest is a count", long.endswith("and 3 more."), long)

    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
