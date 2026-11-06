#!/usr/bin/env bash
# A runtime setup never runs a checkout that's behind main. It installs from a clean worktree
# at its own sha. On 2026-11-06 a stale setup.sh reverted every live hook.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME"
git init -q -b main "$T/src"
git -C "$T/src" -c user.name=t -c user.email=t@t commit -q --allow-empty -m old
OLD=$(git -C "$T/src" rev-parse HEAD)
printf 'echo RAN-OLD\n' > "$T/src/setup.sh"
# The new sha holds the setup that should run, and the snapshot is a checkout of it.
git -C "$T/src" add setup.sh
git -C "$T/src" -c user.name=t -c user.email=t@t commit -q -m stale
git -C "$T/src" branch old-tip
printf 'echo RAN-NEW\n' > "$T/src/setup.sh"
git -C "$T/src" add setup.sh
git -C "$T/src" -c user.name=t -c user.email=t@t commit -q -m new
git -C "$T/src" clone -q "$T/src" "$T/snap" 2>/dev/null || git clone -q "$T/src" "$T/snap"
NEW=$(git -C "$T/src" rev-parse HEAD)
git -C "$T/src" checkout -q old-tip
mkdir -p "$T/snap/tools"
printf 'import sys\nsys.exit(1)\n' > "$T/snap/tools/source_sync.py"
python3 -I -c 'import json,sys; json.dump({"source": sys.argv[1]}, open(sys.argv[2], "w"))' "$T/src" "$T/snap.kit-runtime.json"
# Only the handover block of the real setup.sh.
awk '/^SCRIPT_DIR=/,/^BACKUP_DIR=/' "$ROOT/setup.sh" | sed '$d' > "$T/snap/setup.sh"
OUT=$(bash "$T/snap/setup.sh" 2>&1)
case "$OUT" in *RAN-OLD*) echo "FAIL ran the stale setup: $OUT"; exit 1 ;; esac
case "$OUT" in *RAN-NEW*) ;; *) echo "FAIL ran neither: $OUT"; exit 1 ;; esac
[ "$(git -C "$HOME/.chewbacca/kit/setup-source" rev-parse HEAD)" = "$NEW" ] || { echo "FAIL clean copy not at the new sha"; exit 1; }
[ "$(git -C "$T/src" rev-parse HEAD)" != "$NEW" ] || { echo "FAIL moved the shared checkout"; exit 1; }
: "$OLD"
echo "ok: a stale checkout's setup never runs"
