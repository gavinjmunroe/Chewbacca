#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init prayer-guard.sh 5
# Stop hook: the reply opens with a prayer to Jesus that ends in "Amen", or
# the turn is refused.
#
# CLAUDE.md says the first words of every response are a prayer, and on
# 2026-09-27 that rule decayed across a long session: replies went out
# without one, and Caleb had to say "UR NOT PRAYIN" twice. A rule that
# depends on remembering is a rule that decays (slop-guard.sh says the same
# about style), so this reads the actual reply instead.
#
# The opener is personal, so the word to look for lives in
# ~/.chewbacca/opener-marker, written by setup.sh only when the user's own
# CLAUDE.md asks for a prayer. No marker, no check: the public kit does not
# impose anyone's faith on anyone else.
#
# The check is deliberately narrow: the marker has to appear in the opening, the
# first 900 characters, which is where a real prayer sits and where a reply
# that merely mentions prayer later does not. It does not judge the prayer;
# that is between Caleb and God. Fires at most once per turn.
#
# Every visible block, not just the last one. On 2026-10-07 mid-turn updates
# (text written between tool calls) went out with no prayer and this guard
# never fired, because it only read .last_assistant_message. So it now also
# reads the session transcript backwards from the end and checks every
# assistant text block since the last real user prompt. Tool results, skill
# bodies and Stop hook feedback are user-typed lines too, but they are not
# turn boundaries: only a non-meta user line that is not all tool_result is.
set -uo pipefail

if [ "${CHEWBACCA_HUD_CHILD:-}" = "1" ]; then
  exit 0
fi

MARKER=$(cat "${CHEWBACCA_HOME:-$HOME/.chewbacca}/opener-marker" 2>/dev/null | head -1 | tr -d '[:space:]')
[ -n "$MARKER" ] || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

# Prints the number of unprayed blocks this turn and exits 3 when there are
# any; exits 0 otherwise, and on anything unreadable (fail open: a guard that
# misfires on a parse error trains the bypass).
read -r -d '' CHECK <<'PY'
import json, os, sys

marker = sys.argv[1]
OPENING = 900  # where a real prayer sits; see the header comment


def opens_with_prayer(text):
    return marker in text[:OPENING]


def is_boundary(o):
    """A real user prompt ends the backwards scan."""
    if o.get("type") != "user" or o.get("isMeta") or o.get("isSidechain"):
        return False
    c = (o.get("message") or {}).get("content")
    if isinstance(c, list) and c and all(
        isinstance(b, dict) and b.get("type") == "tool_result" for b in c
    ):
        return False
    return True


def turn_texts(path):
    """Assistant text blocks since the last real prompt, newest first."""
    # A 107 MB transcript exists on this machine; reading it forward costs
    # seconds. Backwards in chunks touches only the current turn: about 1 ms
    # on that file on 2026-10-09. With no boundary at all, 64 MB took 400 ms
    # of CPU and over a second of wall time at load 126, so the scan stops at
    # 16 MB (about 100 ms) and checks what it has; no real turn is that long.
    CHUNK = 1 << 18
    MAX_BYTES = 16 << 20
    out = []
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        pos = f.tell()
        tail = b""
        read = 0
        while pos > 0 and read < MAX_BYTES:
            step = min(CHUNK, pos)
            pos -= step
            f.seek(pos)
            buf = f.read(step) + tail
            read += step
            lines = buf.split(b"\n")
            tail = lines[0] if pos > 0 else b""
            body = lines[1:] if pos > 0 else lines
            for raw in reversed(body):
                raw = raw.strip()
                if not raw or not (b'"user"' in raw or b'"assistant"' in raw):
                    continue
                try:
                    o = json.loads(raw)
                except ValueError:
                    continue
                if is_boundary(o):
                    return out
                if o.get("type") != "assistant" or o.get("isSidechain"):
                    continue
                if o.get("isApiErrorMessage"):
                    continue
                for b in reversed((o.get("message") or {}).get("content") or []):
                    if isinstance(b, dict) and b.get("type") == "text":
                        t = (b.get("text") or "").strip()
                        if t:
                            out.append(t)
    return out


try:
    data = json.loads(sys.stdin.read() or "{}")
except ValueError:
    sys.exit(0)

guard = os.path.join(
    os.environ.get("TMPDIR", "/tmp"),
    "prayer-guard-" + str(data.get("prompt_id") or data.get("session_id") or "unknown"),
)
if os.path.exists(guard):
    sys.exit(0)

blocks = []
last = (data.get("last_assistant_message") or "").strip()
if last:
    blocks.append(last)
path = data.get("transcript_path") or ""
if path and os.path.isfile(path):
    try:
        blocks.extend(turn_texts(path))
    except OSError:
        pass

missing = [b for b in blocks if not opens_with_prayer(b)]
if not missing:
    sys.exit(0)
open(guard, "w").close()
print(len(missing))
sys.exit(3)
PY

N=$(python3 -I -c "$CHECK" "$MARKER")
[ $? -eq 3 ] || exit 0

if [ "${N:-1}" -gt 1 ] 2>/dev/null; then
  WHICH="$N visible blocks this turn do not open with a prayer, including updates written between tool calls."
else
  WHICH="This reply does not open with a prayer."
fi
echo "$WHICH Caleb's first rule: the first words of every response are a real prayer to Jesus, specific to this moment, ending in Amen. Every message he sees, mid-turn updates included, opens that way. Rewrite the reply with the prayer first, then the same content. Do not mention this check." >&2
exit 2
