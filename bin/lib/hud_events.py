"""Reading what Kyber sends up its socket, and subscribing to it.

One reader for every Python client, so none of them guesses differently from
the others where a value ends. The display writes an event as positional
words followed by `key=value` pairs, every value one JSON token
(hud/CLAUDE.md, "Events, exactly"):

    e action reply row="thread:abc123" surface="messages"
    e action send row="s-6d901cd1" surface="s-6d901cd1" text="run the tests"

A positional word is letters, digits and `_ - . : /` only. A value is JSON
read with `raw_decode`, so `text="a\\" surface=\\"evil"` is one value and
cannot become a second key. Anything that does not parse cleanly is refused
whole rather than half-read.

Receiving events needs the per-start token (`listen token=<hex>`), which the
display writes to `hud.token` beside its socket. `listen_line()` reads it.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

WORD = re.compile(r"[A-Za-z0-9_.:/-]+")
KEY = re.compile(r"([A-Za-z0-9_]+)=")
_decoder = json.JSONDecoder()


def parse(line: str) -> dict | None:
    """`{"words": [...], "fields": {...}}` for one event line, or None when it
    is not exactly words then key=value pairs."""
    words: list[str] = []
    fields: dict = {}
    i, n = 0, len(line)
    while i < n:
        if line[i] == " ":
            i += 1
            continue
        key = KEY.match(line, i)
        if key:
            start = key.end()
            try:
                value, end = _decoder.raw_decode(line, start)
            except ValueError:
                return None
            if end < n and line[end] != " ":
                return None  # a value runs straight into more text
            if key.group(1) in fields:
                return None  # a second row= or surface= is an injection, not an update
            fields[key.group(1)] = value
            i = end
            continue
        if fields:
            return None  # a positional word after the first key=value
        word = WORD.match(line, i)
        if not word or (word.end() < n and line[word.end()] != " "):
            return None
        words.append(word.group(0))
        i = word.end()
    return {"words": words, "fields": fields}


def event(line: str) -> dict | None:
    """An `e` line as `{"name", "component", ...fields}`. For a row action
    (`e action <name> row=...`) `name` is the action's own name."""
    if not line.startswith("e "):
        return None
    got = parse(line[2:])
    if not got or len(got["words"]) < 2:
        return None
    first, second = got["words"][0], got["words"][1]
    out = dict(got["fields"])
    out["name"] = second if first == "action" else first
    out["component"] = second
    return out


def token_path(socket_path: str) -> Path:
    return Path(socket_path).expanduser().parent / "hud.token"


def listen_line(socket_path: str | None = None) -> str:
    """`listen token=<hex>` when the token can be read, else `listen`, which
    the display answers with its version and no events."""
    path = socket_path or os.environ.get("BOB_HUD_SOCKET", str(Path.home() / ".bob" / "hud.sock"))
    try:
        token = token_path(path).read_text(encoding="utf-8").strip()
    except OSError:
        return "listen"
    return f"listen token={token}" if re.fullmatch(r"[0-9a-f]{64}", token) else "listen"
