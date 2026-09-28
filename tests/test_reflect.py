#!/usr/bin/env python3
"""reflect: harvest failures from both logs, replay them, and write nothing
unless told to.

Hermetic: a made-up voice log and a made-up Claude Code transcript in a temp
dir, found through the same environment variables the real run reads.
"""
import datetime
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="reflect-test-"))
ENV = dict(os.environ,
           CHEWBACCA_LEARN_DIR=str(TMP / "learn"),
           CHEWBACCA_TRANSCRIPTS=str(TMP / "projects"),
           SUPERASSISTANT_DIR=str(TMP / "voice"),
           BOB_DIR=str(TMP / "bob"),
           BOB_DECISIONS=str(TMP / "decisions.jsonl"),
           # Case ids hash the temp path, so which case is held out changes
           # every run. These checks are about harvesting and declines;
           # test_holdout.py pins ids and tests the holdout itself.
           CHEWBACCA_HOLDOUT_EVERY="0")
# A key pasted into a chat, as happened on 2026-09-27. Split so this file
# does not itself look like a leaked key to a scanner.
KEY = "sk-" + "ant-" + "api03-Q9KQzOylEcDVp2ncE"

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def stamp(minutes_ago):
    t = datetime.datetime.now().astimezone() - datetime.timedelta(minutes=minutes_ago)
    return t.strftime("%Y-%m-%dT%H:%M:%S%z")


def iso(minutes_ago):
    t = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=minutes_ago)
    return t.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def fixtures():
    (TMP / "voice").mkdir()
    (TMP / "bob").mkdir()
    model = {"output_tokens": 40}
    # The slow shape here must be one no fast path should ever take. It was
    # "open" until loop attempt 590e4335 fixed the opens on 2026-09-27 and this
    # fixture failed the gate for it: a test built from fixable requests breaks
    # the first time the loop does its job. Drafting needs the model for good.
    rows = [
        {"said": "Write a caption for the Cowboy Cubans clip", "answer": "Here's one.", "seconds": 7.2},
        {"said": "Write Caleb a note about the demo", "answer": "Drafted it.", "seconds": 3.9},
        {"said": "can you write a toast for Saturday", "answer": "Here's a toast.", "seconds": 5.1},
        {"said": "Play Danielle by Fred again", "answer": "Playing it.", "seconds": 9.0},
        {"said": "Play Lose Yourself", "answer": "Playing it.", "seconds": 8.0},
        {"said": "Play Black Dog", "answer": "Playing it.", "seconds": 8.5},
        {"said": "Text Sam I'm late", "answer": "", "seconds": 4.0, "outcome": "failed"},
    ]
    with (TMP / "voice" / "questions.jsonl").open("w") as fh:
        for i, r in enumerate(rows):
            fh.write(json.dumps({"said": r["said"], "answer": r["answer"], "seconds": r["seconds"],
                                 "outcome": r.get("outcome", "done"), "usage": model,
                                 "at": stamp(60 - i)}) + "\n")
    (TMP / "bob" / "listen.log").write_text("muted: Write a caption for the Cowboy Cubans clip\n")

    proj = TMP / "projects" / "-Users-someone"
    proj.mkdir(parents=True)

    def user(text, minutes_ago, **extra):
        return {"type": "user", "sessionId": "abcd1234-0000", "cwd": "/Users/someone/Chewbacca",
                "timestamp": iso(minutes_ago), "message": {"role": "user", "content": text}, **extra}

    lines = [
        user("fix the parser so it reads dates", 30, turnOrigin="human"),
        user([{"type": "text", "text": "[Request interrupted by user]"}], 29),
        user("no, use the other file, the one in lib", 28, turnOrigin="human"),
        user("[MESSAGE FROM NON-USER SOURCE] hello", 27, isMeta=True),
        user("Warm-up for this session", 26, turnOrigin="sdk"),
        user(f"here is my key {KEY} for the voice", 25, turnOrigin="human"),
    ]
    (proj / "s1.jsonl").write_text("\n".join(json.dumps(x) for x in lines) + "\n")


def run(*args):
    return subprocess.run([sys.executable, *args], capture_output=True, text=True, env=ENV, cwd=str(ROOT))


def main() -> int:
    fixtures()
    r = run("bin/reflect")
    check("the default run succeeds", r.returncode == 0, r.stderr[-400:])
    check("the default run writes nothing", not (TMP / "learn").exists())
    check("it names the live shape", "write" in r.stdout, r.stdout[-600:])

    r = run("bin/reflect", "--json")
    data = json.loads(r.stdout)
    live = [c for c in data["live"] if c["shape"] == "write"]
    check("three slow drafts are live cases", len(live) == 3, data["live"])
    check("the plays replay onto the music path and are counted fixed",
          {c.get("path") for c in data["fixed"]} == {"music"} and len(data["fixed"]) == 3, data["fixed"])
    check("a failed outcome is an episode",
          any(e["kind"] == "failed" for e in data["voice_episodes"]))
    interrupts = [e for e in data["claude_episodes"] if e["kind"] == "interrupt"]
    check("one interrupt, from the typed messages only", len(interrupts) == 1, data["claude_episodes"])
    if interrupts:
        check("it carries what was asked and what came next",
              interrupts[0]["asked"].startswith("fix the parser")
              and interrupts[0]["then_said"].startswith("no, use the other file"), interrupts[0])
    check("a pasted key never reaches the output", "Q9KQzOylEcDVp2ncE" not in r.stdout)

    r = run("bin/reflect", "--write")
    first = (TMP / "learn" / "episodes.jsonl").read_text().count("\n")
    run("bin/reflect", "--write")
    second = (TMP / "learn" / "episodes.jsonl").read_text().count("\n")
    check("--write keeps episodes", first > 0, first)
    check("a second --write adds nothing new", second == first, (first, second))
    check("the trend line gets a row per run",
          (TMP / "learn" / "reflect.jsonl").read_text().count("\n") == 2)

    r = run("tests/voice_cases.py", "--shapes", "write")
    check("the judge fails while nothing serves the drafts", r.returncode == 1, r.stdout)
    case = live[0]["id"] if live else ""
    with (TMP / "learn" / "declined.jsonl").open("w") as fh:
        for c in live:
            fh.write(json.dumps({"case": c["id"], "why": "test"}) + "\n")
    r = run("tests/voice_cases.py", "--shapes", "write")
    check("declining every case is not a fix", r.returncode == 1 and "every case was declined" in r.stdout,
          r.stdout)
    with (TMP / "learn" / "declined.jsonl").open("w") as fh:
        fh.write(json.dumps({"case": case, "why": "left to the model"}) + "\n")
    r = run("tests/voice_cases.py", "--shapes", "write")
    check("a declined sentence is shown, not hidden", "LEFT" in r.stdout and "1/2" not in r.stdout
          and "0/2" in r.stdout, r.stdout)
    r = run("tests/voice_cases.py", "--shapes", "nosuchshape")
    check("nothing to judge is its own exit code", r.returncode == 2, r.returncode)

    # learn read ~/second-brain and feedback_*.md only, and on Gavin's Mac the
    # brain is elsewhere and every memory is spelled feedback-, so it saw none.
    brain = TMP / "brain" / "memory"
    brain.mkdir(parents=True)
    (brain / "feedback-short-answers.md").write_text("---\ndescription: keep answers short\n---\n")
    (brain / "feedback_no_emojis.md").write_text("---\ndescription: no emojis\n---\n")
    env = dict(ENV, HOME=str(TMP / "home"), PERSONAL_CONTEXT_DIR=str(TMP / "brain"))
    r = subprocess.run([sys.executable, "bin/learn", "--json"], capture_output=True, text=True,
                       env=env, cwd=str(ROOT))
    got = json.loads(r.stdout).get("memories") if r.returncode == 0 else r.stderr[-300:]
    check("learn finds the brain setup.sh named, in both spellings", got == 2, got)

    # A branch the gate kept is waiting on a person, and only until it merges.
    repo = TMP / "repo"
    repo.mkdir()
    g = lambda *a: subprocess.run(["git", "-C", str(repo), *a], capture_output=True, text=True, check=True)
    g("init", "-q", "-b", "main")
    g("config", "user.email", "t@t")
    g("config", "user.name", "t")
    g("commit", "-q", "--allow-empty", "-m", "base")
    for name in ("learn/kept", "learn/merged"):
        g("checkout", "-q", "-b", name, "main")
        g("commit", "-q", "--allow-empty", "-m", f"loop: {name}")
    g("checkout", "-q", "main")
    g("merge", "-q", "--no-ff", "--no-edit", "learn/merged")
    from importlib.machinery import SourceFileLoader
    import importlib.util
    loader = SourceFileLoader("reflect", str(ROOT / "bin" / "reflect"))
    mod = importlib.util.module_from_spec(importlib.util.spec_from_loader("reflect", loader))
    loader.exec_module(mod)
    waiting = mod.pending(repo)
    check("--pending lists an unmerged learn/ branch and drops a merged one",
          len(waiting) == 1 and waiting[0].startswith("learn/kept (today): loop: learn/kept"), waiting)

    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
