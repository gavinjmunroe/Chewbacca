#!/bin/bash
# dough-brief-gate must refuse a GTM subagent brief that skips the engine, pass
# one that names it, and stay out of the way for unrelated agents.
#
# The incident, 2026-10-29: the Medrano why-now enrichment went to a subagent
# told "web search ... fine", with gtme_score named once. Caleb: "I SHOULD NEVER
# HAVE TO SAY THIS FIX CHEWBS/DOUHG".
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/dough-brief-gate.sh"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }
command -v jq >/dev/null 2>&1 || { echo "  skip: jq not installed"; exit 0; }

run(){ jq -n --arg t "$1" --arg p "$2" '{tool_name:$t, tool_input:{prompt:$p}}' | HOOK_JUDGE_STUB="${STUB-0.9}" bash "$HOOK"; }
denied(){ printf '%s' "$1" | grep -q '"permissionDecision": "deny"'; }

BLIND="Enrich the 145 leads: find a why-now for each, the decision maker and buyer email. Web search is fine. Then write a first cold email per lead."
OUT=$(run Agent "$BLIND"); denied "$OUT" && ok "refuses the 10/29 Medrano-shaped brief" || no "should refuse a GTM brief with no engine"
printf '%s' "$OUT" | grep -q "gtme-lookup" && ok "refusal hands over the engine block" || no "refusal should name gtme-lookup"

ONCE="Enrich the 145 leads with a why-now and buyer email using gtme_score.signal_strength. Web search for the rest."
denied "$(run Agent "$ONCE")" && ok "one engine name is not enough" || no "a single gtme_score mention should still refuse"

GOOD="Enrich the 145 leads: why-now via togari exa and gtme_score.signal_strength, buyers via gtme-lookup, gtme-dnc before shipping."
[ -z "$(run Agent "$GOOD")" ] && ok "passes a brief that uses the engine" || no "should pass an engine brief"

[ -z "$(run Task "$BLIND")" ] && no "Task tool should be gated too" || ok "gates Task the same way"
[ -z "$(run Bash "$BLIND")" ] && ok "ignores non-agent tools" || no "should ignore Bash"
[ -z "$(run Agent "Fix the CSS on the team page so the photos line up on mobile.")" ] && ok "ignores unrelated briefs" || no "should ignore non-GTM work"
[ -z "$(STUB=0.1 run Agent "$BLIND")" ] && ok "Jev reads no lead work, no refusal" || no "refused against Jev"
[ -z "$(STUB="" run Agent "$BLIND")" ] && ok "Jev down means no refusal" || no "refused with no judgment"
[ -z "$(CHEWBACCA_DOUGH_BRIEF_GATE=0 run Agent "$BLIND")" ] && ok "off switch works" || no "env off switch should exit quietly"

printf '\n  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
