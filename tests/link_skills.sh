#!/bin/bash
# link-skills.sh must add missing skill links, repair dangling ones, and leave
# every other entry in the skills directory exactly as it found it.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
FAILED=0; fail() { echo "FAIL: $*"; FAILED=1; }

mkdir -p "$TMP/repo/skills/new" "$TMP/repo/skills/gone" "$TMP/repo/skills/theirs" "$TMP/repo/skills/nofile" "$TMP/dst/theirs"
for s in new gone theirs; do echo "name: $s" > "$TMP/repo/skills/$s/SKILL.md"; done
echo "foreign" > "$TMP/dst/theirs/SKILL.md"
ln -s "$TMP/nowhere" "$TMP/dst/gone"

out="$(CHEWBACCA_SKILLS_DIR="$TMP/dst" bash "$ROOT/bin/lib/link-skills.sh" "$TMP/repo")"
[ "$(readlink "$TMP/dst/new")" = "$TMP/repo/skills/new" ] || fail "missing skill not linked"
[ "$(readlink "$TMP/dst/gone")" = "$TMP/repo/skills/gone" ] || fail "dangling link not repaired"
[ ! -L "$TMP/dst/theirs" ] && grep -q foreign "$TMP/dst/theirs/SKILL.md" || fail "foreign skill touched"
[ ! -e "$TMP/dst/nofile" ] || fail "linked a directory with no SKILL.md"
[ "$(printf '%s\n' "$out" | grep -c '^linked')" = 2 ] || fail "expected 2 linked lines, got: $out"

out2="$(CHEWBACCA_SKILLS_DIR="$TMP/dst" bash "$ROOT/bin/lib/link-skills.sh" "$TMP/repo")"
[ -z "$out2" ] || fail "second run was not a no-op: $out2"

[ "$FAILED" = 0 ] && echo "ok: link-skills adds, repairs, and leaves foreign skills alone"
exit "$FAILED"
