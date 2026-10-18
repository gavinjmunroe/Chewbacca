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

# land cherry-picks and amends, so a tab's own clone diverges; resync it.
sync() { git fetch -q && git reset -q --hard origin/main; }

# --paths from a stale checkout keeps lines main gained since (ledger
# d72fce61: three MEMORY.md index lines vanished on 2026-10-10 this way).
cd "$T/tab2" && sync && mkdir -p team/memory
printf '# index\n- a: first\n' > team/memory/MEMORY.md
printf 'line one\nline two\n' > c.txt
echo 'team/memory/MEMORY.md merge=union' > .gitattributes
git add -A && git commit -qm "feat: index" && python3 -I "$LAND" "$(git rev-parse HEAD)" >/dev/null 2>&1 || fail "seeding the index"
git clone -q "$T/origin.git" "$T/stale"
cd "$T/tab2" && sync && echo '- b: another tab' >> team/memory/MEMORY.md && git commit -qam "feat: b" \
  && python3 -I "$LAND" "$(git rev-parse HEAD)" >/dev/null 2>&1 || fail "another tab's index line"
cd "$T/stale" && echo '- c: mine' >> team/memory/MEMORY.md
out=$(python3 -I "$LAND" --paths team/memory/MEMORY.md -m "feat: c" 2>&1) || fail "stale --paths land: $out"
cd "$T/check" && git pull -q
grep -q '^- b: another tab' team/memory/MEMORY.md || fail "--paths reverted another tab's index line"
grep -q '^- c: mine' team/memory/MEMORY.md || fail "--paths lost its own line"

# A stale copy that clashes with main in the same lines is refused, not copied over.
cd "$T/tab2" && sync && sed -i.bak 's/line one/line ONE upstream/' c.txt && rm c.txt.bak && git commit -qam "feat: c upstream" \
  && python3 -I "$LAND" "$(git rev-parse HEAD)" >/dev/null 2>&1 || fail "upstream c.txt"
cd "$T/stale" && sed -i.bak 's/line one/line 1 mine/' c.txt && rm c.txt.bak
out=$(python3 -I "$LAND" --paths c.txt -m "feat: clash" 2>&1) && fail "a clashing --paths copy landed: $out"
echo "$out" | grep -q "same lines" || fail "clash message said: $out"
cd "$T/check" && git pull -q && grep -q 'line ONE upstream' c.txt || fail "the clash overwrote main"

# Two tabs that each commit an index line from the same base land back to
# back; the second cherry-pick onto the first must not conflict.
git clone -q "$T/origin.git" "$T/tabA" && git clone -q "$T/origin.git" "$T/tabB"
cd "$T/tabA" && echo '- d: tab A' >> team/memory/MEMORY.md && git commit -qam "feat: d"
cd "$T/tabB" && echo '- e: tab B' >> team/memory/MEMORY.md && git commit -qam "feat: e"
(cd "$T/tabA" && python3 -I "$LAND" "$(git rev-parse HEAD)") >/dev/null 2>&1 || fail "back-to-back land A"
out=$(cd "$T/tabB" && python3 -I "$LAND" "$(git rev-parse HEAD)" 2>&1) || fail "back-to-back land B conflicted: $out"
cd "$T/check" && git pull -q
grep -q '^- d: tab A' team/memory/MEMORY.md && grep -q '^- e: tab B' team/memory/MEMORY.md || fail "a back-to-back index line went missing"
python3 tools/checksums.py && git diff --quiet SHA256SUMS.txt || fail "manifest stale after back-to-back lands"

# A wip commit is refused (930f716c reached main that way on 2026-10-10).
cd "$T/tabA" && sync && echo w > w.txt && git add w.txt && git commit -qm "wip: half done"
out=$(python3 -I "$LAND" "$(git rev-parse HEAD)" 2>&1) && fail "a wip commit landed: $out"
echo "$out" | grep -q "reword it" || fail "wip refusal said: $out"

# A ref like HEAD means the caller's commit, not the temp worktree's. On
# 2026-10-16 `land HEAD` cherry-picked origin/main onto itself and failed empty.
cd "$T/tabA" && sync && echo h > h.txt && git add h.txt && git commit -qm "feat: head ref"
out=$(python3 -I "$LAND" HEAD 2>&1) || fail "land HEAD: $out"
cd "$T/check" && git pull -q && [ -f h.txt ] || fail "land HEAD didn't land the caller's commit: $out"
# --paths keeps the executable bit. On 2026-10-16 a chmod +x bin/hud-verse
# landed 100644 and running it from PATH said permission denied.
cd "$T/tabA" && sync && printf '#!/bin/sh\necho hi\n' > tool.sh && chmod +x tool.sh
out=$(python3 -I "$LAND" --paths tool.sh -m "feat: a tool" 2>&1) || fail "exec land: $out"
cd "$T/check" && git pull -q && [ -x tool.sh ] || fail "--paths dropped the executable bit"
out=$(cd "$T/tabA" && python3 -I "$LAND" no-such-ref 2>&1) && fail "an unknown ref landed: $out"
echo "$out" | grep -q "no-such-ref" || fail "unknown ref said: $out"
# A tab lands a file, its checkout stays stale, and it lands an edit right
# next to the first one: its own earlier land is not a clash (ledger
# e9e4cdf9, hit 3x on 10/10 and again 10/18). A line another tab merged in
# meanwhile still survives.
cd "$T/seed" && git pull -q && printf 'l1\nl2\nl3\n' > own.txt && python3 tools/checksums.py && git add -A && git commit -qm own && git push -q origin main
git clone -q "$T/origin.git" "$T/own" && cd "$T/own"
printf 'l1\nl2\nX\nl3\n' > own.txt
out=$(python3 -I "$LAND" --paths own.txt -m "feat: X" 2>&1) || fail "first own land: $out"
cd "$T/seed" && git pull -q && printf 'l0\n' | cat - own.txt > o && mv o own.txt && python3 tools/checksums.py && git commit -qam other && git push -q origin main
cd "$T/own" && printf 'l1\nl2\nX\nY\nl3\n' > own.txt
out=$(python3 -I "$LAND" --paths own.txt -m "feat: Y" 2>&1) || fail "second own land next to the first: $out"
cd "$T/check" && git pull -q
[ "$(tr '\n' ' ' < own.txt)" = "l0 l1 l2 X Y l3 " ] || fail "own re-land lost a line: $(tr '\n' ' ' < own.txt)"
# That own-land base is never used for a copy that lacks the lines its land
# added. A sibling worktree (same .git, older file) or this tree with X gone
# gets the clash, instead of a clean merge that strips X from main (security
# review of da1b2a0b, 10/18).
cd "$T/seed" && git pull -q && printf 'a\nb\nc\nd\n' > sib.txt && python3 tools/checksums.py && git add -A && git commit -qm sib && git push -q origin main
git clone -q "$T/origin.git" "$T/t1" && cd "$T/t1" && git worktree add -q --detach "$T/t1-sib" HEAD
printf 'a\nb\nX\nc\nd\n' > sib.txt
out=$(python3 -I "$LAND" --paths sib.txt -m "feat: sib X" 2>&1) || fail "verbatim land: $out"
cd "$T/t1-sib" && printf 'a\nb\nW\nc\nd\n' > sib.txt
out=$(python3 -I "$LAND" --paths sib.txt -m "feat: sib W" 2>&1) && fail "a sibling worktree used another tree's land as base: $out"
cd "$T/t1" && printf 'a\nb\nV\nc\nd\n' > sib.txt
out=$(python3 -I "$LAND" --paths sib.txt -m "feat: sib V" 2>&1) && fail "a copy missing its own landed lines merged: $out"
echo "$out" | grep -q "same lines" || fail "missing-lines refusal said: $out"
cd "$T/check" && git pull -q
[ "$(tr '\n' ' ' < sib.txt)" = "a b X c d " ] || fail "a refused land changed main: $(tr '\n' ' ' < sib.txt)"

# And the other way: a copy still holding a line its own land removed would
# put it back on main through that base, so it gets the clash too.
cd "$T/seed" && git pull -q && printf 'p\nq\nr\ns\n' > rm.txt && python3 tools/checksums.py && git add -A && git commit -qm rm && git push -q origin main
git clone -q "$T/origin.git" "$T/t2" && cd "$T/t2" && printf 'p\nr\ns\n' > rm.txt
out=$(python3 -I "$LAND" --paths rm.txt -m "feat: drop q" 2>&1) || fail "verbatim delete land: $out"
printf 'p\nq\nN\nr\ns\n' > rm.txt
out=$(python3 -I "$LAND" --paths rm.txt -m "feat: N" 2>&1) && fail "a copy holding a line its land removed merged: $out"
cd "$T/check" && git pull -q
[ "$(tr '\n' ' ' < rm.txt)" = "p r s " ] || fail "a refused land changed main: $(tr '\n' ' ' < rm.txt)"

echo ok
