#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init site-stack-gate.sh 5
# PreToolUse on Write: a landing page or site entry file is never started as a
# hand-rolled static HTML file. It starts from the UX engine and the house
# site stack.
#
# 2026-10-27, the Kyber landing page for an ACAD 185 team: the agent wrote
# public/index.html by hand with the Tailwind CDN script, an eyebrow over every
# heading, 3-card grids, tick lists and a CSS phone mock. ux-pick never ran,
# the house stack (Next.js + motion + lenis) was never scaffolded, and
# site-gate research never ran. Caleb: "Bro it looks so ai slop html/css",
# "Don't we literally have a UX engine?", "Fix chewbs to never do that again".
# interface-first only asks that the interface skill is loaded, and loading it
# did not stop a CDN page, so this asks for the two receipts that would have.
#
# Refused: a Write of .html/.htm, 150+ lines, that is a site page, meaning an
# entry name (index, home, landing) with the Tailwind CDN or a nav and footer,
# or any page with a marketing shape (a nav, a footer and 3+ sections). Allowed
# through once BOTH hold: ux-pick or ux-gen ran in this session, and the
# target repo has the house stack (package.json with next, motion and lenis)
# or a research/INDEX.md from site-gate research. Utility pages (a vote page,
# a 404, taste.html) carry none of the site shapes and pass.
#
# Real damage class, so it denies through the permission decision and exits 0.
# Never exit 2: a red "hook error" is its own complaint
# (team/memory/feedback_hooks_never_show_errors.md).
set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
[ "${CHEWBACCA_SITE_STACK_GATE:-1}" = "0" ] && exit 0
INPUT=$(cat)
[ "$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')" = "Write" ] || exit 0
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')
case "$FILE" in *.html|*.htm) ;; *) exit 0 ;; esac
CONTENT=$(printf '%s' "$INPUT" | jq -r '.tool_input.content // ""')
# 150 lines: the Kyber landing was 689; the real 404 and vote pages run 102 to 179.
LINES=$(printf '%s\n' "$CONTENT" | wc -l | tr -d ' ')
[ "${LINES:-0}" -ge "${SITE_STACK_GATE_MIN_LINES:-150}" ] || exit 0

BASE=$(basename "$FILE" | tr '[:upper:]' '[:lower:]')
has() { printf '%s' "$CONTENT" | grep -qi "$1"; }
SECTIONS=$(printf '%s' "$CONTENT" | grep -oi '<section' | wc -l | tr -d ' ')
ENTRY=0
case "$BASE" in index.html|index.htm|home.html|landing.html|landing-page.html) ENTRY=1 ;; esac
SITE=""
# Measured on real pages, 2026-10-27: the Kyber taste vote (179 lines) loads
# the CDN too, with no nav or footer, and a study app's index.html has neither,
# so the CDN or the name alone is not a site. The Kyber landing (689 lines)
# had the CDN, a nav, a footer and 10 sections.
if [ "$ENTRY" = 1 ] && has 'cdn\.tailwindcss\.com'; then
  SITE="it is a site entry file on the Tailwind CDN"
elif [ "$ENTRY" = 1 ] && has '<nav' && has '<footer'; then
  SITE="it is a site entry file in raw HTML"
elif has '<nav' && has '<footer' && [ "${SECTIONS:-0}" -ge 3 ]; then
  SITE="it is a full marketing page in raw HTML"
fi
[ -n "$SITE" ] || exit 0

# Receipt 1: ux-pick or ux-gen ran as a command in this session. grep reads
# all of tail's output on purpose: under pipefail, grep -q exits on the first
# hit, tail dies of SIGPIPE, and the pipeline reads as false. That refused a
# real ux-pick run three times on 2026-10-27 (Medrano, 17 MB transcript). The match is
# on the JSON "command" field of a tool call, so this hook's own refusal text,
# which names ux-pick, never counts as a run.
RAN_UX=0
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] \
   && tail -c 3000000 "$TRANSCRIPT" | grep -E '"command": ?"[^"]*ux-(pick|gen)([^A-Za-z-]|$)' >/dev/null; then
  RAN_UX=1
fi

# Receipt 2: the target repo has the house stack or the research receipt.
# Walk up from the file to the repo root (or 8 levels), checking each level.
HAS_STACK=0
DIR=$(dirname "$FILE")
for _ in 1 2 3 4 5 6 7 8; do
  if [ -f "$DIR/package.json" ] && grep -q '"next"' "$DIR/package.json" \
     && grep -q '"motion"' "$DIR/package.json" && grep -q '"lenis"' "$DIR/package.json"; then
    HAS_STACK=1; break
  fi
  _receipt="research/INDEX.md"  # in the target repo, from site-gate research
  if [ -f "$DIR/$_receipt" ]; then HAS_STACK=1; break; fi
  [ -d "$DIR/.git" ] && break
  PARENT=$(dirname "$DIR"); [ "$PARENT" = "$DIR" ] && break; DIR="$PARENT"
done

[ "$RAN_UX" = 1 ] && [ "$HAS_STACK" = 1 ] && exit 0

MISSING=""
[ "$RAN_UX" = 1 ] || MISSING="ux-pick has not run this session"
[ "$HAS_STACK" = 1 ] || MISSING="${MISSING:+$MISSING, and }the repo has no Next.js + motion + lenis package.json and no research/INDEX.md"
REASON="Not writing $(basename "$FILE") ($LINES lines): $SITE, and $MISSING. Sites start from the UX engine and the house stack, never a hand-rolled HTML file. Next steps, in order: 1) run apps/ux-engine/bin/ux-pick \"<brief>\" and follow the system and refusals it prints; 2) scaffold Next.js with motion and lenis (the house stack, as in TTS-Dev's package.json); 3) run site-gate research and fill research/. On 2026-10-27 a Kyber landing page skipped all three and Caleb called it ai slop html/css."
type hook_verdict >/dev/null 2>&1 && hook_verdict refuse "$REASON"
jq -n --arg r "$REASON" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
exit 0
