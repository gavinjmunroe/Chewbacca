#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init link-guard.sh 5
# Stop hook: every file link in a reply has to open.
#
# WHAT HAPPENED, 2026-10-11. A reply linked the new logo render as
# [..](TTS%20logo%20helmet%20nalana%20v16.png) and a folder as
# (../code/work/TTS-Dev/...). The shell had cd'd into ~/Downloads, so both
# paths were written relative to Downloads. The VS Code panel resolves a link
# against the folder the session was opened in (~ for that tab), so both
# pointed at files that don't exist. Caleb clicked one and got "Couldn't open
# that file", then: "Fix chewb this should never happen again for anything I
# ever click".
#
# WHAT IT ENFORCES. Every markdown link in this turn's visible text whose
# target is a path (not a URL, mailto: or #anchor) must name a file or folder
# that exists, resolved the way the editor resolves it: absolute and ~ paths as
# written, everything else against the session's root. The root is
# CLAUDE_PROJECT_DIR, else the first cwd the transcript recorded. The working
# directory at reply time is never the root: that drift is the bug.
#
# Fails open on anything unreadable; a guard that misfires on a parse error
# trains the bypass.
set -uo pipefail

[ "${CHEWBACCA_HUD_CHILD:-}" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v python3 >/dev/null 2>&1 || exit 0
INPUT=$(cat)
MSG=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty')
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')
HOOK_CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty')

# The check lives in a variable: bash 3.2 misparses backticks in a heredoc
# nested inside $( ).
read -r -d '' CHECK <<'PY'
import json, os, re
from urllib.parse import unquote

msg = os.environ.get("LG_MSG", "")
path = os.environ.get("LG_TRANSCRIPT", "")


def rows_head(p, limit=200):
    with open(p, encoding="utf-8", errors="replace") as fh:
        for i, line in enumerate(fh):
            if i >= limit:
                return
            try:
                yield json.loads(line)
            except ValueError:
                continue


def is_boundary(o):
    if o.get("type") != "user" or o.get("isMeta") or o.get("isSidechain"):
        return False
    c = (o.get("message") or {}).get("content")
    if isinstance(c, list) and c and all(
            isinstance(b, dict) and b.get("type") == "tool_result" for b in c):
        return False
    return True


def turn_texts(p):
    """Assistant text since the last real prompt. Reads only the tail: the
    current turn is never anywhere near 8 MB, and transcripts reach 100 MB."""
    TAIL = 8 << 20
    with open(p, "rb") as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(max(0, size - TAIL))
        lines = f.read().decode("utf-8", "replace").splitlines()
    out = []
    for line in reversed(lines):
        try:
            o = json.loads(line)
        except ValueError:
            continue
        if is_boundary(o):
            break
        if o.get("type") != "assistant" or o.get("isSidechain"):
            continue
        for b in (o.get("message") or {}).get("content") or []:
            if isinstance(b, dict) and b.get("type") == "text":
                out.append(b.get("text", ""))
    return out


root = os.environ.get("CLAUDE_PROJECT_DIR", "")
texts = [msg]
if path and os.path.isfile(path):
    try:
        if not root:
            root = next((r["cwd"] for r in rows_head(path) if r.get("cwd")), "")
        texts += turn_texts(path)
    except OSError:
        pass
root = root or os.environ.get("LG_CWD", "") or os.getcwd()

LINK = re.compile(r"\[[^\]\n]*\]\(<?([^)\s>]+)>?\)")
broken = []
for text in texts:
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    text = re.sub(r"`[^`\n]*`", "", text)
    for m in LINK.finditer(text):
        target = m.group(1)
        if re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I) or target.startswith("#"):
            continue
        p = unquote(target.split("#", 1)[0])
        if not p:
            continue
        p = os.path.expanduser(p)
        full = p if os.path.isabs(p) else os.path.join(root, p)
        if not os.path.exists(full) and target not in broken:
            broken.append(target)
print(root)
for b in broken:
    print(b)
PY

BROKEN=$(LG_MSG="$MSG" LG_TRANSCRIPT="$TRANSCRIPT" LG_CWD="$HOOK_CWD" python3 -I -c "$CHECK") || exit 0

ROOT=$(printf '%s\n' "$BROKEN" | head -1)
LIST=$(printf '%s\n' "$BROKEN" | tail -n +2)
[ -n "$LIST" ] || exit 0
{
  echo "link-guard: refusing. These links in the reply don't open:"
  printf '%s\n' "$LIST" | sed 's/^/  /'
  echo
  echo "The editor resolves a relative link against the session root, $ROOT,"
  echo "not against the directory the shell is in now. Rewrite each one relative"
  echo "to that root (or as an absolute path) to a file that exists, and check it"
  echo "before sending. 2026-10-11: Caleb clicked a render link written relative"
  echo "to ~/Downloads and got \"Couldn't open that file\"."
} >&2
exit 2
