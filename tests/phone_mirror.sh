#!/bin/bash
# phone-mirror copies ~/.claude into the brain repo for a phone session, blanks
# settings env values, follows skill symlinks, and refuses a leaked credential.
set -uo pipefail
BIN="$(cd "$(dirname "$0")/.." && pwd)/bin/phone-mirror"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
CL="$T/claude-home"; BRAIN="$T/brain"; EXT="$T/ext-skill"
mkdir -p "$CL/rules" "$CL/skills" "$BRAIN" "$EXT"
echo "pray first" > "$CL/CLAUDE.md"
echo "no em dashes" > "$CL/rules/writing.md"
echo "skill body" > "$EXT/SKILL.md"
ln -s "$EXT" "$CL/skills/linked"
printf '{"env":{"TODOIST_API_TOKEN":"f0126e193b7fb233c00d57d8480de4741106209e"},"model":"x"}' > "$CL/settings.json"

CLAUDE_HOME="$CL" bash "$BIN" "$BRAIN"; rc=$?
[ "$rc" = 0 ] && ok "clean mirror exits 0" || no "clean mirror exited $rc"
[ -f "$BRAIN/claude/skills/linked/SKILL.md" ] && [ ! -L "$BRAIN/claude/skills/linked" ] \
  && ok "skill symlink copied as a real folder" || no "skill symlink not dereferenced"
[ "$(jq -r .env.TODOIST_API_TOKEN "$BRAIN/claude/settings.json")" = REDACTED ] \
  && ok "settings env value redacted" || no "env value survived"
grep -rq f0126e193b7f "$BRAIN/claude" && no "raw token in mirror" || ok "raw token absent everywhere"
[ "$(jq -r .model "$BRAIN/claude/settings.json")" = x ] && ok "other settings kept" || no "settings mangled"

# A hook that hard-codes the same token must stop the run.
echo 'curl -H "Bearer f0126e193b7fb233c00d57d8480de4741106209e"' > "$CL/rules/leaky.md"
CLAUDE_HOME="$CL" bash "$BIN" "$BRAIN" 2>/dev/null; rc=$?
[ "$rc" = 1 ] && ok "refuses when an env value leaks into a mirrored file" || no "leak exited $rc"
rm "$CL/rules/leaky.md"

echo 'key=ghp_abcdefghijklmnopqrstuvwxyz0123' > "$CL/rules/gh.md"
CLAUDE_HOME="$CL" bash "$BIN" "$BRAIN" 2>/dev/null; rc=$?
[ "$rc" = 1 ] && ok "refuses a GitHub token shape" || no "ghp leak exited $rc"

rm "$CL/rules/gh.md"
echo "SECRET_RE='sk-ant-[A-Za-z0-9]{20}|ghp_[A-Za-z0-9]{20}|xox[baprs]-[0-9]{10}'" > "$CL/rules/guard.sh"
CLAUDE_HOME="$CL" bash "$BIN" "$BRAIN" 2>/dev/null; rc=$?
[ "$rc" = 0 ] && ok "a hook's own secret regex is not a leak" || no "regex text exited $rc"

echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
