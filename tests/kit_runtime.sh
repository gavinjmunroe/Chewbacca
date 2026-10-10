#!/bin/bash
# PATH tools must run from a clean runtime of origin/main, never from the
# shared checkout's working tree where other tabs keep uncommitted edits.
#
# On 2026-10-10 every link in ~/.local/bin pointed into the shared checkout,
# it could not fast-forward, and the installed `chewbacca` ran code main had
# replaced hours earlier. Each case below runs tools/kit_runtime.py against a
# real origin with a scratch HOME, so nothing here can touch this Mac's kit.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"
mkdir -p "$HOME/.local/bin"
export CHEWBACCA_KIT_RUNTIME="$HOME/.chewbacca/kit"
export CHEWBACCA_BIN_DIR="$HOME/.local/bin"
export CHEWBACCA_HOOKS_DIR="$HOME/.claude/hooks"
export CHEWBACCA_LOG_DIR="$TMP/logs"
export CHEWBACCA_PULL_INTERVAL=0
export CHEWBACCA_RUNTIME_FETCH_AGE=0
export GIT_CONFIG_NOSYSTEM=1
FAILED=0
fail() { echo "FAIL: $*"; FAILED=1; }
KR="$ROOT/tools/kit_runtime.py"
BIN="$HOME/.local/bin"
RT="$CHEWBACCA_KIT_RUNTIME"

git init -q --bare "$TMP/origin.git"
git -C "$TMP/origin.git" symbolic-ref HEAD refs/heads/main
git clone -q "$TMP/origin.git" "$TMP/work" 2>/dev/null
W="$TMP/work"
git -C "$W" config user.email t@t; git -C "$W" config user.name t
mkdir -p "$W/tools" "$W/bin" "$W/.claude/hooks"
cp "$ROOT/tools/kit_runtime.py" "$ROOT/tools/tools_link.py" "$ROOT/tools/hooks_sync.py" "$W/tools/"
printf 'link_tool alpha\n' > "$W/setup.sh"
printf 'node_modules/\nstate.log\n' > "$W/.gitignore"
printf '#!/bin/sh\necho v1\n' > "$W/bin/alpha"; chmod +x "$W/bin/alpha"
printf '#!/bin/sh\necho hook-v1\n' > "$W/.claude/hooks/demo.sh"
git -C "$W" add -A; git -C "$W" commit -qm v1
git -C "$W" branch -M main; git -C "$W" push -q origin main
git clone -q "$TMP/origin.git" "$TMP/source"
S="$TMP/source"
git -C "$S" config user.email t@t; git -C "$S" config user.name t

release() {  # push a new version of bin/alpha and the demo hook
  printf '#!/bin/sh\necho %s\n' "$1" > "$W/bin/alpha"
  printf '#!/bin/sh\necho hook-%s\n' "$1" > "$W/.claude/hooks/demo.sh"
  git -C "$W" commit -qam "$1"; git -C "$W" push -q origin main
}
origin_sha() { git -C "$TMP/origin.git" rev-parse main; }
runtime_sha() { python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["sha"])' "$(cd -P "$RT/current" && pwd).kit-runtime.json"; }

# The shared checkout as it was on 2026-10-10: another tab's uncommitted edit,
# gitignored state beside the tools, and PATH linked into the working tree.
printf '#!/bin/sh\necho DIRTY\n' > "$S/bin/alpha"
mkdir -p "$S/node_modules/pkg"; echo data > "$S/node_modules/pkg/index.js"
echo log > "$S/state.log"
ln -s "$S/bin/alpha" "$BIN/alpha"
ln -s /nowhere/else/beta "$BIN/beta"
HEAD_BEFORE="$(git -C "$S" rev-parse HEAD)"

# 1. First build: PATH moves into the runtime and runs main, not the dirty tree.
python3 -I "$KR" update --repo "$S" --link-bin "$BIN" >/dev/null || fail "first update exited non-zero"
[ "$(readlink "$BIN/alpha")" = "$RT/current/bin/alpha" ] || fail "alpha links to $(readlink "$BIN/alpha"), not the runtime"
[ "$("$BIN/alpha")" = v1 ] || fail "PATH alpha ran '$("$BIN/alpha")', not origin/main's v1"
[ "$(runtime_sha)" = "$(origin_sha)" ] || fail "runtime sha is not origin/main"
[ "$(readlink "$BIN/beta")" = /nowhere/else/beta ] || fail "a foreign link was moved"
[ -L "$RT/current/node_modules" ] && [ -f "$RT/current/node_modules/pkg/index.js" ] || fail "node_modules not linked into the snapshot"
[ -L "$RT/current/state.log" ] || fail "gitignored state file not linked into the snapshot"

# Unlocked: a locked worktree whose scratch HOME is deleted stays registered
# in the source repo forever (seven of them, the first afternoon).
git -C "$S" worktree list --porcelain | grep -q '^locked' && fail "a snapshot worktree is locked"

# 2. The shared checkout is never touched: dirty edit and HEAD intact.
[ "$(cat "$S/bin/alpha")" = "$(printf '#!/bin/sh\necho DIRTY')" ] || fail "the source's uncommitted edit changed"
[ "$(git -C "$S" rev-parse HEAD)" = "$HEAD_BEFORE" ] || fail "the source's HEAD moved"
[ "$(git -C "$S" status --porcelain)" = " M bin/alpha" ] || fail "source status changed: $(git -C "$S" status --porcelain | tr '\n' ' ')"

# 3. An update swaps atomically: a run that resolved the old snapshot keeps it.
OLD="$(cd -P "$RT/current" && pwd)"
release v2
python3 -I "$KR" update --repo "$S" --fetch --link-bin "$BIN" >/dev/null || fail "fetch update exited non-zero"
[ "$("$BIN/alpha")" = v2 ] || fail "after a push PATH alpha ran '$("$BIN/alpha")', not v2"
[ "$(runtime_sha)" = "$(origin_sha)" ] || fail "runtime did not follow origin/main"
[ "$(sh "$OLD/bin/alpha")" = v1 ] || fail "the previous snapshot vanished under a running tool"
[ -L "$RT/current" ] || fail "current is not a symlink"

# 4. Old snapshots are pruned to three, current always kept.
release v3; python3 -I "$KR" update --repo "$S" --fetch >/dev/null
release v4; python3 -I "$KR" update --repo "$S" --fetch >/dev/null
N="$(find "$RT/snapshots" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
[ "$N" = 3 ] || fail "expected 3 snapshots after 4 builds, found $N"
[ -d "$OLD" ] && fail "the oldest snapshot was not pruned"
[ "$("$BIN/alpha")" = v4 ] || fail "PATH alpha is not v4"

# 5. Two updaters at once: both finish, current is valid.
release v5
python3 -I "$KR" update --repo "$S" --fetch >/dev/null & P1=$!
python3 -I "$KR" update --repo "$S" --fetch >/dev/null & P2=$!
wait "$P1" || fail "concurrent update 1 failed"; wait "$P2" || fail "concurrent update 2 failed"
[ "$("$BIN/alpha")" = v5 ] || fail "after concurrent updates PATH alpha is '$("$BIN/alpha")'"

# 6. status reports the runtime against origin/main.
python3 -I "$KR" status --repo "$S" --json | python3 -I -c '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if d["equal"] and d["sha"] == d["origin_main"] and not d["links_into_source"] else 1)
' || fail "status did not report runtime == origin/main"

# 7. kit-autopull, the SessionStart path: a push lands on PATH and the hooks
#    copy comes from the same commit, while the dirty source stays put.
release v6
CHEWBACCA_REPO_DIR="$S" bash "$ROOT/.claude/hooks/kit-autopull.sh" </dev/null >/dev/null 2>&1
[ "$("$BIN/alpha")" = v6 ] || fail "kit-autopull did not move PATH to v6 ($("$BIN/alpha"))"
[ "$(sh "$CHEWBACCA_HOOKS_DIR/demo.sh" 2>/dev/null)" = hook-v6 ] || fail "hooks were not synced from the runtime's commit"
[ "$(git -C "$S" rev-parse HEAD)" = "$HEAD_BEFORE" ] || fail "kit-autopull moved the dirty source's HEAD"

# 8. A source with no origin/main fails loudly and leaves current alone.
CUR="$(runtime_sha)"
git init -q "$TMP/bare-src"
python3 -I "$KR" update --repo "$TMP/bare-src" >/dev/null 2>&1 && fail "update with no origin/main exited 0"
[ "$(runtime_sha)" = "$CUR" ] || fail "a failed update changed current"

# 9. Another checkout cannot repoint the runtime unless it says --adopt. A
#    test pointing CHEWBACCA_REPO_DIR at a scratch clone must never take over
#    the runtime every PATH tool on the machine runs from.
git clone -q "$TMP/origin.git" "$TMP/other"
python3 -I "$KR" update --repo "$TMP/other" >/dev/null 2>&1 && fail "a second checkout took over the runtime"
OWNER="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["source"])' "$(cd -P "$RT/current" && pwd).kit-runtime.json")"
[ "$OWNER" = "$S" ] || fail "runtime source changed to $OWNER"
python3 -I "$KR" update --repo "$TMP/other" --adopt >/dev/null 2>&1 || fail "--adopt did not take over"

# 10. setup.sh run from inside a snapshot hands over to the source checkout.
grep -q 'exec bash "$_kr_src/setup.sh"' "$ROOT/setup.sh" || fail "setup.sh no longer redirects out of the runtime"

[ "$FAILED" -eq 0 ] && echo "ok    PATH tools run from a clean origin/main runtime, swapped atomically, source untouched"
exit "$FAILED"
