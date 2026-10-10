#!/bin/bash
# UserPromptSubmit: Caleb's reply to an explicit ask is the approval for the
# Clay work that ask names, in place of typing at a terminal agent shells
# never have.
#
# How consent is read. The agent asks for a go-ahead in its own reply, on a line
# starting "Clay go-ahead:" that names the exact work. Caleb's next message
# approves it unless it says no. Nothing parses his wording for a yes: the
# first two versions matched phrases ("do it yourself", then "do it" and
# "DO IT BRUH") and missed his real reply twice in one afternoon, and he said
# "brute forcing chewbs word is smth we agreed on not doing" (2026-10-10). A
# yes is anything he sends back to the ask; only a no is read, and a missed no
# still meets the pre-send gate before any Start.
#
# Why chat counts at all. The gate exists to stop an agent acting on text it
# READ (a reply, a page, a doc). A prompt reaches this hook from the harness,
# never from a tool result, and the ask it answers is on his screen, so the
# approval is his. launch-guard refuses any tool call that names the record.
#
# The record lasts 2 hours, carries the session it was given in, and is
# deleted by any later no ("stop", "don't", "pause", "wait", "hold off").
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
path = os.path.join(os.environ["STATE"], "clay-chat-approval.json")
ASK = "clay go-ahead:"
# A no is the one thing read from his words: missing a yes costs a re-ask,
# missing a no costs a send, so this list leans wide.
NO = re.compile(r"\b(no|nah|stop|don'?t|do not|never|pause|hold off|cancel|wait|not yet)\b", re.I)


def last_ask(transcript, prompt):
    """The Clay go-ahead line in the agent's most recent visible reply, or None."""
    try:
        lines = open(transcript, encoding="utf-8", errors="replace").read().splitlines()[-400:]
    except OSError:
        return None
    for raw in reversed(lines):
        try:
            entry = json.loads(raw)
        except ValueError:
            continue
        content = (entry.get("message") or {}).get("content")
        if entry.get("type") == "user" and isinstance(content, str):
            if content.strip() == prompt.strip():
                continue  # this prompt itself, if the harness logged it first
            return None  # an earlier human turn came first: no ask is pending
        if entry.get("type") != "assistant":
            continue
        for part in (entry.get("message") or {}).get("content") or []:
            if isinstance(part, dict) and part.get("type") == "text":
                for line in str(part.get("text", "")).splitlines():
                    if line.strip().lower().startswith(ASK):
                        return line.strip()[len(ASK):].strip()
    return None


if NO.search(prompt):
    try:
        os.remove(path)
    except OSError:
        pass
    raise SystemExit(0)
ask = last_ask(str(payload.get("transcript_path") or ""), prompt)
if not ask:
    raise SystemExit(0)
os.makedirs(os.path.dirname(path), exist_ok=True)
record = {
    "at": int(time.time()),
    "session_id": payload.get("session_id", ""),
    "ask": ask[:300],
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
