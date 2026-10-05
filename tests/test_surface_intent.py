#!/usr/bin/env python3
"""surface_intent: the sentences that open or close a live surface with no
model, and the near misses that must still reach the model. The person
resolver and the CLI are stubbed: nothing reads the real graph or opens."""
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bin" / "lib"))
import surface_intent as si  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


KNOWN = {"Karthik": "person:p-karthik", "Sagar Tiwari": "person:p-sagar"}


def resolver(name):
    return KNOWN.get(name)


def main() -> int:
    takes = [
        ("Show my day", "open", "today", ""),
        ("show me my calendar", "open", "today", ""),
        ("Pull up my schedule on the screen", "open", "today", ""),
        ("What do I need to do?", "open", "needs-you", ""),
        ("What's up", "open", "needs-you", ""),
        ("what should I look at", "open", "needs-you", ""),
        ("Open my texts", "open", "conversations", ""),
        ("open messages", "open", "conversations", ""),
        ("Check my inbox", "open", "conversations", ""),
        ("check my mail", "open", "conversations", ""),
        ("show my tasks", "open", "tasks", ""),
        ("show my to do list", "open", "tasks", ""),
        ("show my people", "open", "people", ""),
        ("What's playing?", "open", "music", ""),
        ("show downloads", "open", "files", ""),
        ("Pull up my recent files", "open", "files", ""),
        ("Show me Karthik", "open", "person", "person:p-karthik"),
        ("Pull up Sagar Tiwari", "open", "person", "person:p-sagar"),
        ("open my school space", "space", "school", ""),
        ("switch to amber", "space", "amber", ""),
        ("Chewbacca mode", "space", "chewbacca", ""),
        ("close my texts", "close", "conversations", ""),
        ("hide the tasks", "close", "tasks", ""),
        ("close everything", "close", "all", ""),
        ("Kyber, show my day please", "open", "today", ""),
        ("show my agents", "open", "agents", ""),
        ("pull up my claude sessions", "open", "agents", ""),
        ("open the coding agents", "open", "agents", ""),
        ("close the agents", "close", "agents", ""),
    ]
    for said, verb, name, arg in takes:
        got = si.parse(said, resolve_person=resolver)
        check(f"takes {said!r}", got is not None and (got.verb, got.name, got.arg) == (verb, name, arg), got)

    refuses = [
        # A second half no surface does.
        "show my texts from Sam and reply that I'm late",
        "open my texts and tell Karthik I'm running late",
        # Spoken aloud by agenda.py, not drawn.
        "What do I have today",
        # Not a person: lowercase, an app, two people, nobody.
        "show me the weather",
        "Open Google Sheets",
        "Show me Tyler",
        "Show me Zendaya",
        "Open Terminal",
        # Music verbs belong to hud-music.
        "Play Blinding Lights",
        "pause",
        # Too loose to be a space.
        "open my work",
        # A question about a surface is a question.
        "why did my tasks close",
        # Too loose for the agents panel: kyber-sessions, and a person.
        "show my sessions",
        "Show me Claude",
        "show my agents and tell the lemma one to run the tests",
        "",
    ]
    for said in refuses:
        got = si.parse(said, resolve_person=resolver)
        check(f"refuses {said!r}", got is None, got)

    calls = []

    class Done:
        def __init__(self, code=0, out=""):
            self.returncode, self.stdout = code, out

    def fake(argv, **kw):
        calls.append(argv)
        if argv[0].endswith("hud-music"):
            return Done(0, "Danielle by Fred again.., on Spotify.\n")
        return Done(0)

    out = si.perform(si.Command("open", "person", "person:p-karthik"), run=fake)
    check("a person opens through the CLI with its node id", calls[-1][1:] == ["open", "person", "person:p-karthik"]
          and out.ok, calls[-1])
    out = si.perform(si.Command("open", "music"), run=fake)
    check("what's playing says the song as well as opening the player", out.line.startswith("Danielle"), out)
    out = si.perform(si.Command("open", "today"), run=lambda argv, **kw: Done(1))
    check("a failed open says so instead of claiming it", not out.ok and "didn't" in out.line, out)
    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
