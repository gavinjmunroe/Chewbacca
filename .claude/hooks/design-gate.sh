#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init design-gate.sh 90
# Stop hook: render the page that was just edited and refuse the turn if it
# is visibly broken.
#
# WHY THIS EXISTS, and it is the same failure three times over.
#
# On 2026-09-23 design-gate was written in ux-engine to catch pages that had
# never been looked at. It exits 2. It was registered in ZERO settings files,
# so it had never once fired. On 2026-09-27 Caleb asked "are you plugged into
# chewbacca?" and the count was: 39 hooks registered, 38 of which police
# prose, shell, git, memory and submissions, and NONE that read a rendered
# image. slop-guard blocked a reply that night over one em dash while a page
# with a collapsed figure, six over-dense plates and no scroll motion of any
# kind shipped untouched across four commits.
#
# That asymmetry is the whole bug. The kit could describe what a good page is
# in four separate documents and had no way to see one.
#
# `feedback_built_but_never_fires`: the bug is wiring, not capability. Prove
# it RAN, not that it exists.
# `feedback_enforce_dont_document`: a repeated mistake needs a gate.
# `feedback_advisory_hooks_do_nothing`: exit 2, or it is a log line.
#
# WHEN IT FIRES. Only when this turn actually edited a rendered file, and only
# when a URL is available to render. Both conditions are cheap to check, and
# both failing is the normal case, so this costs nothing on a shell session.
#
# HOW IT FINDS THE URL, in order:
#   1. .design-gate-url in the project root, which is how a project opts in
#   2. a localhost port already serving, discovered from listening sockets
# No URL means no render, and it says so rather than passing silently. A gate
# that cannot see is reported as blind, never as green.
set -uo pipefail

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

PROMPT_ID=$(printf '%s' "$INPUT" | jq -r '.prompt_id // .session_id // "unknown"')
GUARD="${TMPDIR:-/tmp}/design-gate-$PROMPT_ID"
[ -f "$GUARD" ] && exit 0

GATE="$HOME/Desktop/2026-Code/ux-engine/bin/design-gate"
[ -x "$GATE" ] || exit 0

TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')
[ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] || exit 0

# Did this turn write anything that renders? Only the tail is read, because a
# 60MB transcript scanned on every Stop is its own outage.
EDITED=$(tail -c 400000 "$TRANSCRIPT" 2>/dev/null \
  | grep -oE '"file_path":"[^"]+\.(html|css|jsx|tsx|vue|svelte)"' \
  | sed 's/.*"file_path":"//;s/"$//' | tail -40 | sort -u)
# app.js and similar only count when they sit beside a page, so a Node script
# named app.js in a server repo does not drag a browser into the turn.
EXTRA=$(tail -c 400000 "$TRANSCRIPT" 2>/dev/null \
  | grep -oE '"file_path":"[^"]+\.js"' | sed 's/.*"file_path":"//;s/"$//' | sort -u \
  | while read -r f; do
      d=$(dirname "$f")
      if ls "$d"/*.html "$d"/../*.html >/dev/null 2>&1; then echo "$f"; fi
    done)
EDITED=$(printf '%s\n%s\n' "$EDITED" "$EXTRA" | grep -v '^$' | sort -u)
[ -n "$EDITED" ] || exit 0

# The project root is the nearest ancestor holding a marker.
FIRST=$(printf '%s\n' "$EDITED" | head -1)
ROOT=$(dirname "$FIRST")
for _ in 1 2 3 4 5; do
  [ -e "$ROOT/index.html" ] || [ -e "$ROOT/package.json" ] || [ -d "$ROOT/.git" ] && break
  ROOT=$(dirname "$ROOT")
done

URL=""
if [ -f "$ROOT/.design-gate-url" ]; then
  URL=$(head -1 "$ROOT/.design-gate-url" | tr -d '[:space:]')
else
  # Any LISTENing localhost port that serves THIS project.
  #
  # The first version of this took the highest-numbered listening port and
  # refused a page that turned out to be an unrelated service on an ephemeral
  # port: it rendered six identical blank frames and reported them as defects
  # in a page it had never loaded. A gate that refuses the WRONG page is worse
  # than no gate, because the defects it names are real and unfindable.
  #
  # So a candidate has to prove it is the right server, by serving a string
  # that appears in this project's own index.html. Ephemeral ports above
  # 32768 are skipped outright; a dev server does not live up there.
  NEEDLE=""
  [ -f "$ROOT/index.html" ] && NEEDLE=$(grep -oE '<title>[^<]{3,60}</title>' "$ROOT/index.html" \
      | head -1 | sed 's/<[^>]*>//g' | cut -c1-40)
  for PORT in $(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null \
                | awk '$9 ~ /(127\.0\.0\.1|\*|\[::1\]):[0-9]+$/ {sub(/.*:/,"",$9); print $9}' \
                | sort -un | awk '$1 < 32768' | head -16); do
    BODY=$(curl -s --max-time 2 "http://localhost:$PORT/" 2>/dev/null | head -c 20000)
    [ -n "$BODY" ] || continue
    if [ -n "$NEEDLE" ]; then
      case "$BODY" in *"$NEEDLE"*) URL="http://localhost:$PORT/"; break;; esac
    fi
  done
fi

touch "$GUARD"

if [ -z "$URL" ]; then
  # Blind, not green. Saying so is the whole point: a gate that quietly passes
  # when it cannot see is worse than no gate, because it reads as a green tick.
  cat >&2 <<EOF
design-gate: rendered files changed and NO URL was available, so the page was
never looked at this turn.

  changed: $(printf '%s' "$EDITED" | tr '\n' ' ')

Serve it and re-run, or write the URL to $ROOT/.design-gate-url so this gate
can see it on every future turn.
EOF
  exit 2
fi

OUT=$("$GATE" "$URL" --shots 6 2>&1)
STATUS=$?

if [ $STATUS -ne 0 ]; then
  printf 'design-gate REFUSED %s\n\n%s\n\nFix the defects above before ending the turn. This gate has no taste: it\ncatches unreadable type, collided scenes and pages with no focal point, so a\nfailure here is broken rather than merely unfashionable.\n' \
    "$URL" "$OUT" >&2
  exit 2
fi
exit 0
