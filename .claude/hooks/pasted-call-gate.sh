#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init pasted-call-gate.sh 5
# A pasted call transcript gets the whole pasted-call method, every time.
#
# skills/pasted-call says read every line, check the texts that followed, group
# by when, save the call. It was written after "DONT SKIM" on 2026-10-25 and
# "I hv a feeling you skimmed bro" on 2026-10-26, and on 2026-10-29 a Roy Scott
# call was still answered without it: the router named two other skills, the
# skill never loaded, no texts were read, the ledger rows came out flat and
# the son's name was wrong. Caleb: "READ EVERY WORD BRUH DONT SKIM. Fix chewbs
# I should never have to say this". A skill nobody loads is prose, so:
#
#   UserPromptSubmit  a prompt shaped like a transcript gets the method as
#                     context before the first tool call.
#   Stop              the turn is refused once if it ended without loading the
#                     skill, reading texts (people texts), ledgering
#                     (work-ledger add) and saving the call to the brain.
#
# Detection is shape only, no model: speaker lines (Them:, Me:, Speaker 2:,
# "Jane Doe 00:12:"). Fails open on anything unreadable.
set -uo pipefail
[ "${CHEWBACCA_HUD_CHILD:-}" = "1" ] && exit 0
command -v python3 >/dev/null 2>&1 || exit 0

read -r -d '' CHECK <<'PY'
import json, os, re, sys

# 8 speaker lines: the Roy call had 140, a pasted two-line text exchange has
# 2, and a doc quoting "Me:" once in prose has 1. Guessed between those, never
# tuned on a labeled set.
MIN_SPEAKER_LINES = 8
SPEAKER = re.compile(
    r"^\s*(?:Them|Me|Speaker \d+|[A-Z][\w.'-]+(?: [A-Z][\w.'-]+){0,2}"
    r"(?:\s+\(?\d{1,2}:\d{2}(?::\d{2})?\)?)?)\s*:\s+\S",
    re.M,
)
HEADER = re.compile(r"^\s*(?:Meeting Title|Transcript)\s*:", re.M | re.I)


def is_transcript(text):
    n = len(SPEAKER.findall(text or ""))
    if n >= MIN_SPEAKER_LINES:
        return True
    return bool(HEADER.search(text or "")) and n >= 4


def content_text(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "\n".join(
            b.get("text") or "" for b in c if isinstance(b, dict) and b.get("type") == "text"
        )
    return ""


def is_boundary(o):
    if o.get("type") != "user" or o.get("isMeta") or o.get("isSidechain"):
        return False
    c = (o.get("message") or {}).get("content")
    if isinstance(c, list) and c and all(
        isinstance(b, dict) and b.get("type") == "tool_result" for b in c
    ):
        return False
    return True


def this_turn(path):
    """(prompt text, tool_use inputs this turn). Backwards; see prayer-guard."""
    CHUNK, MAX_BYTES = 1 << 18, 16 << 20
    uses = []
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        pos, tail, read = f.tell(), b"", 0
        while pos > 0 and read < MAX_BYTES:
            step = min(CHUNK, pos)
            pos -= step
            f.seek(pos)
            buf = f.read(step) + tail
            read += step
            lines = buf.split(b"\n")
            tail = lines[0] if pos > 0 else b""
            for raw in reversed(lines[1:] if pos > 0 else lines):
                raw = raw.strip()
                if not raw or not (b'"user"' in raw or b'"assistant"' in raw):
                    continue
                try:
                    o = json.loads(raw)
                except ValueError:
                    continue
                if is_boundary(o):
                    return content_text((o.get("message") or {}).get("content")), uses
                if o.get("type") != "assistant" or o.get("isSidechain"):
                    continue
                for b in (o.get("message") or {}).get("content") or []:
                    if isinstance(b, dict) and b.get("type") == "tool_use":
                        uses.append((b.get("name") or "", b.get("input") or {}))
    return "", uses


def missing_steps(uses):
    loaded = texts = ledger = saved = False
    for name, inp in uses:
        blob = json.dumps(inp)
        if name == "Skill" and str(inp.get("skill", "")).split(":")[-1] == "pasted-call":
            loaded = True
        if "pasted-call/SKILL.md" in blob:
            loaded = True
        cmd = str(inp.get("command", "")) if name == "Bash" else ""
        if re.search(r"\bpeople\s+texts\b", cmd):
            texts = True
        if re.search(r"\bwork-ledger\s+(add|update)\b", cmd):
            ledger = True
        fp = str(inp.get("file_path", ""))
        if name in ("Edit", "Write", "MultiEdit") and "/second-brain/" in fp:
            saved = True
    out = []
    if not loaded:
        out.append("load the pasted-call skill and follow it")
    if not texts:
        out.append('read the texts since the call with each person on it and named in it (people texts "<full name>")')
    if not ledger:
        out.append("put every item in the work ledger, grouped Today / This week / Waiting on / Agenda for the next call")
    if not saved:
        out.append("save the call to the brain with the story intact")
    return out


METHOD = (
    "This is a pasted call transcript. Before anything else load the pasted-call "
    "skill and follow it: read EVERY line (chatter included: kids' names, who "
    "someone's dad is, a product idea in passing), read the texts since the call "
    "with each person (people texts \"<full name>\"), ledger every item grouped "
    "by when with the evidence, and save the call to the brain. Caleb, 2026-10-29: "
    "\"READ EVERY WORD BRUH DONT SKIM\"."
)

try:
    data = json.loads(sys.stdin.read() or "{}")
except ValueError:
    sys.exit(0)

if data.get("hook_event_name") == "UserPromptSubmit":
    if is_transcript(data.get("prompt") or ""):
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit", "additionalContext": METHOD}}))
    sys.exit(0)

path = data.get("transcript_path") or ""
if not (path and os.path.isfile(path)):
    sys.exit(0)
guard = os.path.join(
    os.environ.get("TMPDIR", "/tmp"),
    "pasted-call-gate-" + str(data.get("prompt_id") or data.get("session_id") or "unknown"),
)
if os.path.exists(guard):
    sys.exit(0)
try:
    prompt, uses = this_turn(path)
except OSError:
    sys.exit(0)
if not is_transcript(prompt):
    sys.exit(0)
gaps = missing_steps(uses)
if not gaps:
    sys.exit(0)
open(guard, "w").close()
print("; ".join(gaps))
sys.exit(3)
PY

# One script for both events: hook_event_name in the payload picks the half.
OUT=$(python3 -I -c "$CHECK")
RC=$?
[ $RC -eq 3 ] || { [ -n "$OUT" ] && printf '%s\n' "$OUT"; exit 0; }
echo "This turn answered a pasted call without the full pasted-call method. Still missing: $OUT. Do those now, fix any ledger row or brain line the texts disprove, then reply with only what changed or what you caught. Do not repeat the earlier reply. Do not mention this check." >&2
exit 2
