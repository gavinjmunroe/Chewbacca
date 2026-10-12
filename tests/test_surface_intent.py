#!/usr/bin/env python3
"""surface_intent: the sentences that open or close a live surface with no
model, and the near misses that must still reach the model. The person
resolver and the CLI are stubbed: nothing reads the real graph or opens."""
import os
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bin" / "lib"))
# The card path: with Realm's interface built on this Mac, "show my agents"
# opens it instead (tests/test_realm_ui.py covers that). Pinned so the answer
# does not depend on what is in ~/.chewbacca.
os.environ["CHEWBACCA_REALM_UI_HOME"] = tempfile.mkdtemp(prefix="no-realm-ui-")
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
        ("What's up today", "open", "needs-you", ""),
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
        # A folder on the glass, Kyber's own `disk` surface (CHW-198).
        ("show me files", "panel", "files", ""),
        ("files", "panel", "files", ""),
        ("Open Finder", "panel", "files", ""),
        ("open the file manager", "panel", "files", ""),
        ("close the file manager", "panel", "files", "off"),
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
        ("show my sessions", "open", "agents", ""),
        ("pull up my tabs", "open", "agents", ""),
        ("show the realm sessions", "open", "agents", ""),
        ("close the agents", "close", "agents", ""),
        ("Start an agent in lemma to write the README for v2.", "task", "write the README for v2", "lemma"),
        ("new task: summarize my week", "task", "summarize my week", ""),
        ("Kyber, spin up a tab that fixes the 3 failing tests", "task", "fixes the 3 failing tests", ""),
        ("stop the lemma agent", "stop", "lemma", ""),
        ("kill the readme task", "stop", "readme", ""),
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
        # Not an agent: music, a timer, a browser tab, nothing to do.
        "stop the music",
        # Said aloud by hud-listen's agent summary instead.
        "what are my agents doing",
        "start a timer for 5 minutes",
        "open a new tab to google.com",
        "launch a new claude",
        # Too loose for the agents panel: a person.
        "Show me Claude",
        "show my agents and tell the lemma one to run the tests",
        # A greeting, answered by hud-listen's pleasantry (CHW-184).
        "What's up",
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
    out = si.perform(si.Command("panel", "files"), run=fake)
    check("files opens through `hud files`, not kyber-surfaces",
          calls[-1][0].endswith("/hud") and calls[-1][1:] == ["files"] and out.ok, calls[-1])
    out = si.perform(si.Command("panel", "files", "off"), run=fake)
    check("closing files sends `hud files off`", calls[-1][1:] == ["files", "off"] and out.ok, calls[-1])
    out = si.perform(si.Command("open", "today"), run=lambda argv, **kw: Done(1))
    check("a failed open says so instead of claiming it", not out.ok and "didn't" in out.line, out)
    before = len(calls)
    asked = []
    out = si.perform(si.Command("open", "realm"), run=fake, ask=lambda body: asked.append(body) or {"ok": True})
    check("an open goes straight to the running daemon's socket, no CLI start",
          out.ok and asked == [{"cmd": "open", "name": "realm", "arg": ""}] and len(calls) == before, (asked, calls[before:]))
    out = si.perform(si.Command("close", "realm"), run=fake, ask=lambda body: asked.append(body) or {"ok": True})
    check("a close does too", out.ok and asked[-1]["cmd"] == "close" and len(calls) == before, asked)
    out = si.perform(si.Command("open", "realm"), run=fake, ask=lambda body: None)
    check("with no daemon answering it falls back to the CLI, which starts one",
          out.ok and calls[-1][1:] == ["open", "realm"], calls[-1])
    out = si.perform(si.Command("open", "realm"), run=fake, ask=lambda body: {"ok": False, "message": "No surface"})
    check("a refused open says so", not out.ok and "didn't" in out.line, out)
    class Done:
        def __init__(self, rc=0, out="", err=""):
            self.returncode, self.stdout, self.stderr = rc, out, err

    calls, spawned = [], []

    def fake_run(argv, **kw):
        calls.append(argv)
        if argv[1:2] == ["new"]:
            return Done(out='{"session": "abc", "cwd": "/x/lemma", "pid": 1}')
        if argv[1:2] == ["--json"]:
            return Done(out='[{"id": "r1", "run": true, "project": "lemma", "title": "readme"},'
                            ' {"id": "v1", "run": false, "project": "lemma", "title": "vs code tab"}]')
        if argv[1:2] == ["stop"]:
            return Done(out="Stopped.")
        return Done()

    spawn = lambda argv, **kw: spawned.append(argv)
    asked = []
    got = si.perform(si.Command("task", "write the README", "lemma"), run=fake_run, spawn=spawn,
                     ask=lambda body: asked.append(body) or {"ok": True})
    check("a spoken task only fills the agents panel's New agent box, never runs",
          got.ok and asked == [{"cmd": "open", "name": "agents",
                                "preset": {"/agents/task": "write the README", "/agents/want": "lemma"}}]
          and not any(c[1:2] in (["new"], ["draft"]) for c in calls) and "Press Start" in got.line, (asked, got))
    got = si.perform(si.Command("stop", "lemma"), run=fake_run, spawn=spawn)
    check("stop reaches only the glass's own run", got.ok and calls[-1][1:] == ["stop", "r1"], calls[-1])
    got = si.perform(si.Command("stop", "nothing"), run=fake_run, spawn=spawn)
    check("a stop that names no run says so", not got.ok and "No running agent" in got.line, got)
    before = len(spawned)
    got = si.perform(si.parse("show my agents"), run=fake_run, spawn=spawn)
    check("show my agents opens the engine's agents surface, not kyber-sessions' panel",
          got.ok and calls[-1][1:] == ["open", "agents"] and len(spawned) == before, (calls[-1], spawned[before:]))
    from pathlib import Path as _P
    gone = _P("/nonexistent/snapshot/bin/kyber-sessions")
    check("a pruned sibling falls back to the same tool on PATH",
          si.tool(gone).endswith("/kyber-sessions") and not si.tool(gone).startswith("/nonexistent"), si.tool(gone))
    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
