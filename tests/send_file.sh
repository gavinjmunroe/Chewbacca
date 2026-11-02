#!/bin/bash
# send-file never dispatches under CHEWBACCA_NO_SEND or --dry-run, and refuses
# a missing file before touching Messages. osascript and mac are stubbed so a
# regression can't reach a real thread.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
stub=$(mktemp -d); trap 'rm -rf "$stub"' EXIT
for b in osascript mac; do printf '#!/bin/sh\necho CALLED >> "%s/calls"\n' "$stub" > "$stub/$b"; chmod +x "$stub/$b"; done
f="$stub/a b.csv"; printf 'x\n' > "$f"
pass=0; fail=0
t() { if [ "$1" = ok ]; then echo "  ok   $2"; pass=$((pass+1)); else echo "  FAIL $2"; fail=$((fail+1)); fi; }

out=$(PATH="$stub:$PATH" CHEWBACCA_NO_SEND=1 bash "$ROOT/bin/send-file" +15550000000 "$f" 2>&1)
case "$out" in *"would send a b.csv"*) t ok "no-send prints the plan";; *) t no "no-send prints the plan: $out";; esac
out=$(PATH="$stub:$PATH" bash "$ROOT/bin/send-file" +15550000000 "$f" --dry-run 2>&1)
case "$out" in *"would send"*) t ok "--dry-run prints the plan";; *) t no "--dry-run prints the plan";; esac
PATH="$stub:$PATH" bash "$ROOT/bin/send-file" +15550000000 "$stub/missing.csv" >/dev/null 2>&1; rc=$?
[ "$rc" = 2 ] && t ok "missing file exits 2" || t no "missing file exits 2 (got $rc)"
[ ! -e "$stub/calls" ] && t ok "nothing dispatched" || t no "a sender was called"
# The 2026-11-02 bug: the path handed to Messages must be under ~/Pictures.
grep -q 'Pictures/chewbacca-send' "$ROOT/bin/send-file" && t ok "stages under ~/Pictures" || t no "stages under ~/Pictures"
echo "$pass passed, $fail failed"; [ "$fail" = 0 ]
