#!/bin/bash
# call-prep-guard must run call_prep_check after a Google Doc write that holds
# a founder call script, hand back its FAILs, and stay silent otherwise.
# Incident: 2026-10-28, the Firebox script went out too dense, with Gavin in a
# solo call and three founders in one tab, because nobody ran the checker.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.claude/hooks/call-prep-guard.sh"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }
command -v jq >/dev/null 2>&1 || { echo "  skip: jq not installed"; exit 0; }

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
# A fake gws: `docs documents get` prints the doc in $FAKE_DOC.
cat > "$T/bin/gws" <<'EOF'
#!/bin/bash
cat "$FAKE_DOC"
EOF
chmod +x "$T/bin/gws"

doc(){ # $1 = tab title, $2 = tab text -> a docs.get JSON with that one tab
  jq -n --arg t "$1" --arg x "$2" '{tabs:[{tabProperties:{title:$t},documentTab:{body:{content:[{paragraph:{elements:[{textRun:{content:$x}}]}}]}}}]}'
}
BAD=$'Firebox: 4:30 to 5:00\n1. Open\nGavin opens the call.\n'
GOOD=$'Firebox: 4:30 to 5:00\n1. Open (Caleb)\n"Right now we do it for you."\nAsk: "What\'s working for you right now, and what isn\'t?"\nWhy not Claude: it can write, it won\'t pick the groups.\nThe deal: a free 2 week pilot, then [NEED: price range].\n'
PAPER=$'Miyake and the pleated dress\nHis pleats were about motion.\n'

run(){ # $1 = command, $2 = doc json -> hook stdout
  FAKE_DOC="$2" PATH="$T/bin:$PATH" HOOKD_INNER=1 CALL_PREP_CHECK="$ROOT/bin/lib/call_prep_check.py" \
    bash "$HOOK" <<<"$(jq -n --arg c "$1" '{tool_input:{command:$c},tool_response:{stdout:"",stderr:""}}')" 2>/dev/null
}
ID=1kurjBenJfAKyUNdiIRRoj6bQ9ZwHYnxicV5j3NrTu_k
INLINE="gws docs documents batchUpdate --params '{\"documentId\":\"$ID\"}' --json '{}'"

doc Firebox "$BAD" > "$T/bad.json"
out="$(run "$INLINE" "$T/bad.json")"
printf '%s' "$out" | grep -q "who talks" && ok "a failing call tab is reported after an inline write" || no "a failing call tab is reported after an inline write"

printf 'DOC = "%s"\nsubprocess.run(["gws","docs","documents","batchUpdate"])\n' "$ID" > "$T/edit.py"
out="$(run "python3 $T/edit.py" "$T/bad.json")"
printf '%s' "$out" | grep -q "call-prep-guard" && ok "a write made by a python script is checked too" || no "a write made by a python script is checked too"

doc Firebox "$GOOD" > "$T/good.json"
out="$(run "$INLINE" "$T/good.json")"
[ -z "$out" ] && ok "a passing call script stays silent" || no "a passing call script stays silent: $out"

doc Paper "$PAPER" > "$T/paper.json"
out="$(run "$INLINE" "$T/paper.json")"
[ -z "$out" ] && ok "a doc with no founder heading stays silent" || no "a doc with no founder heading stays silent: $out"

out="$(run "git status" "$T/bad.json")"
[ -z "$out" ] && ok "an unrelated command stays silent" || no "an unrelated command stays silent"

echo "  $pass passed, $fail failed"; [ "$fail" -eq 0 ]
