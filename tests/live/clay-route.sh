#!/usr/bin/env bash
# Live: questions about what is in Clay reach clay-navigation, which answers
# them through `chewbacca clay <op>` instead of opening the page.
#
# Caleb, 2026-10-10: "it's so annoying that we open clay way too much." Twelve
# real-shaped Clay questions were run through skill-route that morning: zero
# reached a skill that names `chewbacca clay`. clay-playbooks (a third-party
# playbook pack) took six, and clay-navigation's description talked only about
# driving the UI. After the description named the questions and the ops, every
# question that says Clay routed to clay-navigation on the warm vector path.
#
# Needs the local embedding model, so it lives here and not in tests/run.sh.
# The controls are prompts that must keep going where they went before.
source "$(dirname "${BASH_SOURCE[0]}")/harness.sh"
need ollama "— run: chewbacca setup"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK="$REPO/.claude/hooks/skill-route.sh"
# The meaning matcher is opt-in since 2026-10-17 (SKILL_ROUTE_MEANING=on; held-out
# precision 10.9% on, 12.8% off, tests/live/skill-route-eval.sh). These cases test that
# matcher, so they turn it on.
export SKILL_ROUTE_MEANING=on

# Prints the routed skill name, or "-" when the router stays silent.
route() {
  printf '%s' "$1" \
    | python3 -c 'import json,sys; print(json.dumps({"prompt": sys.stdin.read(), "cwd": "/nowhere"}))' \
    | lt 20 bash "$HOOK" 2>/dev/null \
    | python3 -c '
import json, re, sys
raw = sys.stdin.read().strip()
if not raw:
    print("-"); raise SystemExit
ctx = json.loads(raw)["hookSpecificOutput"]["additionalContext"]
m = re.search(r"\n  (\S+)  \(", ctx)
print(m.group(1) if m else "-")'
}
routes_to() { [ "$(route "$2")" = "$1" ]; }

# A cold vector cache makes the router fall back to keywords for one prompt
# while a detached child embeds the catalog. Warm it, then wait for the file.
route "warm the cache" >/dev/null
for _ in $(seq 1 30); do
  ls "${CHEWBACCA_HOME:-$HOME/.chewbacca}"/cache/skill-vectors-*.json >/dev/null 2>&1 \
    && [ -z "$(ls "${CHEWBACCA_HOME:-$HOME/.chewbacca}"/cache/*.tmp 2>/dev/null)" ] && break
  sleep 2
done
# The query embed has a 1.5 s budget; the first one after a load can miss it.
route "warm the model" >/dev/null

while IFS= read -r q; do
  ok "clay: $q" routes_to clay-navigation "$q"
done <<'Q'
pull the leads from the clay table and show me who has no work email
what's our clay credit balance and what burned credits this week
is auto-run on for the investors table in clay
which clay workflows ran today
what's in the clay blocklist
go into clay and see why the claygent column failed
Q

# "book more meetings from cold email" already goes to the third-party cold-email
# skill on the installed catalog (gtm-route.sh fails it before and after this
# change), so the control is one gtm-engineering still owns.
ok "control: a GTM ask still goes to gtm-engineering"   routes_to gtm-engineering "we gotta make chewbs a gtm monster"
ok "control: small talk routes nowhere"                 routes_to - "whats the weather"

mutant "a Clay read is not routed to clay-playbooks" routes_to clay-playbooks "what's our clay credit balance and what burned credits this week"

finish
