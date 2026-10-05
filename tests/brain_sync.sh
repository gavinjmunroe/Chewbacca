#!/bin/bash
# brain-sync commits this session's brain writes as one commit per turn, by
# name, and never touches another session's edits in the same repo.
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/brain-sync.sh"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }

TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
TEST_HOME="$TEST_DIR/home"
BRAIN="$(cd "$TEST_DIR" && pwd -P)/brain"
mkdir -p "$TEST_HOME/.claude" "$BRAIN"
printf 'PERSONAL_CONTEXT_DIR="%s"\nPUBLIC_CONTEXT_DIR=""\n' "$BRAIN" > "$TEST_HOME/.claude/d1-config.sh"

g(){ git -C "$BRAIN" "$@"; }
g init -q
g config user.email t@example.com; g config user.name t; g config commit.gpgsign false
echo seed > "$BRAIN/seed.md"; g add seed.md; g commit -q -m seed

LOG="$TEST_DIR/write-log.tsv"
echo mine > "$BRAIN/a.md"; echo mine > "$BRAIN/b.md"; echo theirs > "$BRAIN/c.md"
printf '1\tS1\t%s\twrite\n1\tS1\t%s\tbash\n1\tS2\t%s\twrite\n' "$BRAIN/a.md" "$BRAIN/b.md" "$BRAIN/c.md" > "$LOG"
printf '%s\n' '{"type":"user","message":{"content":"save the stack audit"}}' > "$TEST_DIR/t.jsonl"

run(){ printf '{"session_id":"%s","transcript_path":"%s"}' "$1" "$TEST_DIR/t.jsonl" \
  | env HOME="$TEST_HOME" CHEWBACCA_WRITE_LOG="$LOG" CHEWBACCA_LOG_DIR="$TEST_DIR/logs" bash "$HOOK" >/dev/null 2>&1; }

run S1
[ "$(g rev-list --count HEAD)" = 2 ] && ok "one commit for the turn's two writes" || no "expected exactly one new commit"
[ "$(g log -1 --format=%s)" = "brain: save the stack audit" ] && ok "named after the turn's prompt" \
  || no "subject was: $(g log -1 --format=%s)"
[ "$(g show --name-only --format= HEAD | sort | tr '\n' ' ')" = "a.md b.md " ] && ok "commits only this session's files" \
  || no "committed: $(g show --name-only --format= HEAD | tr '\n' ' ')"
g status --porcelain | grep -q '?? c.md' && ok "leaves another session's file untouched" || no "c.md was swept up"

run S1
[ "$(g rev-list --count HEAD)" = 2 ] && ok "a turn with nothing new commits nothing" || no "made an empty commit"

echo staged > "$BRAIN/seed.md"; g add seed.md
echo more > "$BRAIN/a.md"
run S1
g diff --cached --name-only | grep -q seed.md && ok "someone else's staged file stays staged and uncommitted" \
  || no "swallowed a file another session had staged"

g reset -q; g stash -q -u; g stash drop -q
mkdir -p "$BRAIN/new"
echo mine > "$BRAIN/new/x.md"; echo theirs > "$BRAIN/new/y.md"; echo k > "$BRAIN/.env"
echo glob > "$BRAIN/*.md"; echo untouched > "$BRAIN/seed.md"
printf '1\tS3\t%s\twrite\n1\tS3\t%s\tbash\n1\tS3\t%s\tbash\n' "$BRAIN/new/x.md" "$BRAIN/.env" "$BRAIN/*.md" >> "$LOG"
run S3
files="$(g show --name-only --format= HEAD | sort | tr '\n' ' ')"
[ "$files" = '*.md new/x.md ' ] && ok "a new folder adds only the written file, and a glob-named file stays literal" \
  || no "committed: $files"
g status --porcelain | grep -q '?? .env' && ok "a secret-named file is never committed" || no ".env was committed"

PUB="$(cd "$TEST_DIR" && pwd -P)/public"; mkdir -p "$PUB"
git -C "$PUB" init -q; git -C "$PUB" config user.email t@example.com; git -C "$PUB" config user.name t
git -C "$PUB" config commit.gpgsign false
printf 'PERSONAL_CONTEXT_DIR="%s"\nPUBLIC_CONTEXT_DIR="%s"\n' "$BRAIN" "$PUB" > "$TEST_HOME/.claude/d1-config.sh"
echo p > "$PUB/p.md"; printf '1\tS4\t%s\twrite\n' "$PUB/p.md" >> "$LOG"
run S4
[ "$(git -C "$PUB" log -1 --format=%s)" = "brain: update 1 file(s)" ] && ok "the public repo never carries the prompt" \
  || no "public subject was: $(git -C "$PUB" log -1 --format=%s)"

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
