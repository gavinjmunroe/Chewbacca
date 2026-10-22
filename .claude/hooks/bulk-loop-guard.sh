#!/bin/bash
# hookd skips this guard for a Bash call that names none of these words,
# each one its first check requires. Proven by tools/hookd_replay.py.
# gate: osascript
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
# PreToolUse on Bash: refuse an AppleScript or JXA script that walks a whole
# app collection (every person, message, note, reminder, event, track, file)
# one item at a time, reading properties inside the loop.
#
# Each property read inside such a loop is its own Apple Event, so the cost is
# cards x fields round trips. On 2026-10-21 a `repeat with p in people` that
# read six fields per card was still running at 5 minutes when Caleb asked
# "What's taking so long?"; the bulk form (`people.firstName()`, one event per
# field for every card) read the same data in 3.7 s. Then: "Fix chewbs to
# never take an inefficent route when navigating a large amount of data".
#
# The refusal is a JSON deny with the fix in the reason, never exit 2 (a red
# hook error, feedback_hooks_never_show_errors). A loop that truly needs one
# card at a time (a few ids already in hand) carries `per-item:` and a reason.
set -uo pipefail

INPUT="$(cat 2>/dev/null || true)"
[ -n "$INPUT" ] || exit 0

printf '%s' "$INPUT" | python3 -I -c '
import json, os, re, sys
try:
    d = json.load(sys.stdin)
except Exception:
    raise SystemExit
ti = d.get("tool_input") or {}
if d.get("tool_name") != "Bash" or not isinstance(ti, dict):
    raise SystemExit
cmd = str(ti.get("command") or "")
if "osascript" not in cmd or "per-item:" in cmd:
    raise SystemExit

# A script run from a file is read too: the slow one may live in a .js or
# .applescript the same command wrote a moment ago.
src = cmd
for path in re.findall(r"osascript(?:\s+-l\s+\w+)?\s+([^\s;&|<>-][^\s;&|<>]*\.(?:js|scpt|applescript))", cmd):
    path = os.path.expanduser(path.strip("\"\x27"))
    try:
        if os.path.getsize(path) < 200_000:
            src += "\n" + open(path, errors="replace").read()
    except OSError:
        pass

COLL = r"(?:people|persons|messages|notes|reminders|events|tracks|files|items|chats|contacts|mailboxes|rows|records)"
hit = None
# AppleScript: repeat with p in people / in every person (of ...)
for m in re.finditer(r"repeat\s+with\s+(\w+)\s+in\s+(?:\(?\s*)?(?:(?:the\s+)?(?:every\s+\w+(?:\s+\w+)?|" + COLL + r"))\b", src, re.I):
    var = m.group(1)
    body = src[m.end():m.end() + 4000]
    end = re.search(r"\bend\s+repeat\b", body, re.I)
    body = body[:end.start()] if end else body
    if re.search(r"\b[\w ]{1,40}\s+of\s+" + re.escape(var) + r"\b", body, re.I):
        hit = m.group(0)
        break
# JXA: for (const p of C.people()) { p.firstName() } or people()[i].name()
if not hit:
    m = re.search(r"for\s*\(\s*(?:const|let|var)?\s*(\w+)\s+of\s+[\w.$]*\." + COLL + r"\(\)\s*\)", src)
    if m and re.search(r"\b" + re.escape(m.group(1)) + r"\.\w+\(\)", src[m.end():m.end() + 4000]):
        hit = m.group(0)
if not hit:
    m = re.search(r"\." + COLL + r"(?:\(\))?\[\s*\w+\s*\]\.\w+\(\)", src)
    if m:
        hit = m.group(0)
# JXA through a name: const ps = C.people; ... ps[i].lastName()
if not hit:
    for a in re.finditer(r"\b(\w+)\s*=\s*[^;\n]*\." + COLL + r"\b(?!\s*\.\w+\(\))", src):
        m = re.search(r"\b" + re.escape(a.group(1)) + r"\[\s*\w+\s*\]\.\w+\(\)", src[a.end():])
        if m:
            hit = m.group(0)
            break
if not hit:
    raise SystemExit

reason = (
    "This script reads properties one item at a time across a whole collection ("
    + " ".join(hit.split())[:80] + "). Every read is its own Apple Event, so it runs "
    "items x fields round trips: the 2026-10-21 contacts version was still going at "
    "5 minutes, the bulk read took 3.7 s. Read each property for every item in ONE "
    "event and filter in memory: JXA `const p = Application(\"Contacts\").people; "
    "const ids = p.id(), last = p.lastName();` then index the arrays (AppleScript: "
    "`get last name of every person`), and write back only the matches by id. For "
    "Contacts find or rename, use `contacts-bulk find|replace` (snapshot + undo). "
    "Time it on a small slice first if unsure. A loop over a few ids already in hand "
    "can carry `per-item: <reason>`."
)
print(json.dumps({"hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": reason,
}}))
'
exit 0
