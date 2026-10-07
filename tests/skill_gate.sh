#!/bin/bash
# skill-gate: an enforced skill named by skill-route refuses the first tool
# call once, clears on loading the skill, and never loops.
# 2026-09-29: graph-engineering was named and skipped across one session.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export CHEWBACCA_HOME="$TMP/home"
mkdir -p "$CHEWBACCA_HOME/skills/graph-engineering"
cp "$ROOT/skills/graph-engineering/SKILL.md" "$CHEWBACCA_HOME/skills/graph-engineering/"
fail=0
route() { jq -n --arg p "$1" '{prompt:$p, session_id:"t1", cwd:"/tmp"}' | HOME="$TMP" sh "$ROOT/.claude/hooks/skill-route.sh" >/dev/null 2>&1; }
gate() { jq -n --arg t "$1" --arg s "${2:-}" '{session_id:"t1", tool_name:$t, tool_input:{skill:$s}}' | bash "$ROOT/.claude/hooks/skill-gate.sh" >/dev/null 2>&1; echo $?; }

route "fan out these independent jobs in parallel instead of running them sequentially, and dedupe the entities"
[ -s "$CHEWBACCA_HOME/state/skill-required-t1" ] && echo "ok    router marks graph-engineering" || { echo "FAIL  no marker written"; fail=1; }
[ "$(gate Bash)" = 2 ] && echo "ok    first non-skill tool call is refused" || { echo "FAIL  not refused"; fail=1; }
[ "$(gate Bash)" = 0 ] && echo "ok    refuses once, never loops" || { echo "FAIL  refused twice"; fail=1; }

route "fan out these independent jobs in parallel instead of running them sequentially, and dedupe the entities"
[ "$(gate Skill graph-engineering)" = 0 ] && [ "$(gate Bash)" = 0 ] && echo "ok    loading the skill clears the gate" || { echo "FAIL  skill load did not clear"; fail=1; }

rm -f "$CHEWBACCA_HOME/state/skill-required-t1"
route "someone can opt out but every person went on the trip and it needs approval"
[ ! -e "$CHEWBACCA_HOME/state/skill-required-t1" ] && echo "ok    conversational words don't trigger it" || { echo "FAIL  glue words triggered the gate"; fail=1; }

# 2026-10-06: big work gates the skill even when the prompt never sounds like
# graphs. "I should never have to tell you."
rm -f "$CHEWBACCA_HOME/state/"skill-*-t1
for p in "build the Kyber keyboard into amber-ios" \
         "Bro do all the applications" \
         "fix chewbacca so you actually go through with the plans" \
         "scrape every YC company in the batch and enrich the founders"; do
  rm -f "$CHEWBACCA_HOME/state/skill-required-t1"
  route "$p"
  [ -s "$CHEWBACCA_HOME/state/skill-required-t1" ] && echo "ok    big work marks it: $p" || { echo "FAIL  big work missed: $p"; fail=1; }
done
for p in "fix the typo in the readme" "how do I build a graph in neo4j?" "Lol I'm cooked"; do
  rm -f "$CHEWBACCA_HOME/state/skill-required-t1"
  route "$p"
  [ ! -e "$CHEWBACCA_HOME/state/skill-required-t1" ] && echo "ok    small or a question stays silent: $p" || { echo "FAIL  gated small work: $p"; fail=1; }
done

# Loaded once this session means never gated again, by either path.
rm -f "$CHEWBACCA_HOME/state/"skill-*-t1
[ "$(gate Skill graph-engineering)" = 0 ]
route "build the Kyber keyboard into amber-ios"
route "fan out these independent jobs in parallel instead of running them sequentially, and dedupe the entities"
[ ! -e "$CHEWBACCA_HOME/state/skill-required-t1" ] && echo "ok    already loaded, never gated twice" || { echo "FAIL  re-gated a loaded skill"; fail=1; }
exit $fail
