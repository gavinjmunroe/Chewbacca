#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init skim-guard.sh 10
# Stop hook: refuse a reply that claims it read everything when the session
# only read part of some source.
#
# WHAT HAPPENED, 2026-10-22. Caleb asked for every ACAD 185 slide, link and
# template to be ingested into the kit. Two lecture decks were read through
# `head -260` and `cut -c1-240`, so the end of "Visual Storytelling 2" (the
# "Building a Funnel" section) never got read, and four decks got no notes
# file. The reply said the class was in. He asked "Did you ingest everything
# or just skim?", then: "Fix chewbs to never skim."
#
# WHAT IT ENFORCES. When a reply claims full coverage (read all, every line,
# ingested everything, went through each), every document this session read
# with a truncating command (head, tail, cut -c, sed -n a,bp, a Read with a
# limit) must also have been read whole later. Otherwise the reply is refused
# with the files named. A reply that says what was skimmed, or carries a
# NOT READ / BLOCKED: line, goes through: an honest partial is fine, a
# false "all" is not.
#
# WHAT IT DOESN'T DO. It sees this session's own tool calls, not a subagent's,
# and it can't tell whether a whole read was understood. It closes the hole
# that actually happened: a truncated read reported as a full one.

command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)
MSG=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty')
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')
[ -n "$MSG" ] && [ -f "$TRANSCRIPT" ] || exit 0

VERDICT=$(SG_MSG="$MSG" SG_TRANSCRIPT="$TRANSCRIPT" python3 -I - <<'PY'
import json, os, re, shlex

msg = os.environ["SG_MSG"]
CLAIM = re.compile(
    r"\b(read|went through|ingested|covered|reviewed|pulled in)\b[^.\n]{0,40}\b(all|every|everything|each|whole|fully|entire)\b"
    r"|\bevery (line|page|slide|deck|file|doc)\b|\bfully (read|ingested)\b|\bingested (it|them|everything|all)\b"
    r"|\beverything got (pulled|read|ingested)\b",
    re.I)
HONEST = re.compile(r"\bskim\w*|\bNOT READ\b|BLOCKED:|\bpartially\b|\bcut (it|them) off\b", re.I)
if not CLAIM.search(msg) or HONEST.search(msg):
    print("ok"); raise SystemExit

DOC = re.compile(r"[\x22\x27]?([^\s\x22\x27|;&<>]*?\.(?:txt|md|csv|pdf|html|json|docx|xlsx|srt|vtt))[\x22\x27]?", re.I)
TRUNC = re.compile(r"\|\s*(head|tail)\b|\b(head|tail)\s+-|\|\s*cut\s+-c|\bcut\s+-c|\bsed\s+-n\s+[\x27\x22]?\d+,\d+p|\bawk\b[^|]*NR\s*[<>]")
READERS = {"cat", "nl", "less", "head", "tail", "cut", "sed", "awk", "grep"}
READER = re.compile(r"\b(cat|less|grep|sed|awk|head|tail|cut|python3?)\b")

state = {}    # key: "partial" | "full"
written = set()   # files this session wrote itself: checking its own output is not reading a source
ranges = {}   # key: list of (start, end) line ranges read
paths = {}    # key: resolved path, when one exists on disk

def key_of(path, cwd):
    path = path.strip("\x27\x22")
    full = os.path.expanduser(path)
    if not os.path.isabs(full) and cwd:
        full = os.path.join(os.path.expanduser(cwd), full)
    k = os.path.basename(path)
    if os.path.isfile(full):
        paths[k] = full
    return k

def doc_tokens(cmd):
    """Document paths named in a shell command, quoted names with spaces kept whole."""
    try:
        toks = shlex.split(cmd, posix=True)
    except ValueError:
        toks = [m.group(1) for m in DOC.finditer(cmd)]
    out = []
    for t in toks:
        t = t.strip(";|&()")
        if not t or t.startswith("-") or any(c in t for c in "$*{}=<>"):
            continue
        if re.search(r"\.(txt|md|csv|pdf|html|json|docx|xlsx|srt|vtt)$", t, re.I):
            out.append(t)
    return out

def mark(k, how, rng=None):
    if not k:
        return
    if rng:
        ranges.setdefault(k, []).append(rng)
    if how == "full" or state.get(k) != "full":
        state[k] = how

def covered(k):
    """A file read in chunks counts as whole once the chunks reach its last line."""
    p, rs = paths.get(k), sorted(ranges.get(k, []))
    if not p or not rs:
        return False
    try:
        total = sum(1 for _ in open(p, encoding="utf-8", errors="replace"))
    except OSError:
        return False
    upto = 0
    for a, b in rs:
        if a > upto + 1:
            return False
        upto = max(upto, b)
    return upto >= total

with open(os.environ["SG_TRANSCRIPT"], encoding="utf-8", errors="replace") as fh:
    for line in fh:
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if row.get("type") != "assistant":
            continue
        cwd = row.get("cwd") or ""
        for block in (row.get("message") or {}).get("content") or []:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            name, inp = block.get("name"), block.get("input") or {}
            if name in ("Write", "Edit", "NotebookEdit"):
                written.add(os.path.basename(inp.get("file_path") or ""))
                continue
            if name == "Read":
                p = inp.get("file_path") or ""
                if not DOC.search(p):
                    continue
                k = key_of(p, "")
                if inp.get("limit"):
                    a = int(inp.get("offset") or 1)
                    mark(k, "partial", (a, a + int(inp["limit"]) - 1))
                else:
                    mark(k, "full")
            elif name == "Bash":
                cmd = inp.get("command") or ""
                cd = re.search(r"\bcd\s+(\S+)", cmd)
                here = cd.group(1).strip("\x27\x22") if cd else cwd
                # Only files handed to a reading command count: a file passed to
                # slop-check or pdftotext and then piped to tail was not read.
                loops = {m.group(1): doc_tokens(m.group(2))
                         for m in re.finditer(r"\bfor\s+(\w+)\s+in\s+(.*?);\s*do\b", cmd)}
                for pipeline in re.split(r";|&&|\|\||\bdo\b|\bdone\b|\bthen\b", cmd):
                    segs = pipeline.split("|")
                    head_seg = segs[0].strip()
                    words = head_seg.split()
                    if not words or words[0] not in READERS:
                        continue
                    files = doc_tokens(head_seg)
                    for var, listed in loops.items():
                        if re.search(r"\$\{?" + var + r"\b", head_seg):
                            files += listed
                    if not files:
                        continue
                    rng = None
                    m = re.search(r"\bsed\s+-n\s+[\x27\x22]?(\d+),(\d+)p", head_seg)
                    if m:
                        rng = (int(m.group(1)), int(m.group(2)))
                    m = re.search(r"\bhead\s+-n?\s*(\d+)", head_seg)
                    if m and not rng:
                        rng = (1, int(m.group(1)))
                    trunc = rng or words[0] in ("head", "tail", "cut") or TRUNC.search(pipeline)
                    how = "partial" if trunc else ("full" if words[0] in ("cat", "nl", "less") else None)
                    if how is None:
                        continue
                    for f in files:
                        mark(key_of(f, here), how, rng if len(files) == 1 else None)

for k in list(state):
    if state[k] == "partial" and covered(k):
        state[k] = "full"

partial = sorted(n for n, s in state.items() if s == "partial" and n not in written)
more = f"\n...and {len(partial) - 12} more" if len(partial) > 12 else ""
print("skim:" + "\n".join(partial[:12]) + more if partial else "ok")
PY
)

case "$VERDICT" in
  skim:*)
    {
      echo "skim-guard: refusing. This reply says everything was read, and this session"
      echo "read these only in part (head, tail, cut -c, sed -n, or a Read with a limit),"
      echo "with no whole read after:"
      printf '%s\n' "${VERDICT#skim:}" | sed 's/^/  - /'
      echo
      echo "On 2026-10-22 two ACAD 185 decks were read through head -260 and cut -c1-240,"
      echo "the reply said the class was in, and Caleb asked \"Did you ingest everything"
      echo "or just skim?\" then \"Fix chewbs to never skim.\""
      echo
      echo "Read each one whole now (in chunks if it's long), or say plainly which were"
      echo "skimmed or NOT READ and why."
    } >&2
    exit 2 ;;
esac
exit 0
