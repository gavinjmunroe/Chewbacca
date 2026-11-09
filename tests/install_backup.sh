#!/usr/bin/env bash
# install.sh keeps a copy of every file it replaces. Break-it, 2026-10-19: it
# overwrote a project's CLAUDE.md and the user's own ~/.claude/rules and
# agents files with plain cp, and their versions were gone.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HOME="$T/home"
mkdir -p "$HOME/.claude/rules" "$HOME/.claude/agents" "$T/proj"
echo "my project rules" > "$T/proj/CLAUDE.md"
echo "my security rules" > "$HOME/.claude/rules/security.md"
echo "my reviewer" > "$HOME/.claude/agents/code-reviewer.md"
fail=0
ok() { if eval "$2"; then echo "  ok    $1"; else echo "  FAIL  $1"; fail=$((fail+1)); fi; }
bash "$ROOT/install.sh" "$T/proj" >"$T/out" 2>&1; rc=$?
ok "install exits 0" '[ "$rc" = 0 ]'
B=$(ls -d "$HOME/.claude/backups/install-"* 2>/dev/null | head -1)
ok "a backup dir was made" '[ -n "$B" ]'
ok "the project CLAUDE.md was kept" 'grep -rqx "my project rules" "$B"'
ok "the user's security.md was kept" 'grep -qx "my security rules" "$B/.claude/rules/security.md"'
ok "the user's code-reviewer.md was kept" 'grep -qx "my reviewer" "$B/.claude/agents/code-reviewer.md"'
ok "the install still placed the kit's CLAUDE.md" 'cmp -s "$ROOT/CLAUDE.md" "$T/proj/CLAUDE.md"'
ok "it says where the copies are" 'grep -q "saved in" "$T/out"'
# A second run over its own files makes no new backup.
rm -rf "$HOME/.claude/backups"
bash "$ROOT/install.sh" "$T/proj" >/dev/null 2>&1
ok "an identical re-run backs up nothing" '[ ! -d "$HOME/.claude/backups" ]'
[ "$fail" -eq 0 ] && echo "install-backup ok" || { echo "install-backup: $fail failed"; exit 1; }
