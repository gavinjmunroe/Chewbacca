#!/bin/bash
# kit-route names the kits and projects on every prompt and matches none of his
# words. The model reading his message routes it. Its phrasings and score are in
# tests/eval_intent_notes.py; this checks the hook's own side of that deal.
#
# What the word matcher got wrong, kept as eval cases: a 17,000-character club
# message routed to apply-kit (2026-09-22), and 25 of 28 routes in two days sent
# Firm Foundation video work to colin-kit on "intro vid" (2026-10-19).
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/kit-route.sh"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/apply-kit" "$TMP/colin-kit" "$TMP/draft-kit" "$TMP/bin"
printf 'name: apply-kit\nuse-when: applying anywhere\nstatus: ready\n' > "$TMP/apply-kit/.kit"
printf 'name: colin-kit\nuse-when: colin, intro vid\nstatus: ready\n' > "$TMP/colin-kit/.kit"
printf 'name: draft-kit\nuse-when: x\nstatus: template\n' > "$TMP/draft-kit/.kit"
printf '#!/bin/sh\nprintf "%%s\\n" "%s/apply-kit" "%s/colin-kit" "%s/draft-kit"\n' "$TMP" "$TMP" "$TMP" > "$TMP/bin/kits"
chmod +x "$TMP/bin/kits"
export PATH="$TMP/bin:$PATH"
# The hook asks ~/.local/bin/kits before PATH, so a temporary HOME makes the stub
# the only kits (found 2026-10-10).
export HOME="$TMP/home" CHEWBACCA_ROOT="$TMP/no-kit" CHEWBACCA_VERDICTS=0
mkdir -p "$HOME/code/kits/hall-demo"
printf 'name: hall-demo\nuse-when: y\n' > "$HOME/code/kits/hall-demo/.project"

run(){ jq -cn --arg p "$1" --arg c "${2:-/nowhere}" '{prompt:$p, cwd:$c}' | sh "$HOOK" 2>/dev/null; }

out=$(run "fix the css on the site")
printf '%s' "$out" | grep -q 'apply-kit .*colin-kit' && ok "names the kits on plain work, the model decides" || no "no kit names: $out"
printf '%s' "$out" | grep -q 'Projects: hall-demo' && ok "names projects" || no "no project: $out"
printf '%s' "$out" | grep -q 'draft-kit' && no "listed a template kit" || ok "skips a template kit"
printf '%s' "$out" | grep -q 'judge the work' && ok "tells the model to judge" || no "note lost its judge line"
[ -n "$(run "ava essays")" ] && ok "a short message gets the note too" || no "short message got nothing"
[ -z "$(run "/ship it now please")" ] && ok "silent on a slash command" || no "fired on a slash command"
[ -z "$(run "fix the css on the site" "$TMP/colin-kit")" ] && ok "silent when already in a kit" || no "fired inside a kit"
if grep -qE 'stems\(|prompt_stems|GENERIC' "$HOOK"; then no "hook still matches words"; else ok "no word matching left"; fi

printf '\n  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
