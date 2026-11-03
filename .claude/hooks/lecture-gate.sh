#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init lecture-gate.sh 5
# PreToolUse: refuse a coursework SPEC that never cites the lecture deck that
# assigned the work.
#
# Written 2026-11-02. The ACAD 185 A20 Hero's Journey went in as 19 slides of
# text, built from A20-SPEC.md, which was built from the dropbox brief. The
# W10S20 deck that assigned A20 asks for an AI-image storyboard, and it had
# never been pulled to disk. A teammate caught it the night before it was due.
# Caleb: "WHY WEREND THEY PULLED TO DISK??????".
#
# The map comes from `brightspace-sync decks`, which writes
# <slides>/<CODE>/assigned-in.json: {"A20": {"session": "W10S20", "deck": ...}}.
# A SPEC naming an assignment in that map has to name its session or deck.
#
# Exit 2 blocks the call.

set -uo pipefail
payload="$(cat)"
slides="${LECTURE_GATE_SLIDES:-${COURSEWORK_DIR:-$HOME/coursework}/slides}"
ls "$slides"/*/assigned-in.json >/dev/null 2>&1 || exit 0

# Read into a variable first: bash 3.2 misparses quotes in a heredoc inside $( ).
IFS= read -r -d '' py <<'PY'
import glob, json, os, re
p = json.loads(os.environ["PAYLOAD"] or "{}")
ti = p.get("tool_input") or {}
path = ti.get("file_path") or ""
if p.get("tool_name") not in ("Write", "Edit", "MultiEdit") or not re.search(r"spec[^/]*\.md$", path, re.I):
    raise SystemExit
if p["tool_name"] == "Write":
    text = ti.get("content") or ""
else:
    try:
        text = open(path).read()
    except OSError:
        text = ""
    edits = ti.get("edits") or [ti]
    for e in edits:
        text = text.replace(e.get("old_string") or "", e.get("new_string") or "", 1) if e.get("old_string") else text + (e.get("new_string") or "")
slides = os.environ["SLIDES"]
maps = {}
for f in glob.glob(f"{slides}/*/assigned-in.json"):
    code = os.path.basename(os.path.dirname(f))
    try:
        maps[code] = json.load(open(f))
    except ValueError:
        continue
# The SPEC's own deliverable: ids in its file name and title line. Ids in the
# body are usually sources (the real A20 SPEC cites A15, A17, A19, A21, A8).
title = next((l for l in text.splitlines() if l.strip()), "")
named = set(re.findall(r"\bA\d+[a-z]?\b", os.path.basename(path) + " " + title))
for code, given in maps.items():
    spaced = code.replace("-", "[ -]?")
    hits = [a for a in named if a in given]
    # An id alone could be another course's; take it when the SPEC names the
    # course, or when only this course has that id.
    hits = [a for a in hits if re.search(spaced, text, re.I) or sum(a in g for g in maps.values()) == 1]
    for a in sorted(hits):
        g = given[a]
        stem = g["deck"][:-4]
        if g["session"] in text or stem.split(" ", 1)[-1].lower() in text.lower():
            continue
        deck = os.path.join(slides, code, g["deck"])
        where = deck if os.path.exists(deck) else f"{deck} (NOT on disk: run brightspace-sync decks {code} --out {slides} --apply)"
        print(f"{a} was assigned in {code} {g['session']}. This SPEC never cites that deck:\n  {where}")
PY
msg="$(PAYLOAD="$payload" SLIDES="$slides" /usr/bin/python3 -I -c "$py")"
[ -n "$msg" ] || exit 0
cat >&2 <<MSG
lecture-gate: refusing. $msg

Read that deck whole and write what it asks for into this SPEC, naming the
session (or the deck title) next to each requirement. The dropbox brief is a
summary. The lecture is the spec. See "Read the lecture that assigned it
before building" in skills/coursework/SKILL.md.
MSG
exit 2
