#!/bin/bash
# The generated-file merge drivers, end to end in a throwaway repo.
#
# On 2026-10-09 about ten tabs pushed main and nearly every merge and rebase
# stopped on SHA256SUMS.txt and README.md's counts block. This builds two
# branches from one base, each adding a different bin/ file and a skill (so
# both generated files change on both sides), and asserts that a merge and a
# rebase finish with no conflict and a HEAD whose manifest and counts match
# its own tree. Then the hard cases: one file edited on both sides, a real
# prose conflict, a dirty tree holding another tab's untracked skill, and no
# settle hooks wired (which must still conflict rather than go stale).
#
#   bash tests/merge_drivers.sh <repo-root>
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "ok   $1"; }
bad() { fail=$((fail+1)); echo "FAIL $1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/       /' | head -12; }

# Isolate from every global and system git setting (hooksPath, signing,
# templates), so the only hooks and drivers in play are the ones under test.
export GIT_CONFIG_GLOBAL="$TMP/gitconfig" GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
: > "$GIT_CONFIG_GLOBAL"

# A repo shaped enough for tools/counts.py and tools/checksums.py.
seed() {
  local r="$1"
  mkdir -p "$r"/{tools,bin,skills,.githooks,.claude/rules,.claude/commands,.claude/hooks,.claude/agents,config/settings}
  cp "$ROOT"/tools/{checksums.py,counts.py,merge_regen.py} "$r/tools/"
  cp "$ROOT"/.githooks/{post-merge,post-commit,post-rewrite,lib-regen.sh} "$r/.githooks/"
  cp "$ROOT/.gitattributes" "$r/"
  printf '# rules\n' > "$r/CLAUDE.md"
  printf 'always\n' > "$r/.claude/rules/a.md"
  printf '{"skills":{"upstream":[]},"packs":[],"mcp":{},"cli":[],"plugins":[]}\n' > "$r/config/settings/toolkit.json"
  printf '#!/bin/bash\necho base\n' > "$r/bin/base"
  { printf '# Kit\n\nIntro line one.\n\n<!-- BEGIN GENERATED: counts -->\n\nx\n\n<!-- END GENERATED: counts -->\n\n'
    for i in $(seq 1 20); do printf 'Prose line %s.\n' "$i"; done; } > "$r/README.md"
  git -C "$r" init -q -b main
  git -C "$r" config commit.gpgsign false
  git -C "$r" config core.hooksPath .githooks
  (cd "$r" && python3 tools/merge_regen.py install --repo . >/dev/null)
  regen "$r"
  git -C "$r" add -A && git -C "$r" commit -qm base
}
# Stage first: checksums.py hashes the index, the way a real commit does.
regen() { git -C "$1" add -A && (cd "$1" && python3 tools/checksums.py >/dev/null && python3 tools/counts.py >/dev/null); }
commit_all() { git -C "$1" add -A && git -C "$1" commit -qm "$2"; }
# The proof: HEAD's committed manifest and counts match HEAD's own tree,
# checked in a clean checkout so nothing on disk can make it pass.
head_current() {
  local r="$1" c="$TMP/check-$RANDOM"
  git -C "$r" worktree add -q --detach "$c" HEAD >/dev/null 2>&1 || { echo "no worktree"; return 1; }
  local o1 o2 rc=0
  o1="$(cd "$c" && python3 tools/checksums.py --check 2>&1)" || rc=1
  o2="$(cd "$c" && python3 tools/counts.py --check 2>&1)" || rc=1
  git -C "$r" worktree remove --force "$c" >/dev/null 2>&1
  [ "$rc" -eq 0 ] || echo "$o1 / $o2"
  return "$rc"
}
two_sides() {
  local r="$1"
  seed "$r"
  git -C "$r" checkout -q -b theirs
  printf '#!/bin/bash\necho b\n' > "$r/bin/b"; mkdir -p "$r/skills/y"; printf -- '---\nname: y\n---\n' > "$r/skills/y/SKILL.md"
  regen "$r"; commit_all "$r" "theirs adds bin/b and skill y"
  git -C "$r" checkout -q main
  printf '#!/bin/bash\necho a\n' > "$r/bin/a"; mkdir -p "$r/skills/x"; printf -- '---\nname: x\n---\n' > "$r/skills/x/SKILL.md"
  regen "$r"; commit_all "$r" "ours adds bin/a and skill x"
}

# 1. merge: different bin/ files and a skill on each side.
R="$TMP/merge"; two_sides "$R"
o="$(git -C "$R" merge --no-edit theirs 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "merge of two branches touching both generated files has no conflict" || bad "merge conflicted (rc $rc)" "$o"
[ "$(git -C "$R" rev-list --parents -n1 HEAD | wc -w | tr -d ' ')" = 3 ] && ok "HEAD is still the merge commit" || bad "HEAD is not a two-parent merge"
m="$(head_current "$R")" && ok "merged SHA256SUMS.txt and README counts match the merged tree" || bad "merged generated files stale" "$m"
grep -q "2 skills" "$R/README.md" && ok "README counts both new skills (2), not either side's 1" || bad "README count wrong" "$(grep skills "$R/README.md")"
[ -z "$(git -C "$R" status --porcelain)" ] && ok "working tree clean after the merge" || bad "tree dirty after merge" "$(git -C "$R" status --porcelain)"
grep -q "merge_regen:" <<<"$o" && echo "     $(grep merge_regen: <<<"$o")"

# 2. rebase: the same two branches, ours replayed onto theirs.
R="$TMP/rebase"; two_sides "$R"
o="$(git -C "$R" rebase theirs 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "rebase across both generated files has no conflict" || bad "rebase conflicted (rc $rc)" "$o"
[ ! -d "$R/.git/rebase-merge" ] && ok "rebase finished" || bad "rebase still in progress"
m="$(head_current "$R")" && ok "rebased tip's SHA256SUMS.txt and README counts match its tree" || bad "rebased tip stale" "$m"
[ "$(git -C "$R" rev-list --count theirs..HEAD)" = 1 ] && ok "rebase kept one commit on top, no extra fixup commit" || bad "unexpected commit count"
[ -z "$(git -C "$R" status --porcelain)" ] && ok "working tree clean after the rebase" || bad "tree dirty after rebase"

# 3. One file edited on both sides in different hunks: its merged hash is
#    neither side's, so the driver defers and settle computes it.
R="$TMP/samefile"; seed "$R"
for i in $(seq 1 30); do echo "echo line $i"; done > "$R/bin/shared"; regen "$R"; commit_all "$R" "shared"
git -C "$R" checkout -q -b theirs
sed -i '' 's/line 2$/line 2 theirs/' "$R/bin/shared"; regen "$R"; commit_all "$R" "theirs edits top"
git -C "$R" checkout -q main
sed -i '' 's/line 29$/line 29 ours/' "$R/bin/shared"; regen "$R"; commit_all "$R" "ours edits bottom"
o="$(git -C "$R" merge --no-edit theirs 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "a file changed on both sides still merges without conflict" || bad "same-file merge conflicted" "$o"
m="$(head_current "$R")" && ok "its checksum is the merged file's, not either side's" || bad "same-file manifest stale" "$m"

# 4. A real prose conflict outside the counts block still stops the merge,
#    and the commit that concludes it is settled by post-commit.
R="$TMP/prose"; two_sides "$R"
git -C "$R" checkout -q theirs; sed -i '' 's/^Prose line 15\.$/Prose fifteen, theirs./' "$R/README.md"; commit_all "$R" "theirs prose"
git -C "$R" checkout -q main;   sed -i '' 's/^Prose line 15\.$/Prose fifteen, ours./' "$R/README.md"; commit_all "$R" "ours prose"
o="$(git -C "$R" merge --no-edit theirs 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && grep -q '^<<<<<<<' "$R/README.md" && ok "a real README prose conflict still stops the merge" || bad "prose conflict was hidden" "$o"
[ "$(grep -c 'BEGIN GENERATED: counts' "$R/README.md")" = 1 ] && ok "the counts block stays out of the conflict hunk" || bad "counts region mangled"
sed -i '' -e '/^<<<<<<< /d' -e '/^=======$/d' -e '/^>>>>>>> /d' -e 's/^Prose fifteen, theirs\.$//' "$R/README.md"
git -C "$R" add README.md && git -C "$R" commit -q --no-edit 2>/dev/null
m="$(head_current "$R")" && ok "the commit concluding a conflicted merge is settled" || bad "conflicted merge left stale" "$m"

# 5. A dirty tree holding another tab's untracked skill: counts come from
#    HEAD's tree, never from what happens to be on disk.
R="$TMP/dirty"; two_sides "$R"
mkdir -p "$R/skills/other-tab"; printf -- '---\nname: o\n---\n' > "$R/skills/other-tab/SKILL.md"
o="$(git -C "$R" merge --no-edit theirs 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "merge with another tab's untracked file on disk" || bad "dirty merge failed" "$o"
m="$(head_current "$R")" && ok "counts ignore the untracked skill (settled in a clean worktree)" || bad "untracked skill leaked into counts" "$m"
[ -f "$R/skills/other-tab/SKILL.md" ] && ok "the other tab's file is untouched" || bad "untracked file lost"
[ "$(git -C "$R" worktree list | wc -l | tr -d ' ')" = 1 ] && ok "the temporary worktree was removed" || bad "worktree left behind"

# 6. No settle hooks wired: an ambiguous merge must conflict, never commit stale.
# Theirs gets a second skill so the two counts lines differ: identical sides
# never reach a driver at all, which is why settle checks every merge.
R="$TMP/nohooks"; two_sides "$R"
git -C "$R" checkout -q theirs; mkdir -p "$R/skills/z"; printf -- '---\nname: z\n---\n' > "$R/skills/z/SKILL.md"
regen "$R"; commit_all "$R" "theirs adds skill z"; git -C "$R" checkout -q main
git -C "$R" config --unset core.hooksPath
o="$(git -C "$R" merge --no-edit theirs 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && ok "without settle hooks an ambiguous counts merge conflicts instead of going stale" || bad "merged stale with no hooks" "$o"
git -C "$R" merge --abort 2>/dev/null

# 7. install is idempotent.
R="$TMP/merge"
o1="$(cd "$R" && python3 tools/merge_regen.py install --repo .)"
[ "$o1" = "merge drivers: already registered" ] && ok "install twice changes nothing" || bad "install not idempotent" "$o1"

echo ""
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
