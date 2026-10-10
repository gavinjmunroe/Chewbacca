#!/bin/bash
# UserPromptSubmit: when Caleb tells the agent in chat to do the Clay work
# itself, record that approval so `chewbacca clay` writes and Clay UI clicks can
# go through without a person typing at a terminal.
#
# Why chat and not a terminal. The write gate read its yes from /dev/tty, which
# agent shells never have, so every Clay write (loading rows, verifying emails,
# building drafts, pressing Start) came back to Caleb as a command to run. On
# 2026-10-10 he answered that with "fuck the guard fix chewbs do it urself".
# What the gate exists to stop is an agent acting on text it READ (a reply, a
# page, a doc) rather than on something Caleb SAID. A prompt reaches this hook
# from the harness, never from a tool result, so an approval written here can
# only come from him. launch-guard refuses any tool call that touches the
# record, so the agent can't write one for itself.
#
# The record lasts 12 hours (CHAT_APPROVAL_MS in bin/chewbacca-clay). Silence
# never revokes it; "stop", "don't send", "pause" or "hold off" in a prompt does.
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
low = prompt.lower()
path = os.path.join(os.environ["STATE"], "clay-chat-approval.json")

# "Do the Clay work yourself", in the words he actually used. Built from one
# message (2026-10-10), never measured; widen it from real prompts that missed.
APPROVE = re.compile(
    r"\b(do it (ur|your) ?self|do it urself|fuck the guard"
    r"|(send|launch|start|run) (it|them|the campaigns?|the waves?)\b"
    r"|press start|hit start|you (have|got) my (ok|approval|go)|i approve"
    r"|go ahead and (send|launch|start))")
REVOKE = re.compile(r"\b(stop|don'?t (send|launch|start)|do not (send|launch|start)|pause|hold off|cancel)\b")

if REVOKE.search(low) and not APPROVE.search(low):
    try:
        os.remove(path)
    except OSError:
        pass
    raise SystemExit(0)
if not APPROVE.search(low):
    raise SystemExit(0)
os.makedirs(os.path.dirname(path), exist_ok=True)
record = {
    "at": int(time.time()),
    "session_id": payload.get("session_id", ""),
    "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
    "excerpt": prompt[:200],
}
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(record, f)
os.chmod(tmp, 0o600)
os.replace(tmp, path)
PY
exit 0
