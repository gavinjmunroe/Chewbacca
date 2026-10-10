#!/bin/bash
# UserPromptSubmit: Caleb's standing instruction is the approval. Every prompt
# he sends in a tab renews that tab's ok for Clay work for 2 hours; an explicit
# stop aimed at the work withdraws it everywhere.
#
# Why standing, not per action. Caleb, 2026-10-10: "Never tell me what to do
# always DO EVERYTHING YOURSELF fix chewbs bro ur getting anoying", after three
# versions of this hook that each tried to read a yes out of his words (a phrase
# list, a wider phrase list, then a "Clay go-ahead:" ask he had to answer). Every
# one missed a real reply and he called it brute forcing. Approval was never
# the thing to measure: he gave it once, for good.
#
# What the record proves is narrower and checkable: Caleb, a human, typed into
# this tab within 2 hours. So a prompt counts only when a person could have
# typed it. On 2026-10-10 at 13:17 a write was approved by "Reply with exactly:
# launch test ok. Do nothing else, use no tools.", the prompt of a `claude --bg`
# session another tab started, and the next record was a <task-notification>
# the harness injected. An agent that can start a session approved its own
# writes. Measured the same day (CLI 2.1.289 and desktop 2.1.295), a prompt is
# not Caleb's when:
#   - CLAUDE_CODE_SESSION_ATTENDED=0. `claude -p` and `claude --bg` both set it,
#     overriding the 1 they inherit from a desktop tab; a desktop tab has 1.
#   - CHEWBACCA_LAUNCHED_BY is set. The kit's launchers set it.
#   - the session's claude process has another claude process above it: it was
#     started from inside a Claude Code session. A desktop tab's chain is
#     claude <- Claude.app/Helpers/disclaimer <- Claude.app.
#   - the prompt is a harness wrapper (<task-notification>, a system
#     notification, Stop hook feedback), which no person typed.
# The hook payload itself carries no such marker: it has session_id, cwd,
# transcript_path, permission_mode and the prompt for both kinds of session.
# CLAUDE_CODE_ENTRYPOINT is useless here, a child inherits "claude-desktop".
#
# Records are per session (clay-chat-approval/<session>.json, v2). The guards
# read their own session's; `chewbacca clay` takes the freshest from any
# session and prints which one and what he typed. launch-guard refuses any
# tool call that names the records.
set -uo pipefail
STATE="${CHEWBACCA_STATE_DIR:-$HOME/.chewbacca/state}"
PAYLOAD="$(cat 2>/dev/null)"
[ -n "$PAYLOAD" ] || exit 0
PAYLOAD="$PAYLOAD" STATE="$STATE" python3 -I - <<'PY'
import glob, hashlib, json, os, re, subprocess, time
try:
    payload = json.loads(os.environ["PAYLOAD"])
except Exception:
    raise SystemExit(0)
prompt = str(payload.get("prompt") or "")
session = re.sub(r"[^A-Za-z0-9_.-]", "", str(payload.get("session_id") or ""))[:80]
state = os.environ["STATE"]
recdir = os.path.join(state, "clay-chat-approval")
mine = os.path.join(recdir, f"{session}.json") if session else None
stopped = os.path.join(recdir, "STOPPED")


def remove(p):
    try:
        os.remove(p)
    except (OSError, TypeError):
        pass


# The v1 single global record is what any tab could borrow. Gone for good.
remove(os.path.join(state, "clay-chat-approval.json"))

INJECTED = re.compile(
    r"^\s*(<task-notification>|<system-reminder>|\[SYSTEM NOTIFICATION|Stop hook feedback:"
    r"|<local-command-stdout>|<local-command-stderr>|<teammate-message)", re.I)


def is_claude_code(pid):
    """True when pid runs the Claude Code CLI (not the desktop app, Claude.app)."""
    try:
        comm = subprocess.run(["ps", "-o", "comm=", "-p", str(pid)], capture_output=True,
                              text=True, timeout=3).stdout.strip()
    except Exception:
        return None
    base = os.path.basename(comm)
    if base == "claude":
        return True
    if base == "node":
        try:
            args = subprocess.run(["ps", "-o", "args=", "-p", str(pid)], capture_output=True,
                                  text=True, timeout=3).stdout
        except Exception:
            return None
        return bool(re.search(r"/claude(\s|$)|claude-code/cli", args))
    return False


def parent(pid):
    try:
        out = subprocess.run(["ps", "-o", "ppid=", "-p", str(pid)], capture_output=True,
                             text=True, timeout=3).stdout.strip()
        return int(out)
    except Exception:
        return None


def nested():
    """True when this session's claude was started from inside another Claude
    Code session; None when the process tree can't be read (fails closed)."""
    start = os.environ.get("CLAUDE_PID", "")
    pid = int(start) if start.isdigit() else os.getppid()
    seen_self = start.isdigit()
    for _ in range(25):
        pid = parent(pid)
        if pid is None:
            return None
        if pid <= 1:
            return False
        hit = is_claude_code(pid)
        if hit is None:
            return None
        if hit:
            if seen_self:
                return True
            seen_self = True  # no CLAUDE_PID: the first claude up is the session itself
    return None


def why_not_caleb():
    if INJECTED.search(prompt):
        return "injected"
    if os.environ.get("CHEWBACCA_LAUNCHED_BY"):
        return "launched"
    if os.environ.get("CLAUDE_CODE_SESSION_ATTENDED") == "0":
        return "unattended"
    n = nested()
    if n is None:
        return "process tree unreadable"
    if n:
        return "nested"
    return None


if why_not_caleb():
    # Neither approves nor stops: the prompt is not his.
    raise SystemExit(0)

# A stop aimed at the work, or a whole message that is just "stop". "Never tell
# me what to do" is not a stop: the version that read any "never" or "don't" as
# one refused a blocklist write he had plainly asked for (2026-10-10).
STOP = re.compile(
    r"^\s*(stop|wait|pause|hold (on|off|up)|cancel|no)\b[\s!.]*$"
    r"|\b(stop|pause|cancel|hold off on|halt)\s+(the\s+)?(sending|sends?|launch(es|ing)?|campaigns?|waves?|emails?|outreach|clay)\b"
    r"|\b(don'?t|do not|never)\s+(send|launch|start|email|press start)\b"
    r"|\bhold off\b|\bnot yet\b",
    re.I)

# A stop holds until he says to go again: without this, "stop sending" followed
# by "what's the status?" renewed the ok on the very next prompt (security
# review, 2026-10-10). Reading a resume is the one place words are parsed, and
# a missed one fails safe: the work stays paused and the agent says so.
RESUME = re.compile(r"\b(go|resume|continue|unpause|keep going|do it|do everything|send|launch|start|yourself|urself)\b", re.I)

if STOP.search(prompt):
    # Every tab's ok goes, since `chewbacca clay` honors any of them.
    for p in glob.glob(os.path.join(recdir, "*.json")):
        remove(p)
    os.makedirs(recdir, exist_ok=True)
    open(stopped, "w").write(str(int(time.time())))
    raise SystemExit(0)
if os.path.exists(stopped):
    if not RESUME.search(prompt):
        raise SystemExit(0)
    remove(stopped)
if not mine:
    raise SystemExit(0)

record = json.dumps({
    "v": 2,
    "at": int(time.time()),
    "session_id": session,
    "interactive": True,
    "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
    "excerpt": prompt[:200],
})
os.makedirs(recdir, exist_ok=True)
tmp = mine + ".tmp"
with open(tmp, "w") as f:
    f.write(record)
os.chmod(tmp, 0o600)
os.replace(tmp, mine)
PY
exit 0
