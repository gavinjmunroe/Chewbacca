#!/bin/bash
# design-gate's ui-proof step: a page that errors in a real browser refuses the
# turn, a missing browser warns as unverified instead of passing or blocking,
# and a clean page leaves a receipt outside the project.
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/design-gate.sh"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }
command -v jq >/dev/null 2>&1 || { echo "  skip: jq not installed"; exit 0; }

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/ux/bin" "$T/bin" "$T/site" "$T/home"
# The layout render always passes here; this test is about the ui-proof step.
printf '#!/bin/bash\nexit 0\n' > "$T/ux/bin/design-gate"
cat > "$T/bin/ui-proof" <<'STUB'
#!/bin/bash
out=""; while [ $# -gt 0 ]; do [ "$1" = "--out" ] && out="$2"; shift; done
mkdir -p "$out"; echo "$STUB_MODE" > "$out/receipt.json"
case "$STUB_MODE" in
  clean) exit 0 ;;
  nobrowser) echo "no browser" >&2; exit 3 ;;
  error) echo "console error: Uncaught TypeError: x is undefined"; exit 1 ;;
esac
STUB
chmod +x "$T/ux/bin/design-gate" "$T/bin/ui-proof"
printf '<title>Fixture</title>\n' > "$T/site/index.html"
echo "http://localhost:9/" > "$T/site/.design-gate-url"
mkdir -p "$T/site/.git"
# The hook greps the raw transcript for "file_path":"...", so write it unspaced.
printf '"file_path":"%s"\n' "$T/site/index.html" > "$T/t.jsonl"

run(){
  printf '{"prompt_id":"p%s-'"$$"'","transcript_path":"%s"}' "$1" "$T/t.jsonl" \
    | env HOME="$T/home" PATH="$T/bin:$PATH" UX_ENGINE_DIR="$T/ux" STUB_MODE="$1" \
          UI_PROOF_RECEIPTS="$T/receipts" CHEWBACCA_LOG_DIR="$T/logs" bash "$HOOK"
}

err=$(run clean 2>&1); code=$?
[ $code -eq 0 ] && ok "clean page passes" || no "clean page exited $code: $err"
ls "$T"/receipts/*/receipt.json >/dev/null 2>&1 && ok "receipt written outside the project" \
  || no "no receipt written"
[ ! -e "$T/site/.ui-proof" ] && ok "nothing written into the project" || no "receipt landed in the project"

err=$(run error 2>&1); code=$?
[ $code -eq 2 ] && printf '%s' "$err" | grep -q "Uncaught TypeError" \
  && ok "a page that errors in the browser refuses the turn, naming the error" \
  || no "error page exited $code: $err"

err=$(run nobrowser 2>&1); code=$?
[ $code -eq 0 ] && printf '%s' "$err" | grep -q "unverified" \
  && ok "no browser warns as unverified and does not block" \
  || no "no-browser exited $code: $err"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
