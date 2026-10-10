#!/bin/bash
# client-rulings.sh puts a client's standing rulings into context when the
# prompt names the client, and stays silent otherwise.
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/client-rulings.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }
mkdir -p "$T/acme-gtme"
cat > "$T/acme-gtme/DECISIONS.json" <<'J'
{"client": "Acme", "aliases": ["acme", "pat"],
 "rulings": [
  {"id": "volume", "rule": "Send to every list.", "who": "Pat", "date": "2026-10-05", "source": "test", "status": "active"},
  {"id": "old", "rule": "Old rule nobody follows.", "who": "Pat", "date": "2026-09-01", "source": "test", "status": "superseded"}]}
J
run(){ printf '{"prompt":%s}' "$(printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" | CHEWBACCA_CLIENT_REPOS="$T" bash "$HOOK"; }
out="$(run "give me an update for Pat")"
printf '%s' "$out" | grep -q "Send to every list" && ok "names the client: rulings injected" || no "no rulings when the client was named"
printf '%s' "$out" | grep -q "Old rule" && no "superseded ruling injected" || ok "superseded rulings left out"
out="$(run "fix the hud")"
[ -z "$out" ] && ok "no client named: silent" || no "spoke on a prompt with no client"
out="$(run "compare the acmeco numbers")"
[ -z "$out" ] && ok "partial word does not match" || no "matched acme inside acmeco"
# Anyone's install: rulings on a chewbacca gtme client, matched by its offers.
mkdir -p "$T/gtm"
cat > "$T/gtm/clients.json" <<'J'
{"clients": [{"name": "Brightside", "principal": "Dana Ruiz", "offers": [{"name": "Lumen App", "aliases": ["Lumen"]}],
  "rulings": [{"rule": "Never email on weekends.", "who": "Dana", "date": "2026-10-10"}]}]}
J
out="$(printf '{"prompt":"how is lumen doing"}' | CHEWBACCA_CLIENT_REPOS="$T" GTME_HOME="$T/gtm" bash "$HOOK")"
printf '%s' "$out" | grep -q "Never email on weekends" && ok "gtme client: an offer name loads its rulings" || no "gtme client rulings not loaded"
out="$(printf '{"prompt":"text Dana about friday"}' | CHEWBACCA_CLIENT_REPOS="$T" GTME_HOME="$T/gtm" bash "$HOOK")"
printf '%s' "$out" | grep -q "Never email on weekends" && ok "gtme client: the principal's first name loads them" || no "principal first name missed"

echo "  ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
