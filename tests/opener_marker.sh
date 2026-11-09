#!/bin/bash
# A CLAUDE.md asking for a prayer turns the opener gate on, and
# ~/.chewbacca/opener-off keeps it off even then, so a setup rerun can't
# switch it back on.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export CHEWBACCA_HOME="$T/ch"
fail() { echo "FAIL: $*"; exit 1; }
run() { bash "$ROOT/bin/lib/opener-marker.sh" "$1"; }

printf 'Open every reply with a prayer. Amen.\n' > "$T/prayer.md"
printf 'Be terse.\n' > "$T/plain.md"

[ "$(run "$T/plain.md")" = unchanged ] || fail "a CLAUDE.md with no prayer changed the gate"
[ -e "$CHEWBACCA_HOME/opener-marker" ] && fail "a CLAUDE.md with no prayer wrote a marker"

[ "$(run "$T/prayer.md")" = on ] || fail "a prayer CLAUDE.md did not turn the gate on"
[ "$(cat "$CHEWBACCA_HOME/opener-marker")" = Amen ] || fail "no marker after the gate went on"

touch "$CHEWBACCA_HOME/opener-off"
[ "$(run "$T/prayer.md")" = off ] || fail "opener-off lost to a prayer CLAUDE.md"
[ -e "$CHEWBACCA_HOME/opener-marker" ] && fail "opener-off left the marker in place"
[ "$(run "$T/prayer.md")" = off ] || fail "a second setup run switched the gate back on"

echo "ok   opener-off keeps the prayer gate off through every setup run"
