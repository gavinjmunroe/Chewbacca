#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init artifact-guard.sh 5
# PreToolUse on Artifact: refuse publishing a Claude Artifact. Reading,
# listing, opening, quickstart and delete stay allowed, so an old one can
# still be read or taken down.
#
# CLAUDE.md: "Never publish a Claude Artifact. Make it a git repo and push it
# to GitHub instead" (feedback_no_artifacts_ship_repos). The host's prompt says
# the opposite in every session, and until 2026-10-12 only the prose stood
# against it (docs/plans/context-budget.md, "prose only").
#
# A person who wants artifacts turns it off: CHEWBACCA_ARTIFACTS=1.
# Denies through the permission decision and exits 0, never exit 2
# (feedback_hooks_never_show_errors).
set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
[ "${CHEWBACCA_ARTIFACTS:-0}" = "1" ] && exit 0
INPUT=$(cat)
[ "$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')" = "Artifact" ] || exit 0
action="$(printf '%s' "$INPUT" | jq -r '.tool_input.action // "publish"')"
case "$action" in
  read|list|open|quickstart|delete|unpin) exit 0 ;;
esac

REASON="artifact-guard: CLAUDE.md says never publish a Claude Artifact; deliverables ship as git repos. Put it in a repo (CLAUDE.md, README, data/), push it to GitHub with gh repo create, and give the URL. A file someone uses goes to ~/Downloads (.md to edit, PDF to send)."
type hook_verdict >/dev/null 2>&1 && hook_verdict refuse "$REASON"
jq -n --arg r "$REASON" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
exit 0
