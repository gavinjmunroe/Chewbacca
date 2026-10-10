#!/usr/bin/env bash
# chewbacca land: other tabs' dirty files never ride along, two tabs landing
# at once both make it, and the manifest is regenerated for the pushed tree.
# Every failure here happened by hand on 2026-10-09/10 with ten tabs on one
# checkout. Hermetic: a temp bare origin, temp HOME.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
LAND="$ROOT/bin/chewbacca-land"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HOME="$T/home" CHEWBACCA_HOME="$T/home/.chewbacca" GIT_CONFIG_NOSYSTEM=1
mkdir -p "$HOME"
git config --global user.name t; git config --global user.email t@t
git config --global init.defaultBranch main
fail() { echo "FAIL: $*"; exit 1; }

git init -q --bare "$T/origin.git"
git clone -q "$T/origin.git" "$T/seed" 2>/dev/null
cd "$T/seed"
mkdir -p tools
cat > tools/checksums.py <<'PY'
import hashlib, pathlib, subprocess
files = sorted(f for f in subprocess.run(["git", "ls-files"], capture_output=True, text=True).stdout.split() if f != "SHA256SUMS.txt")
pathlib.Path("SHA256SUMS.txt").write_text("".join(f"{hashlib.sha256(pathlib.Path(f).read_bytes()).hexdigest()}  {f}\n" for f in files if pathlib.Path(f).exists()))
PY
echo a > a.txt; echo b > b.txt
python3 tools/checksums.py; git add -A; git commit -qm init; git push -q origin main

# The shared checkout: one tab's file, plus another tab's uncommitted mess.
git clone -q "$T/origin.git" "$T/shared"
cd "$T/shared"
echo "mine" > a.txt
echo "other tab, not done" > b.txt
echo "half written" > stray.txt

out=$(python3 -I "$LAND" --paths a.txt -m "feat: mine" 2>&1) || fail "land failed: $out"
git clone -q "$T/origin.git" "$T/check"
[ "$(cat "$T/check/a.txt")" = mine ] || fail "a.txt not landed"
[ "$(cat "$T/check/b.txt")" = b ] || fail "another tab's b.txt rode along"
[ ! -e "$T/check/stray.txt" ] || fail "untracked stray.txt rode along"
(cd "$T/check" && python3 tools/checksums.py && git diff --quiet SHA256SUMS.txt) || fail "manifest stale after land"
[ "$(cat b.txt)" = "other tab, not done" ] || fail "land touched the shared checkout"
[ -z "$(git -C "$T/shared" worktree list | sed -n 2p)" ] || fail "temp worktree left behind"

# Two tabs land at the same moment; both arrive.
echo one > one.txt; echo two > two.txt
python3 -I "$LAND" --paths one.txt -m "feat: one" >"$T/o1" 2>&1 & p1=$!
python3 -I "$LAND" --paths two.txt -m "feat: two" >"$T/o2" 2>&1 & p2=$!
wait $p1 || fail "concurrent land one: $(cat "$T/o1")"
wait $p2 || fail "concurrent land two: $(cat "$T/o2")"
cd "$T/check" && git pull -q
[ -f one.txt ] && [ -f two.txt ] || fail "a concurrent land went missing"
python3 tools/checksums.py && git diff --quiet SHA256SUMS.txt || fail "manifest stale after concurrent lands"

# A push that loses the race to a tab outside the lock retries and lands. The
# temp worktree shares the shared repo's hooks, so a pre-push hook that pushes
# from elsewhere once makes land's first push lose for real.
cd "$T/seed" && git pull -q && echo outside > outside.txt && python3 tools/checksums.py && git add -A && git commit -qm outside
cat > "$T/shared/.git/hooks/pre-push" <<HOOK
#!/bin/sh
[ -e "$T/raced" ] && exit 0
touch "$T/raced"; unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE; cd "$T/seed" && git push -q origin main
HOOK
chmod +x "$T/shared/.git/hooks/pre-push"
cd "$T/shared" && echo three > three.txt
out=$(python3 -I "$LAND" --paths three.txt -m "feat: three" 2>&1) || fail "land after losing a race: $out"
[ -e "$T/raced" ] || fail "race hook never ran"
rm "$T/shared/.git/hooks/pre-push"
cd "$T/check" && git pull -q
[ -f outside.txt ] && [ -f three.txt ] || { git log --oneline --stat -3; echo "land said: $out"; fail "lost a commit when origin moved"; }
python3 tools/checksums.py && git diff --quiet SHA256SUMS.txt || fail "manifest stale after a retried land"

# Commit mode, and nothing-to-land is a clean no-op.
git clone -q "$T/origin.git" "$T/tab2" && cd "$T/tab2" && echo four > four.txt && git add four.txt && git commit -qm "feat: four"
sha=$(git rev-parse HEAD)
out=$(python3 -I "$LAND" "$sha" 2>&1) || fail "commit mode: $out"
out=$(python3 -I "$LAND" --paths four.txt -m "feat: again" 2>&1) || fail "no-op errored: $out"
echo "$out" | grep -q "nothing to land" || fail "no-op said: $out"
echo ok
