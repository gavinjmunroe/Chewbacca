#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init dough-brief-gate.sh 5
# PreToolUse on Agent, Task and Workflow: a subagent sent to do GTM work (leads,
# enrichment, why-now, outbound) is briefed on the engine Chewbacca already has
# (Dough: gtme, gtme_score, gtme-lookup, Togari, Jev, gtme-dnc, gtme-dedupe,
# gtme-grade), never handed plain web search and its own judgement.
#
# 2026-10-29, the Medrano lead sheet: a 145-row why-now and buyer enrichment went
# to a subagent whose brief named gtme_score once and said "web search ... fine"
# for the rest. gtm-reuse-gate only reads Write, so nothing caught it. Caleb:
# "Remember to use the DOPE GTM/BMA/TOGARI/CHEWBS/JEV STUFF ... I SHOULD NEVER
# HAVE TO SAY THIS FIX CHEWBS/DOUHG ... IT SHOULD BE BUILT IN". The same day
# another tab got "FIX CHEWBS TO ALWAYS USE THEM NOT J BLINDLY CHOOSE AN ICP".
#
# Refused: a prompt with 3+ GTM-work words where any kind of work it asks for
# (buyers, why-now, copy, list cleaning) has no engine tool named for it.
# The refusal hands over the block to paste, so the right brief is the easy one.
# Denies through the permission decision and exits 0. Never exit 2.
set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
[ "${CHEWBACCA_DOUGH_BRIEF_GATE:-1}" = "0" ] && exit 0
INPUT=$(cat)
case "$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')" in Agent|Task|Workflow) ;; *) exit 0 ;; esac
PROMPT=$(printf '%s' "$INPUT" | jq -r '[.tool_input.prompt, .tool_input.script, .tool_input.description] | map(select(. != null)) | join("\n")')
[ -n "$PROMPT" ] || exit 0

# 3 words: the Medrano brief carried 20+; a one-off mention of "leads" in an
# unrelated brief stays under it. Guessed from that one brief, never measured wider.
WORK=$(printf '%s' "$PROMPT" | grep -oiE "\b(leads?|lead list|prospects?|prospecting|enrich(ment|ed|ing)?|why[_ -]?now|icp|outbound|cold email|decision makers?|buyer emails?|buying signals?|lookalikes?)\b" | wc -l | tr -d ' ')
[ "${WORK:-0}" -ge 3 ] || exit 0

# Each kind of GTM work the brief asks for needs its engine tool named. The real
# 10/29 Medrano brief named gtme_score and Togari Exa (two tools) and still sent
# buyers, emails and copy to web search, so a plain tool count let it through.
P=$(printf '%s' "$PROMPT" | tr 'A-Z' 'a-z')
MISSING=""
need(){ printf '%s' "$P" | grep -qE "$1" && ! printf '%s' "$P" | grep -qE "$2" && MISSING="$MISSING $3"; }
need 'decision makers?|buyers?|buyer emails?|contacts?' 'gtme-lookup|zoominfo|resolve_primary' 'buyers(gtme-lookup/zoominfo)'
need 'why[_ -]?now|signals?' 'signal_strength|gtme-signals' 'why-now(signal_strength)'
need 'first emails?|cold emails?|email drafts?|\bcopy\b|sequences?' 'gtme-grade' 'copy(gtme-grade)'
need 'leads?|lists?|emails?' 'gtme-dnc|gtme-dedupe' 'clean(gtme-dnc/gtme-dedupe)'
[ -z "$MISSING" ] && exit 0

REASON="Missing engine tools for:$MISSING. This brief sends GTM work to a subagent without the engine Chewbacca already has, so it will rebuild worse versions with web search. Add this block to the prompt and resend: Use the Dough engine (read ~/code/chewbacca/team/memory/feedback_dough_is_the_built_engine.md and ~/.chewbacca/dough/current/skills/gtm-engineering/SKILL.md first). Buyers and emails: gtme-lookup zoominfo person-search and mcp__togari__togari_zoominfo_person_search / togari_enrich, then gtme_score.resolve_primary and quality_score; keep only verified emails, never a guessed pattern. Why-now: mcp__togari__togari_exa_search and the org's own pages, gtme-signals formd for raises, every signal through gtme_score.signal_strength (sourced, dated, HOLD under 6), and a Jev yes/no on whether the signal is really about that org. Tiers: gtme_score.assign_tier. Clean: gtme-dnc check and gtme-dedupe before anything ships. Copy: gtme-grade (Sagar's rules) on every draft. Building an account list from scratch? Run chewbacca gtme accounts --client <slug> instead of a subagent: it runs the source, site audit, gtme_score, a Jev buyer check, gtme-dedupe, gtme-dnc, the people store and treg pricing on every row. Write METHOD.md saying which tool filled each column. Caleb, 2026-10-29: 'I SHOULD NEVER HAVE TO SAY THIS ... IT SHOULD BE BUILT IN'."
type hook_verdict >/dev/null 2>&1 && hook_verdict refuse "$REASON"
jq -n --arg r "$REASON" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
exit 0
