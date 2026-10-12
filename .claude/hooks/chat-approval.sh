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
#   - CHEWBACCA_AGENT_LAUNCHED or CHEWBACCA_LAUNCHED_BY is set. `chewbacca
#     launch` sets the first (c511c674).
#   - the session's claude process has another claude process above it: it was
#     started from inside a Claude Code session. A desktop tab's chain is
#     claude <- Claude.app/Helpers/disclaimer <- Claude.app.
#   - the prompt is a harness wrapper (<task-notification>, a
#     <cross-session-message> from another tab, a system notification, Stop
#     hook feedback), which no person typed. At 13:50 a task-notification
#     renewed the approval.
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
    r"^\s*(<task-notification|<cross-session-message|<system-reminder>|\[SYSTEM NOTIFICATION|Stop hook feedback:"
    r"|<local-command-stdout>|<local-command-stderr>|<teammate-message)", re.I)
# Another tab's message can arrive wrapped after a lead-in line ("The
# coordinator sent a message:\n<cross-session-message from=...>", seen
# 2026-10-10), and a desktop send_message turn opens with a "From <title>"
# header line. Neither is anything Caleb typed. The From rule can catch a
# typed "From now on" line followed by more lines; that fails safe (no ok).
CROSS = re.compile(r"<cross-session-message\b|\A\s*From [^\n]{1,80}\n", re.I)
# chewbacca launch (96015297) seeds every session with this line. The seed
# runs headless, but the session's later turns run in the desktop app with no
# env marker, so the session id is remembered here, written only by this hook
# (launch-guard refuses any tool call naming clay-chat-approval).
SEED_LINE = "This is your brief. Don't start the work yet."
launched_dir = os.path.join(recdir, "launched")
launched_mark = os.path.join(launched_dir, session) if session else None


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


def seeded_by_launch():
    """True when this session's first prompt was a chewbacca launch seed. Read
    from the transcript, which no tool call here writes."""
    path = str(payload.get("transcript_path") or "")
    try:
        with open(path) as f:
            for _, line in zip(range(400), f):
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                m = d.get("message") or {}
                if d.get("type") == "user" and isinstance(m.get("content"), str):
                    return SEED_LINE in m["content"]
    except OSError:
        return None
    return None


def mark_stands():
    """A remembered mark holds when it says why (v2) or when the session was
    seeded by chewbacca launch. On 2026-10-11 a jobs notice resumed Caleb's own
    VS Code tab headless at 17:12 (ATTENDED=0 for that one turn), the old hook
    remembered the whole tab as launched, and every prompt he typed there after
    stopped counting: the 8 Monday drafts could not be fixed. A one-off headless
    turn is refused on its own env, so it never needs remembering."""
    try:
        body = open(launched_mark).read().strip()
    except OSError:
        return False
    if body.startswith("{"):
        return True
    seeded = seeded_by_launch()
    if seeded is False:
        remove(launched_mark)
        return False
    return True  # unreadable transcript: fail closed


def why_not_caleb():
    if launched_mark and os.path.exists(launched_mark) and mark_stands():
        return "remembered launched session"
    if INJECTED.search(prompt) or CROSS.search(prompt):
        return "injected"
    if SEED_LINE in prompt:
        return "launched"
    if os.environ.get("CHEWBACCA_LAUNCHED_BY") or os.environ.get("CHEWBACCA_AGENT_LAUNCHED"):
        return "launched"
    # Headless turns carry their marker every time, so they are refused turn by
    # turn and never remembered (see mark_stands).
    if os.environ.get("CLAUDE_CODE_SESSION_ATTENDED") == "0":
        return "headless"
    n = nested()
    if n is None:
        return "process tree unreadable"
    if n:
        return "headless"
    return None


why = why_not_caleb()
if why:
    # Neither approves nor stops: the prompt is not his. A kit-launched session
    # is remembered, so its later desktop turns (no env marker) never count.
    if why == "launched" and launched_mark:
        os.makedirs(launched_dir, exist_ok=True)
        open(launched_mark, "w").write(json.dumps({"at": int(time.time()), "why": "chewbacca launch"}))
        remove(mine)
    if why == "headless":
        remove(mine)
    raise SystemExit(0)

# A stop aimed at the work, or a whole message that is just "stop". "Never tell
# me what to do" is not a stop: the version that read any "never" or "don't" as
# one refused a blocklist write he had plainly asked for (2026-10-10).
STOP = re.compile(
    r"^\s*(stop|wait|pause|hold (on|off|up)|cancel|no|not yet)\b[\s!.]*$"
    r"|\b(stop|pause|cancel|hold off on|halt)\s+(the\s+)?(sending|sends?|launch(es|ing)?|campaigns?|waves?|emails?|outreach|clay)\b"
    r"|\b(don'?t|do not|never)\s+(send|launch|start|email|press start)\b",
    re.I)
# A bare "hold off" or "not yet" inside a longer message is a stop only when the
# message is about the outreach. On 2026-10-11 at 17:47 "hold off on that for
# now we might refactor like crazy", about a website video in another tab,
# stopped every Clay write on the machine the night before Monday's launch.
SOFT_STOP = re.compile(r"\bhold off\b|\bnot yet\b", re.I)
WORK = re.compile(r"\b(send(s|ing)?|launch(es|ing)?|campaigns?|waves?|emails?|outreach|clay|sequences?|leads?|start)\b", re.I)

# A stop holds until he says to go again: without this, "stop sending" followed
# by "what's the status?" renewed the ok on the very next prompt (security
# review, 2026-10-10). Reading a resume is the one place words are parsed, and
# a missed one fails safe: the work stays paused and the agent says so.
RESUME = re.compile(r"\b(go|resume|continue|unpause|keep going|do it|do everything|send|launch|start|yourself|urself)\b", re.I)

if STOP.search(prompt) or (SOFT_STOP.search(prompt) and WORK.search(prompt)):
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
