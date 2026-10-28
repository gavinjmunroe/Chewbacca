#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init gtm-reuse-gate.sh 5
# PreToolUse on Write: a script that scores, tiers or picks leads is built on the
# rubrics ported from BMA, Amber and Togari (tools/gtme_score.py), never a fresh
# hand-rolled scorer.
#
# 2026-10-27, a lead list for John Knox (Medrano Partners): the agent wrote its own
# score.py with made-up tiers and keyword checks, and a why-now regex that matched a
# baseball trade and the wrong state's First Baptist, while gtme_score already held
# Togari's primary-contact picker, the tier 1/2/3 account rubric and the 1 to 10
# signal score with HOLD under 6. Caleb: "USE ALL THE STUFF WE LEARNED FROM
# BMA?AMBER/TOGARI", then "Fix chewbs to NEVER not use the goated stuff ... Make
# that weaved in to its veins".
#
# Refused: a Write of a .py, .js or .ts file of 30+ lines that reads as lead
# scoring (a lead, contact, account or prospect word AND a score, tier or rank
# word, both 3+ times) and never names gtme_score / gtme-score. The refusal hands
# over the import line, so the right move is the easy one.
#
# Real damage class (a scorer the client sees that the team already rebuilt
# better), so it denies through the permission decision and exits 0. Never exit 2.
set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
[ "${CHEWBACCA_GTM_REUSE_GATE:-1}" = "0" ] && exit 0
INPUT=$(cat)
[ "$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')" = "Write" ] || exit 0
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')
case "$FILE" in *.py|*.js|*.ts|*.mjs) ;; *) exit 0 ;; esac
case "$(basename "$FILE")" in gtme_score.py|test_*|*_test.py) exit 0 ;; esac
CONTENT=$(printf '%s' "$INPUT" | jq -r '.tool_input.content // ""')
# 30 lines: the Medrano score.py was 92; a one-off reshaping snippet stays under it.
LINES=$(printf '%s\n' "$CONTENT" | wc -l | tr -d ' ')
[ "${LINES:-0}" -ge 30 ] || exit 0
printf '%s' "$CONTENT" | grep -qiE 'gtme[_-]score' && exit 0
WHO=$(printf '%s' "$CONTENT" | grep -oiE '\b(leads?|contacts?|accounts?|prospects?|buyers?)\b' | wc -l | tr -d ' ')
HOW=$(printf '%s' "$CONTENT" | grep -oiE '\b(score[sd]?|scoring|tiers?|rank(ed|ing)?|why[_ -]?now)\b' | wc -l | tr -d ' ')
[ "${WHO:-0}" -ge 3 ] && [ "${HOW:-0}" -ge 3 ] || exit 0

REASON="Not writing $(basename "$FILE"): it scores or tiers leads and never uses the BMA/Togari rubrics in tools/gtme_score.py. Build on them: sys.path.insert(0, os.path.expanduser('~/.chewbacca/kit/current/tools')); import gtme_score, then resolve_primary(candidates, titles) to pick the buyer, signal_strength(signals) for why-now (sourced, dated, scope company|industry|category; HOLD under 6), assign_tier(fit_score, has_primary_contact, company, criteria) for tier 1/2/3, quality_score(contact) and calculate_affiliation(...) for contact checks. The rules are in skills/gtm-engineering/references/bma/scoring.md. On 2026-10-27 a hand-rolled Medrano scorer matched a baseball trade as a church's why-now."
type hook_verdict >/dev/null 2>&1 && hook_verdict refuse "$REASON"
jq -n --arg r "$REASON" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
exit 0
