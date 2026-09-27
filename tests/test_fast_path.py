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
import os
import re
import sys
import tempfile
from importlib.machinery import SourceFileLoader
from pathlib import Path

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
]


def ask_paths(source: str) -> list[str]:
    """The no-model checks at the top of `ask`, in order, read off the source."""
    body = source.split("    def ask(", 1)[1].split("        req = Request(", 1)[0]
    return re.findall(r"self\.(\w+)\(said", body)


def main() -> int:
    m = load()
    for said, want in TABLE:
        got = m.fast_path(said)
        check(f"{said!r} -> {want}", got == want, got)

    src = BIN.read_text(encoding="utf-8")
    seen = ask_paths(src)
    check("ask still has its fast paths to read", len(seen) >= 4, seen)
    named = {"pleasantry": "pleasantry", "quick_answer": "quick", "music_request": "music",
             "handle_agents_word": "agents"}
    for method in seen:
        known = named.get(method) in m.FAST_PATHS or method in m.STATEFUL_PATHS
        check(f"ask's {method} is replayed or declared stateful", known, method)
    check("stop words are replayed", "STOP_WORDS" in src.split("    def ask(", 1)[1][:600])

    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
