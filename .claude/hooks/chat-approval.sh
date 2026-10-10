#!/bin/bash
# UserPromptSubmit: Caleb's standing instruction is the approval. Every prompt
# he sends in a tab renews that tab's ok for Clay work for 2 hours; an explicit
# stop aimed at the work withdraws it.
#
# Why standing, not per action. Caleb, 2026-10-10: "Never tell me what to do
# always DO EVERYTHING YOURSELF fix chewbs bro ur getting anoying", after three
# versions of this hook that each tried to read a yes out of his words (a phrase
# list, a wider phrase list, then a "Clay go-ahead:" ask he had to answer). Every
# one missed a real reply and he called it brute forcing. Approval was never
# the thing to measure: he gave it once, for good.
#
# What the record proves is narrower and checkable: Caleb, a human, typed into
# this tab within 2 hours. A prompt reaches this hook from the harness, never
# from a tool result, so text an agent READ (a reply, a page, a doc) can't make
# one. Launches still need the deterministic pre-send gate and gtme-grade in the
# send path; launch-guard refuses any tool call that names the records.
#
# One record per session (clay-chat-approval/<session>.json) for the guards,
# which see a session id, and the latest one (clay-chat-approval.json) for
# `chewbacca clay`, whose shell has none.
set -uo pipefail
STATE="${CHEWBACCA_STATE_DIR:-$HOME/.chewbacca/state}"
PAYLOAD="$(cat 2>/dev/null)"
[ -n "$PAYLOAD" ] || exit 0
PAYLOAD="$PAYLOAD" STATE="$STATE" python3 -I - <<'PY'
import hashlib, json, os, re, time
try:
    payload = json.loads(os.environ["PAYLOAD"])
except Exception:
    raise SystemExit(0)
prompt = str(payload.get("prompt") or "")
session = re.sub(r"[^A-Za-z0-9_.-]", "", str(payload.get("session_id") or ""))[:80]
state = os.environ["STATE"]
latest = os.path.join(state, "clay-chat-approval.json")
mine = os.path.join(state, "clay-chat-approval", f"{session}.json") if session else None

# A stop aimed at the work, or a whole message that is just "stop". "Never tell
# me what to do" is not a stop: the version that read any "never" or "don't" as
# one refused a blocklist write he had plainly asked for (2026-10-10).
STOP = re.compile(
    r"^\s*(stop|wait|pause|hold (on|off|up)|cancel|no)\b[\s!.]*$"
    r"|\b(stop|pause|cancel|hold off on|halt)\s+(the\s+)?(sending|sends?|launch(es|ing)?|campaigns?|waves?|emails?|outreach|clay)\b"
    r"|\b(don'?t|do not|never)\s+(send|launch|start|email|press start)\b"
    r"|\bhold off\b|\bnot yet\b",
    re.I)


def remove(p):
    try:
        os.remove(p)
    except (OSError, TypeError):
        pass


# A stop holds until he says to go again: without this, "stop sending" followed
# by "what's the status?" renewed the ok on the very next prompt (security
# review, 2026-10-10). Reading a resume is the one place words are parsed, and
# a missed one fails safe: the work stays paused and the agent says so.
RESUME = re.compile(r"\b(go|resume|continue|unpause|keep going|do it|do everything|send|launch|start|yourself|urself)\b", re.I)
stopped = os.path.join(state, "clay-chat-approval", "STOPPED")

if STOP.search(prompt):
    remove(latest)
    remove(mine)
    os.makedirs(os.path.dirname(stopped), exist_ok=True)
    open(stopped, "w").write(str(int(time.time())))
    raise SystemExit(0)
if os.path.exists(stopped):
    if not RESUME.search(prompt):
        raise SystemExit(0)
    remove(stopped)

record = json.dumps({
    "at": int(time.time()),
    "session_id": session,
    "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
    "excerpt": prompt[:200],
})
for path in filter(None, (latest, mine)):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        f.write(record)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)
PY
exit 0
