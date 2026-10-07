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
# A fake jev first on PATH, before any route call, so the suite never makes
# a paid call: it answers 0.9 for prompts carrying BIG, 0.05 otherwise.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/jev" <<'J'
#!/bin/sh
if grep -q BIG; then s=0.9; else s=0.05; fi
printf '{"answers":{"big":{"type":"noul","noul":%s}}}' "$s"
J
chmod +x "$TMP/bin/jev"
export PATH="$TMP/bin:$PATH"
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
# graphs. "I should never have to tell you." A fake jev on PATH stands in for
# the classifier, so the suite never makes a paid call: it answers 0.9 for
# prompts carrying BIG, 0.05 otherwise.
marked() { rm -f "$CHEWBACCA_HOME/state/skill-required-t1"; route "$1"; [ -s "$CHEWBACCA_HOME/state/skill-required-t1" ]; }

rm -rf "$CHEWBACCA_HOME/state/"*-t1
marked "BIG make chewbacca perfect" && echo "ok    jev yes marks it" || { echo "FAIL  jev yes missed"; fail=1; }
! marked "Thanks bro that worked great" && echo "ok    jev no stays silent" || { echo "FAIL  jev no gated"; fail=1; }
! marked "how do I build a BIG graph in neo4j?" && echo "ok    a question never gates" || { echo "FAIL  gated a question"; fail=1; }

# Jev down: the verb fallback still catches the obvious ones.
for p in "build the Kyber keyboard into amber-ios" "Bro do all the applications" \
         "fix chewbacca so you actually go through with the plans"; do
  BIGWORK_JEV=off marked "$p" && echo "ok    fallback marks: $p" || { echo "FAIL  fallback missed: $p"; fail=1; }
done
BIGWORK_JEV=off marked "fix the typo in the readme" && { echo "FAIL  fallback gated a typo"; fail=1; } || echo "ok    fallback skips a typo fix"

# Loaded once this session means never gated again, by either path.
rm -rf "$CHEWBACCA_HOME/state/"*-t1
[ "$(gate Skill graph-engineering)" = 0 ]
route "BIG build the Kyber keyboard into amber-ios"
route "fan out these independent jobs in parallel instead of running them sequentially, and dedupe the entities"
[ ! -e "$CHEWBACCA_HOME/state/skill-required-t1" ] && echo "ok    already loaded, never gated twice" || { echo "FAIL  re-gated a loaded skill"; fail=1; }

# Behavior backstop: a third distinct file, or an agent spawn, without the
# skill loaded is refused once.
edit() { jq -n --arg f "$1" '{session_id:"t1", tool_name:"Edit", tool_input:{file_path:$f}}' | bash "$ROOT/.claude/hooks/skill-gate.sh" >/dev/null 2>&1; echo $?; }
rm -rf "$CHEWBACCA_HOME/state/"*-t1
r="$(edit /a)$(edit /a)$(edit /b)$(edit /c)$(edit /d)"
[ "$r" = "00020" ] && echo "ok    third distinct file refused once" || { echo "FAIL  edit counter gave $r"; fail=1; }
rm -rf "$CHEWBACCA_HOME/state/"*-t1
[ "$(gate Agent)$(gate Agent)" = "20" ] && echo "ok    agent spawn refused once" || { echo "FAIL  agent spawn not gated once"; fail=1; }
rm -rf "$CHEWBACCA_HOME/state/"*-t1
route "BIG build the onboarding flow"
[ "$(gate Agent)$(gate Agent)" = "20" ] && echo "ok    backstop and prompt marker refuse once total" || { echo "FAIL  refused twice in a row"; fail=1; }
rm -rf "$CHEWBACCA_HOME/state/"*-t1
r="$(edit "$HOME/second-brain/memory/x.md")$(edit /tmp/s)$(edit /a)$(edit /b)"
[ "$r" = "0000" ] && echo "ok    notes and scratch don't count toward three" || { echo "FAIL  notes counted: $r"; fail=1; }
rm -rf "$CHEWBACCA_HOME/state/"*-t1
[ "$(gate Skill graph-engineering)" = 0 ]
r="$(edit /a)$(edit /b)$(edit /c)$(gate Agent)"
[ "$r" = "0000" ] && echo "ok    loaded skill disables the backstop" || { echo "FAIL  backstop fired after load: $r"; fail=1; }
exit $fail
