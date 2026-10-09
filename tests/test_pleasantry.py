#!/usr/bin/env python3
"""A greeting must not cost a model turn.

2026-09-21: Caleb said "Good morning" and waited 21.4 seconds. The reply was
"Morning.", eight characters. The usage record says output_tokens 861, of
which thinking_tokens 854. The model reasoned for 854 tokens to produce one
word, and output is serial, so that reasoning was the twenty seconds.

No prompt fixes it. "Simple gets simple" was already in the prompt and was
obeyed: the ANSWER was one word. The cost sat in the thinking before it,
which no wording reaches. The only fix is not calling the model.

The risk is over-matching. "Good morning, what's on my calendar" is a
request with a greeting on the front, and answering it with "Morning." would
drop the half that mattered.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = (ROOT / "bin/hud-listen").read_text(encoding="utf-8")


def sets_from_source():
    """Read the vocabulary out of the source without running the daemon."""
    out = {}
    for name in ("GREETINGS", "FAREWELLS", "THANKS"):
        m = re.search(rf"{name} = \{{(.*?)\}}", SRC, re.S)
        assert m, f"{name} not found in hud-listen"
        out[name] = set(re.findall(r'"([^"]+)"', m.group(1)))
    return out


def test_the_vocabulary_exists_and_is_lowercase():
    sets = sets_from_source()
    for name, words in sets.items():
        assert words, f"{name} is empty"
        for w in words:
            assert w == w.lower(), f"{name} has {w!r}, which normalise can never match"
            assert not w.strip(".,!?") != w, f"{name} has punctuation in {w!r}"


def test_good_morning_is_covered():
    sets = sets_from_source()
    for phrase in ("good morning", "hey", "yo", "hi"):
        assert phrase in sets["GREETINGS"], f"{phrase!r} should be a greeting"
    assert "thanks" in sets["THANKS"]
    assert "good night" in sets["FAREWELLS"]


def test_it_matches_whole_utterances_only():
    """The guard against answering the wrong half of a sentence."""
    m = re.search(r"def pleasantry_kind\(cls, words: str\) -> str \| None:(.*?)\n    def ",
                  SRC, re.S)
    assert m, "pleasantry_kind() not found"
    body = m.group(1)
    assert "core in cls.GREETINGS" in body, (
        "matching must be equality on the whole utterance, never a substring "
        "or a prefix")
    for bad in ("startswith", "in said", ".find(", "search("):
        assert bad not in body, f"pleasantry_kind uses {bad}, which would match a prefix"
    p = re.search(r"def pleasantry\(self, said: str\) -> bool:(.*?)\n    def ", SRC, re.S)
    assert p and "self.pleasantry_kind(words)" in p.group(1), "pleasantry must use pleasantry_kind"


def test_it_never_calls_a_model():
    m = re.search(r"def pleasantry_kind\(cls, words: str\).*?def pleasantry\(self, said: str\) -> bool:(.*?)\n    def ",
                  SRC, re.S)
    body = m.group(0)
    for forbidden in ("subprocess", "self.ask(", "Answerer", "model_cmd", "claude"):
        assert forbidden not in body, (
            f"pleasantry reaches {forbidden}; the whole point is that it does not")


def test_it_is_asked_before_anything_expensive():
    """First in the chain, because recognising a greeting is free and
    sending one to a model is 21 seconds."""
    m = re.search(r"def ask\(self, said: str.*?\n        req = Request\(", SRC, re.S)
    assert m, "ask() chain not found"
    chain = m.group(0)
    i_pleasant = chain.find("self.pleasantry(")
    i_bubble = chain.find("self.bubble_request(")
    assert i_pleasant != -1, "pleasantry is not wired into ask()"
    assert i_bubble == -1 or i_pleasant < i_bubble, (
        "pleasantry must be tested before the other handlers")


def test_replies_rotate():
    """The prompt forbids repeating an acknowledgement, and a canned line
    that never varies is worse than a slow one that does."""
    m = re.search(r"PLEASANTRY_REPLIES = \{(.*?)\n    \}", SRC, re.S)
    assert m, "PLEASANTRY_REPLIES not found"
    for kind in ("greeting", "checkin", "farewell", "thanks"):
        assert f'"{kind}"' in m.group(1), f"no replies for {kind}"
    body = re.search(r"def pleasantry\(self.*?\n    def ", SRC, re.S).group(0)
    assert "_last_pleasantry" in body, "replies must not repeat back to back"
    assert "random.choice" in body


def load_listener():
    """The real module, for the routing decision itself, not its source."""
    import importlib.util
    import os
    import tempfile
    from importlib.machinery import SourceFileLoader
    os.environ.setdefault("BOB_DIR", tempfile.mkdtemp())
    os.environ.setdefault("BOB_DECISIONS", os.path.join(os.environ["BOB_DIR"], "d.jsonl"))
    os.environ.setdefault("SUPERASSISTANT_DIR", tempfile.mkdtemp(prefix="superassistant-test-"))
    sys.dont_write_bytecode = True
    if "hud_listen" in sys.modules:
        return sys.modules["hud_listen"]
    path = str(ROOT / "bin/hud-listen")
    spec = importlib.util.spec_from_file_location(
        "hud_listen", path, loader=SourceFileLoader("hud_listen", path))
    module = importlib.util.module_from_spec(spec)
    sys.modules["hud_listen"] = module
    spec.loader.exec_module(module)
    return module


# CHW-184, 2026-10-09: "whats up" sat on "Working on it 0:22". Every one of
# these must answer from the pleasantry path, never a model turn.
SMALL_TALK = [
    "whats up", "What's up?", "What's up, bro?", "Yo what's up", "Hey what's up",
    "What's up Chewbacca", "sup", "Wassup", "How are you doing?", "how's it going",
    "hey how are you", "you there?", "Yo yo yo", "thanks bro", "Good morning",
]
# And none of these may be swallowed by it: each is work for the agent.
REAL_TASKS = [
    "good morning what's on my calendar", "what's up with my agents",
    "fix the failing test in the hud", "text Sam that I'm running late",
    "how are you going to fix the build", "what's going on with this error",
    "summarize this page", "hey can you rename the branch",
]


def test_small_talk_takes_the_fast_path():
    m = load_listener()
    for said in SMALL_TALK:
        assert m.fast_path(said) == "pleasantry", f"{said!r} -> {m.fast_path(said)!r}, not the fast path"


def test_real_tasks_still_reach_the_agent():
    m = load_listener()
    for said in REAL_TASKS:
        got = m.fast_path(said)
        assert got != "pleasantry", f"{said!r} was answered as small talk"


def test_ask_routes_small_talk_fast_and_tasks_to_the_agent():
    """The decision in `ask` itself: pleasantry answers and the agent is never
    reached; a real task goes to `to_assistant`."""
    from unittest.mock import Mock
    m = load_listener()
    for said, fast in (("What's up, bro?", True), ("fix the failing test in the hud", False)):
        listener = m.Listener.__new__(m.Listener)
        for method in ("hush", "remember", "send", "speak", "settle", "stop",
                       "to_assistant", "pointed_marks", "handle_agent_answer",
                       "handle_draft_word", "handle_terminal_word", "handle_agents_word",
                       "quick_answer", "surface_request", "music_request", "open_request",
                       "agenda_request", "genui_request"):
            setattr(listener, method, Mock(return_value=False))
        listener.pointed_marks.return_value = []
        listener.in_flight = Mock(return_value=False)
        listener.verbose = False
        listener.ask(said)
        assert listener.to_assistant.called is not fast, (
            f"{said!r}: to_assistant called={listener.to_assistant.called}")
        if fast:
            assert listener.remember.called, "a pleasantry is logged with its elapsed time"
            req = listener.remember.call_args.args[0]
            assert req.spoken_at == listener.asked_at, "elapsed must run from arrival"


def test_listen_line_says_it_is_the_voice():
    """Kyber's watchdog tells the voice bridge from kyber-surfaces by this."""
    import tempfile
    m = load_listener()
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / "hud.token").write_text("a" * 64, encoding="utf-8")
        assert m.listen_line(str(Path(d) / "hud.sock")) == "listen token=" + "a" * 64 + " role=voice"


def test_random_is_imported():
    """py_compile passes on a missing import; the crash waits for runtime."""
    assert re.search(r"^import random$", SRC, re.M), "random is used and not imported"


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
