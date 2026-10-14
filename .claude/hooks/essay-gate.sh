#!/bin/bash
# hookd skips this guard for a Bash call that names none of these words,
# each one its first check requires. Proven by tools/hookd_replay.py.
# gate: gws
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init essay-gate.sh 15
# PreToolUse: refuse writing prose into a Google Doc when it reads as
# generated.
#
# Written 2026-10-11. A 1,285-word Miyake half went into Caleb's team paper
# through `gws docs documents batchUpdate`. The default slop-check scored it 6
# (clean). Andy, a teammate who hand-wrote the Douglas half, read it once and
# DM'd that he didn't love "the slop version" and didn't feel good submitting
# it. `slop-check --essay` scores that same text 48 and Andy's section 9, so
# 20 (the "rewrite" line) sits between them. Caleb: "never make this fucking
# mistake ever again". Short edits (a typo, a citation) are under 150 words and
# pass untouched.
#
# Exit 2 blocks the call.

set -uo pipefail
payload="$(cat)"
tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)"
[ "$tool" = "Bash" ] || exit 0
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
printf '%s' "$cmd" | grep -qE 'gws[^|;&]*docs' || exit 0
printf '%s' "$cmd" | grep -qE 'batchUpdate|\+write' || exit 0

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
slop="$root/bin/slop-check"
[ -x "$slop" ] || slop="$(command -v slop-check 2>/dev/null)"
[ -n "$slop" ] || exit 0

text="$(CMD="$cmd" /usr/bin/python3 -I - <<'PY'
import json, os, re
cmd = os.environ["CMD"]
blobs = []
# --json "$(cat FILE)" is how a big batch is passed; read the file it names.
for path in re.findall(r"\$\(cat\s+([^)\s]+)\)", cmd):
    path = os.path.expandvars(os.path.expanduser(path.strip("'\"")))
    try:
        blobs.append(open(path).read())
    except OSError:
        pass
for m in re.finditer(r"--json\s+'((?:[^']|'\\'')*)'", cmd):
    blobs.append(m.group(1))
# gws docs +write takes the text itself.
for m in re.finditer(r"--text\s+(?:'([^']*)'|\"([^\"]*)\")", cmd):
    print(m.group(1) or m.group(2))
for b in blobs:
    try:
        data = json.loads(b)
    except ValueError:
        continue
    for r in data.get("requests", []) if isinstance(data, dict) else []:
        if "insertText" in r:
            print(r["insertText"].get("text", ""))
        if "replaceAllText" in r:
            print(r["replaceAllText"].get("replaceText", ""))
PY
)"
words=$(printf '%s' "$text" | wc -w | tr -d ' ')
[ "${words:-0}" -ge 150 ] || exit 0

# A section-sized write needs a written spec behind it. On 2026-10-13 the
# Miyake section was one-shot five times in an hour and each version read
# worse than Andy's; the one that held up came from MIYAKE-SECTION-SPEC.md,
# Andy's paragraphs broken into jobs and Miyake's verified facts mapped onto
# them. Caleb: "never 1 shot anything creative EVER". 300 words is about one
# double-spaced page, past any typo fix or added citation.
if [ "${words:-0}" -ge 300 ]; then
  spec_dirs="${ESSAY_SPEC_DIRS:-$HOME/coursework $HOME/Downloads $HOME/second-brain/coursework ${CLAUDE_PROJECT_DIR:-$PWD}}"
  found=""
  for d in $spec_dirs; do
    [ -d "$d" ] || continue
    found="$(find "$d" -maxdepth 5 -type f \( -iname '*SPEC*.md' -o -iname '*OUTLINE*.md' \) -mmin -1440 2>/dev/null | head -1)"
    [ -n "$found" ] && break
  done
  if [ -z "$found" ]; then
    cat >&2 <<MSG
essay-gate: refusing. This puts $words words of prose into a Google Doc and
no spec or outline (a *SPEC*.md or *OUTLINE*.md file from the last 24 hours)
exists behind it. Creative writing is never one-shot: break the model text
into what each paragraph does, map verified facts onto those jobs, draft one
paragraph at a time against its counterpart, then gate each paragraph. See
"Never one-shot creative work" in .claude/rules/research-the-craft.md.
MSG
    exit 2
  fi
fi

report="$(printf '%s' "$text" | /usr/bin/python3 "$slop" --stdin --essay --issues 2>/dev/null)"
score="$(printf '%s' "$report" | head -1 | awk '{print $1}')"
case "$score" in ''|*[!0-9]*) exit 0 ;; esac
[ "$score" -ge 20 ] || exit 0

cat >&2 <<MSG
essay-gate: refusing. This puts $words words of prose into a Google Doc and
\`slop-check --essay\` scores it $score ("rewrite"; the teammate's hand-written
section that flagged us scored 9).

$(printf '%s' "$report" | sed -n '2,12p')

Rewrite before it goes in: read the teammate's section first and match its
moves, open and close paragraphs on facts, quote one source and say what it
means, pick one specific overlap instead of "both... and both". See the
"Group papers" section of .claude/rules/writing.md.
MSG
exit 2
