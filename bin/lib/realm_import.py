#!/usr/bin/env python3
"""realm_import: what the agent CLIs already have on disk, read for the HUD's
"Bring in my tabs" without holding the engine's whole answer in the daemon.

import.scan (realm apps/server/src/import/service.ts) opens every Claude Code,
Codex and Cursor transcript read-only and answers with one candidate per
transcript. On Caleb's Mac on 2026-10-10 that was 5,446 candidates in one
41,039,576-byte WebSocket message, 57 s of engine time, and 295 MB resident
in the Python that parsed it. So the agents panel never calls it itself: a
press submits this file to `chewbacca jobs`, which runs it when the Mac has
room, and it writes only what the panel draws (the newest candidates worth
bringing in, and counts) to a small file the panel's fetch reads.

The scan writes nothing in realm ("scan WRITES NOTHING", contracts rpc.ts).
realm_client still classes it as a write, since it is not in READ_METHODS,
and that stays so on purpose: it reads every transcript on the Mac, so it
runs only after a press, and write=True here is that press.

What lands in the file is untrusted text from transcripts (titles, folders).
The panel strips it before the glass; this module only clips it.

    python3 realm_import.py scan --out FILE --ticket T [--home REALM_HOME]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import realm_client  # noqa: E402

# One message's ceiling for this call only. 41,039,576 bytes for 5,446
# transcripts on 2026-10-10; 128 MiB is three times that before a scan is
# refused as runaway.
SCAN_MAX_MESSAGE = 128 * 1024 * 1024
# The scan took 57 s on 2026-10-10 with the Mac at load 23; four minutes
# covers a slower disk or a busier Mac. Guessed past the one measurement.
SCAN_TIMEOUT = 240.0
# Candidates written to the file, newest first. The panel shows nine; the
# rest stand behind them as rows are brought in. Guessed.
KEEP = 40
# A title as written to the file. The panel clips again to one line.
TITLE_CHARS = 200
# Why a candidate is not offered, in the order the contract's flags are read
# (contracts import.ts): already a Realm session, a scratch folder, already
# imported, a shorter copy of another candidate.
HIDDEN = ("fromRealm", "scratch", "imported", "duplicate")


def _int(value) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def compact(scan, ticket: str, now_ms: int) -> dict:
    """The scan reduced to what the panel draws and what apply needs back."""
    scan = scan if isinstance(scan, dict) else {}
    found = [s for s in scan.get("sessions") or [] if isinstance(s, dict)]
    hidden = {name: 0 for name in HIDDEN + ("homeless",)}
    keep = []
    for s in found:
        flag = next((name for name in HIDDEN if s.get(name) is True), None)
        if flag:
            hidden[flag] += 1
            continue
        key = s.get("key")
        match = s.get("match") if isinstance(s.get("match"), dict) else {}
        space = match.get("spaceId") if isinstance(match.get("spaceId"), str) else None
        profile = match.get("fallbackProfileId") if isinstance(match.get("fallbackProfileId"), str) else None
        if not isinstance(key, str) or not key:
            continue
        if space is None and profile is None:
            # reason "none": apply would refuse it, so it is counted, not offered.
            hidden["homeless"] += 1
            continue
        keep.append({"key": key, "source": str(s.get("source") or ""), "kind": str(s.get("agentKind") or ""),
                     "title": str(s.get("title") or "")[:TITLE_CHARS], "cwd": str(s.get("cwd") or "")[:400],
                     "cwdExists": s.get("cwdExists") is True, "messages": _int(s.get("messages")),
                     "updatedAt": _int(s.get("updatedAt")), "spaceId": space, "profileId": profile,
                     "reason": str(match.get("reason") or "")})
    keep.sort(key=lambda c: (-c["updatedAt"], c["key"]))
    sources = [{"source": str(r.get("source") or ""), "available": r.get("available") is True,
                "sessions": _int(r.get("sessions")), "unreadable": _int(r.get("unreadable"))}
               for r in scan.get("sources") or [] if isinstance(r, dict)]
    return {"ticket": ticket, "scannedAt": now_ms, "found": len(found), "offered": len(keep), "hidden": hidden,
            "sources": sources, "sessions": keep[:KEEP]}


def failure_words(err: realm_client.RealmError) -> str:
    """A scan failure for the panel. The engine's own message can carry a
    path, so only its code or the kind of failure is kept."""
    if isinstance(err, realm_client.RealmRpcError):
        code = err.code if err.code.replace("_", "").isalnum() and err.code.isascii() else "an error"
        return f"the engine answered {code[:40]}"
    if isinstance(err, realm_client.RealmTimeout):
        return "the engine didn't finish reading in time"
    if isinstance(err, realm_client.RealmUnavailable):
        return "the engine isn't reachable"
    return "the engine's answer couldn't be read"


def write(path: Path, body: dict) -> None:
    """Replace path whole, readable only by this user."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".{os.getpid()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(body, f, ensure_ascii=False)
    os.replace(tmp, path)


def scan(out: Path, ticket: str, home: Path | None = None, connect=None, clock=time.time) -> int:
    connect = connect or (lambda: realm_client.connect(timeout=10.0, home=home))
    try:
        with connect() as conn:
            conn.max_message = SCAN_MAX_MESSAGE
            got = conn.call("import.scan", {}, timeout=SCAN_TIMEOUT, write=True)
    except realm_client.RealmError as err:
        write(out, {"ticket": ticket, "scannedAt": int(clock() * 1000), "error": failure_words(err)})
        return 1
    write(out, compact(got, ticket, int(clock() * 1000)))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="realm_import")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sc = sub.add_parser("scan", help="read the agent CLIs' transcripts and write what the panel offers")
    sc.add_argument("--out", required=True)
    sc.add_argument("--ticket", required=True)
    sc.add_argument("--home", default="")
    args = ap.parse_args(argv)
    home = Path(args.home).expanduser() if args.home else None
    return scan(Path(args.out).expanduser(), args.ticket, home)


if __name__ == "__main__":
    sys.exit(main())
