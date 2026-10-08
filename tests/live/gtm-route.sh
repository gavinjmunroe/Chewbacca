#!/usr/bin/env bash
# Live: GTM requests reach the gtm-engineering skill through the real router.
#
# On 2026-10-07 Sagar set Chewbacca's first product as a growth engineer that
# books meetings from an offer, and Caleb said "we gotta make sure chewbs is
# always a gtm monster". Five GTM prompts were then run through skill-route:
# zero reached gtm-engineering. "book more meetings from cold email" went to
# the public-speaking skill, "make chewbs a gtm monster" to the team board, and
# three got nothing, because the description only talked about operating Clay.
#
# Needs the local embedding model, so it lives here and not in tests/run.sh.
# The controls are prompts that must keep going where they went before the
# description was widened: a wider description that steals them is a regression.
source "$(dirname "${BASH_SOURCE[0]}")/harness.sh"
need ollama "— run: chewbacca setup"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK="$REPO/.claude/hooks/skill-route.sh"

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

while IFS= read -r q; do
  ok "gtm: $q" routes_to gtm-engineering "$q"
done <<'Q'
build a demand gen playbook for jonahs offer
book more meetings from cold email
set up an outbound campaign for a new client
how do the best agencies run outbound
we gotta make chewbs a gtm monster
get money in the door with a growth engine
Q

ok "control: a keynote still goes to speaking" routes_to speaking "help me prep a keynote talk for a conference"
ok "control: the team board keeps its own"      routes_to team "what is gavin working on this week"
ok "control: small talk routes nowhere"         routes_to - "whats the weather"

mutant "a GTM prompt is not routed to speaking" routes_to speaking "book more meetings from cold email"

finish
