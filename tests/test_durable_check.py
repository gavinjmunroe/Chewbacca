#!/usr/bin/env python3
"""Regression coverage for conservative correction detection and write evidence."""

from __future__ import annotations

import os
import tempfile as _tempfile

# Never the real ledger: durable-check appends every decision to it.
os.environ["CHEWBACCA_LESSONS_DIR"] = _tempfile.mkdtemp(prefix="durable-lessons-")

import importlib.machinery
import importlib.util
import json
import sys
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load():
    loader = importlib.machinery.SourceFileLoader(
        "durable", str(ROOT / "bin/durable-check"))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def log_with(tmp, session, paths, ts=None):
    p = Path(tmp) / "write-log.tsv"
    ts = ts or time.time()
    p.write_text("".join(f"{ts}\t{session}\t{x}\n" for x in paths), encoding="utf-8")
    return p


# Original corpus corrections plus synthetic repair-request regressions.
CORRECTIONS = [
    "Bro what did I say, NEVER MAKE ME RUN TERMINAL U ALWAYS DO IT URSELF DONT FORGET AND FIX CHEWBACCA",
    "I have a feeling you still are stupid Bro I shouldn't hv to keep saying it, fix chewbacca!",
    "Bro figure it out you have full access and then fix chewbacca",
    "Bro this is ai slop writing, it doesn't seem authentic",
    "Dawg I never said submit what is wrong with you",
    "Never ask me to do something manual retard",
    "Bro wtf",
    "Ur being retarded",
    "fix the kit",
    "Please fix chewbacca",
    "Can you fix chewbacca?",
    "No, that's not what I asked for.",
    "Stop asking me to run commands manually.",
    # 2026-10-11: his real corrections the old detector missed (14 of 141).
    "Bro we hv NALANA never forget retard fix chewbs",
    "Bro never tell me to do smth you can do fix chewb",
    "That doesn't sound like me bruv",
    "Wtf taking so long?????",
    "Why ru repeating yourself again???",
    "Wait NOTHING on chewb should ever be read only that is stupid",
    "bro what did I say ALWAYS CLEAN UP DOMAIN NAME",
    "Bro do it for me",
    "Always push to main.",
]

# Original ordinary requests plus synthetic status and diagnostic regressions.
REQUESTS = [
    "Make chewbacca perfect",
    "can you add a dark mode toggle",
    "J give me the list bruh",
    "Bro continue",
    "Yo bro",
    "I wanna use the portal to open diff applications",
    "Run overnight while I sleep building and fixing",
    "Good night",
    "Are the hooks still broken?",
    "What's broken right now?",
    "The parser is broken; please investigate.",
    "Why did you choose that model?",
    "Why are you running the tests?",
    "Can you explain the ai slop checker?",
    "Does the checker think this is stupid or dumb?",
    "Did you fix chewbacca?",
    "Have you managed to fix chewbacca yet?",
    'Explain why "fix chewbacca" fires the checker.',
    'The log says "Bro wtf". What does that mean?',
    'Explain this fixture:\n```text\nfix chewbacca\n```',
    'Explain this feedback:\n> stop asking me to do that',
    'What does `fix chewbacca` mean?',
]


def test_fires_on_a_correction_with_nothing_written():
    d = load()
    with tempfile.TemporaryDirectory() as tmp:
        log = log_with(tmp, "s1", [])
        for msg in CORRECTIONS:
            refuse, _ = d.check(msg, "s1", log=log)
            assert refuse, f"missed a correction: {msg[:50]!r}"


def test_does_not_fire_once_a_policy_surface_changed():
    d = load()
    with tempfile.TemporaryDirectory() as tmp:
        log = log_with(tmp, "s1", ["/Users/x/chewbacca/.claude/hooks/new-guard.sh"])
        for msg in CORRECTIONS:
            refuse, _ = d.check(msg, "s1", log=log)
            assert not refuse, f"fired despite a policy write: {msg[:50]!r}"


def test_fixing_only_the_complained_about_thing_does_not_count():
    """Editing the essay he called slop is the immediate work. Doing only
    that is exactly the failure this catches."""
    d = load()
    with tempfile.TemporaryDirectory() as tmp:
        log = log_with(tmp, "s1", ["/Users/x/applications/essay-draft.md"])
        refuse, _ = d.check("Bro this is ai slop writing", "s1", log=log)
        assert refuse, "a non-policy write must not satisfy the gate"


def test_never_fires_on_an_ordinary_request():
    d = load()
    with tempfile.TemporaryDirectory() as tmp:
        log = log_with(tmp, "s1", [])
        for msg in REQUESTS:
            refuse, _ = d.check(msg, "s1", log=log)
            assert not refuse, f"FALSE POSITIVE on {msg[:50]!r}"


def test_another_sessions_writes_do_not_count():
    d = load()
    with tempfile.TemporaryDirectory() as tmp:
        log = log_with(tmp, "someone-else", ["/Users/x/chewbacca/.claude/rules/a.md"])
        refuse, _ = d.check("Bro wtf fix chewbacca", "s1", log=log)
        assert refuse, "a different session's write must not satisfy this one"


def test_writes_before_the_correction_do_not_count():
    """A change made before he corrected you was not a response to it."""
    d = load()
    with tempfile.TemporaryDirectory() as tmp:
        old = time.time() - 3600
        log = log_with(tmp, "s1", ["/Users/x/chewbacca/skills/a/SKILL.md"], ts=old)
        refuse, _ = d.check("Bro wtf", "s1", since=time.time() - 60, log=log)
        assert refuse, "a write from an hour before the correction must not count"


def test_prose_alone_is_refused_and_code_or_a_reason_is_not():
    """2026-10-11: a skill or memory edit is remembering, not enforcing."""
    d = load()
    with tempfile.TemporaryDirectory() as tmp:
        log = log_with(tmp, "s1", ["/Users/x/code/chewbacca/skills/a/SKILL.md",
                                   "/Users/x/second-brain/memory/feedback_x.md"])
        refuse, why = d.check("Bro do it for me", "s1", log=log, why_log=Path(tmp) / "none.jsonl")
        assert refuse and "prose" in why.lower(), why
        why_log = Path(tmp) / "why.jsonl"
        why_log.write_text(json.dumps({"t": time.time(), "session": "s1", "reason": "taste, no rule"}) + "\n")
        refuse, _ = d.check("Bro do it for me", "s1", log=log, why_log=why_log)
        assert not refuse, "a recorded reason from this session must satisfy it"
        other = Path(tmp) / "other.jsonl"
        other.write_text(json.dumps({"t": time.time(), "session": "s2", "reason": "x"}) + "\n")
        refuse, _ = d.check("Bro do it for me", "s1", log=log, why_log=other)
        assert refuse, "another session's reason must not count"
        log = log_with(tmp, "s1", ["/Users/x/code/chewbacca/tests/test_new.py"])
        refuse, _ = d.check("Bro do it for me", "s1", log=log, why_log=Path(tmp) / "none.jsonl")
        assert not refuse, "a test write is enforcement"


def test_reads_the_prompt_from_a_claude_transcript():
    """Claude Code's Stop payload has no user_message; the hook exited 0 on all
    23 runs logged 2026-10-11. The transcript has the prompt and its time."""
    d = load()
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp) / "t.jsonl"
        rows = [
            {"type": "user", "message": {"content": "add a toggle"}, "timestamp": "2026-10-11T10:00:00Z"},
            {"type": "user", "message": {"content": "Bro fix chewbs"}, "timestamp": "2026-10-11T10:05:00Z"},
            {"type": "assistant", "message": {"content": [{"type": "text", "text": "on it"}]}},
            {"type": "user", "message": {"content": [{"type": "tool_result", "content": "x"}]}},
            {"type": "user", "message": {"content": "<task-notification>done</task-notification>"}},
        ]
        t.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
        text, at = d.last_prompt(str(t))
        assert text == "Bro fix chewbs", text
        assert abs(at - 1791713100) < 2, at


def test_guard_refuses_a_claude_shaped_stop_once_and_records_it():
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp) / "t.jsonl"
        t.write_text(json.dumps({"type": "user", "message": {"content": "Bro fix chewbs"},
                                 "timestamp": "2026-10-11T10:05:00Z"}) + "\n")
        env = dict(os.environ, CHEWBACCA_WRITE_LOG=str(Path(tmp) / "w.tsv"),
                   CHEWBACCA_LESSONS_DIR=str(Path(tmp) / "lessons"), CHEWBACCA_LOG_DIR=str(Path(tmp) / "logs"),
                   TMPDIR=tmp)
        guard = ROOT / ".claude/hooks/durable-guard.sh"
        first = subprocess.run(["bash", str(guard)], text=True, capture_output=True, env=env, input=json.dumps(
            {"hook_event_name": "Stop", "session_id": "s9", "transcript_path": str(t), "stop_hook_active": False}))
        assert first.returncode == 2, (first.returncode, first.stderr)
        assert "chewbacca lessons why" in first.stderr
        again = subprocess.run(["bash", str(guard)], text=True, capture_output=True, env=env, input=json.dumps(
            {"hook_event_name": "Stop", "session_id": "s9", "transcript_path": str(t), "stop_hook_active": True}))
        assert again.returncode == 0, "refuses at most once per prompt"
        rows = [json.loads(x) for x in (Path(tmp) / "lessons/corrections.jsonl").read_text().splitlines()]
        assert [r["outcome"] for r in rows] == ["none", "none"], rows


def test_missing_log_is_safe():
    d = load()
    refuse, _ = d.check("Bro wtf", "s1", log=Path("/nonexistent/write-log.tsv"))
    assert refuse, "no log means no evidence of a durable change"
    refuse, _ = d.check("add a toggle", "s1", log=Path("/nonexistent/x.tsv"))
    assert not refuse


def test_feedback_does_not_claim_a_live_historical_count():
    with tempfile.TemporaryDirectory() as tmp:
        result = subprocess.run(
            [sys.executable, str(ROOT / "bin/durable-check"), "--session", "fixture",
             "--log", str(Path(tmp) / "missing.tsv")],
            input="fix chewbacca", text=True, capture_output=True)
        assert result.returncode == 1
        assert "heuristic" in result.stderr
        assert "13 times" not in result.stderr
        assert "209 sessions" not in result.stderr


if __name__ == "__main__":
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  pass  {name}")
            except AssertionError as exc:
                print(f"  FAIL  {name}: {exc}")
                fails += 1
    print(f"\n{'FAILED' if fails else 'ok'}  {fails} failure(s)")
    sys.exit(1 if fails else 0)
