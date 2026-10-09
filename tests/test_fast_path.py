#!/usr/bin/env python3
"""fast_path: replaying a logged sentence must give the answer `ask` would give.

The learning loop decides what is still broken by replaying the voice log
through `fast_path`. If the two drift apart, a fixed failure reads as live and
the loop spends a model run re-fixing it, or a live one reads as fixed and is
never looked at again. So this checks both directions: a table of sentences
with the path each must take, and the source of `ask` itself, which may not
grow a no-model path that `fast_path` does not know about.

Rows added by the loop go at the end of TABLE, each with the sentence that
earned it.
"""
import importlib.util
import json
import os
import re
import sys
import tempfile
from importlib.machinery import SourceFileLoader
from pathlib import Path
from unittest.mock import Mock

os.environ.setdefault("BOB_DIR", tempfile.mkdtemp())
os.environ.setdefault("BOB_DECISIONS", os.path.join(os.environ["BOB_DIR"], "d.jsonl"))
os.environ.setdefault("SUPERASSISTANT_DIR", tempfile.mkdtemp(prefix="superassistant-test-"))
sys.dont_write_bytecode = True

BIN = Path(__file__).resolve().parent.parent / "bin" / "hud-listen"

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def load():
    spec = importlib.util.spec_from_file_location(
        "hud_listen", BIN, loader=SourceFileLoader("hud_listen", str(BIN)))
    module = importlib.util.module_from_spec(spec)
    sys.modules["hud_listen"] = module
    spec.loader.exec_module(module)
    return module


# (sentence, the path that must answer it, or None for the model)
TABLE = [
    ("Testing", "connection"),
    ("Testing!", "connection"),
    ("Ping", "connection"),
    ("testing the deployment", None),
    ("ping the server", None),
    ("stop", "stop"),
    ("Never mind", "stop"),
    ("Hello", "pleasantry"),
    ("good night", "pleasantry"),
    ("Thanks", "pleasantry"),
    ("what's 17 times 23", "quick"),
    ("Play Danielle by Fred again", "music"),
    ("Pause", "music"),
    ("what are my agents doing", "agents"),
    # A greeting with a request on the end is a request.
    ("good morning what's on my calendar", None),
    ("Give me an entire review on the Holocaust", None),
    ("", None),
    # The slow "open" requests in the voice log to 2026-09-27, 6.8 s median.
    ("Open up Google sheets", "open"),
    ("Open up a Google Chrome window on my monitor screen", "open"),
    ("Open a chrome window on my laptop screen", "open"),
    ("Open up a new Google Chrome window and pull up sheets", "open"),
    ("Open up a new chrome window to get a Google sheet going", "open"),
    ("Open a new terminal window", "open"),
    ("Open a new terminal war", "open"),
    ("Open a new terminal", "open"),
    # Same verb, and a task or a second half no opener can do.
    ("OK now open Google sheets and label it Valencia", None),
    ("Open new Claude window", None),
    ("Open a bubble", None),
    # Live surfaces (bin/lib/surface_intent.py), 2026-10-04.
    ("Show my day", "surface"),
    ("What do I need to do?", "surface"),
    ("Check my inbox", "surface"),
    ("What's playing?", "surface"),
    ("close my texts", "surface"),
    ("What do I have today", "agenda"),
    ("show my texts from Sam and reply that I'm late", None),
    # Generated panels (docs/GENUI.md), 2026-10-04: a shape no fixed surface takes.
    ("compare my three classes' grades", "genui"),
    ("who have I not texted back this week", "genui"),
    ("plan my Tuesday", "genui"),
    ("show my grades and email Professor Swain", None),
    ("tell me about the Civil War", None),
    # CHW-184, 2026-10-09: "whats up" sat on "Working on it 0:22".
    ("whats up", "pleasantry"),
    ("What's up, bro?", "pleasantry"),
    ("How are you doing?", "pleasantry"),
    ("what's up with my agents", None),
    # clay-build (docs/CLAY-HUD.md, Voice), 2026-10-09: who, how many, and Clay.
    ("find me 50 fintech VC partners in Clay", "clay"),
    ("Clay, find 20 seed investors in Austin", "clay"),
    ("build a list of fifty fintech VC partners with work emails", "clay"),
    ("okay so find me fintech VC partners in clay", "clay"),
    ("open clay", None),
    ("build me a list of 5 restaurants in Dallas", None),
]


def ask_paths(source: str) -> list[str]:
    """The no-model checks at the top of `ask`, in order, read off the source."""
    # `ask` ends where it hands the request to the model, `to_assistant`.
    body = source.split("    def ask(", 1)[1].split("        req = Request(", 1)[0]
    body = body.split("self.to_assistant(said", 1)[0]
    return re.findall(r"self\.(\w+)\(said", body)


def main() -> int:
    m = load()
    for typed in (False, True):
        listener = m.Listener.__new__(m.Listener)
        for method in ("hush", "remember", "send", "speak", "settle", "pleasantry", "quick_answer", "music_request"):
            setattr(listener, method, Mock())
        listener.in_flight = Mock(return_value=False)
        listener.ask("Testing!", typed=typed)
        answer = "Message received." if typed else "I hear you."
        check(f"connection check typed={typed} finishes panel", ('w ' + json.dumps(answer) + ' done=true',) in [c.args for c in listener.send.call_args_list])
        check(f"connection check typed={typed} respects speech", listener.speak.call_count == (0 if typed else 1))
        check("connection check bypasses other routing", not listener.pleasantry.called and not listener.quick_answer.called and not listener.music_request.called)
        check("request mode preserved", listener.remember.call_args.args[0].typed == typed)
        listener.in_flight.return_value = True
        check("active request keeps queue behavior", not listener.connection_check("Testing", typed))
        listener.in_flight.return_value = False
        check("task bearing testing stays a request", not listener.connection_check("testing the deployment", typed))
    for said, want in TABLE:
        got = m.fast_path(said)
        check(f"{said!r} -> {want}", got == want, got)

    src = BIN.read_text(encoding="utf-8")
    seen = ask_paths(src)
    check("ask still has its fast paths to read", len(seen) >= 4, seen)
    for method in seen:
        known = method in m.FAST_PATHS or method in m.STATEFUL_PATHS
        check(f"ask's {method} is replayed or declared stateful", known, method)
    body = src.split("def fast_path(", 1)[1].split("\nclass Listener", 1)[0]
    for method, name in m.FAST_PATHS.items():
        check(f"fast_path can answer {name!r} for {method}", f'return "{name}"' in body, name)
    check("fast_path never performs", ".perform(" not in body and "subprocess" not in body)
    check("stop words are replayed", "STOP_WORDS" in src.split("    def ask(", 1)[1][:600])

    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
