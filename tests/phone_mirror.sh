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
printf '{"env":{"TODOIST_API_TOKEN":"f0126e193b7fb233c00d57d8480de4741106209e"},"model":"x","enabledPlugins":{"blader/humanizer":true},"hooks":{"Stop":[]}}' > "$CL/settings.json"
echo "credit: blader/humanizer" > "$CL/rules/credits.md"

CLAUDE_HOME="$CL" bash "$BIN" "$BRAIN"; rc=$?
[ "$rc" = 0 ] && ok "clean mirror exits 0" || no "clean mirror exited $rc"
[ -f "$BRAIN/claude/skills/linked/SKILL.md" ] && [ ! -L "$BRAIN/claude/skills/linked" ] \
  && ok "skill symlink copied as a real folder" || no "skill symlink not dereferenced"
[ "$(jq -r '.env // "gone"' "$BRAIN/claude/settings.json")" = gone ] \
  && ok "settings env block not copied" || no "env block survived"
grep -rq f0126e193b7f "$BRAIN/claude" && no "raw token in mirror" || ok "raw token absent everywhere"
[ "$(jq -c .hooks "$BRAIN/claude/settings.json")" = '{"Stop":[]}' ] && ok "hooks kept, and a plugin name in a skill is not a leak" || no "settings mangled"

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

rm "$CL/rules/guard.sh"
printf '{"env":{"TODOIST_API_TOKEN":"f0126e193b7fb233c00d57d8480de4741106209e"},"mcpServers":{"x":{"env":{"DB":"postgres://u:hunter22pass@h/db"},"headers":{"Authorization":"Bearer abcdefgh12345678"}}},"apiToken":"zzzzzzzz9999"}' > "$CL/settings.json"
echo "DB=postgres://u:hunter22pass@h/db" > "$CL/rules/.env"
CLAUDE_HOME="$CL" bash "$BIN" "$BRAIN"; rc=$?
[ "$rc" = 0 ] && ok "nested settings run is clean" || no "nested run exited $rc"
[ "$(jq -c 'keys' "$BRAIN/claude/settings.json")" = '[]' ] \
  && ok "settings keeps only hooks and permissions; env, mcpServers, apiToken dropped" || no "settings kept: $(jq -c keys "$BRAIN/claude/settings.json")"
grep -rq "hunter22pass\|abcdefgh12345678\|zzzzzzzz9999" "$BRAIN/claude" && no "a settings secret reached the mirror" || ok "no settings secret anywhere in the mirror"
[ ! -e "$BRAIN/claude/rules/.env" ] && ok "dotenv files are never copied" || no ".env was copied"

echo "pw=Zq8xV2mN7pL4" > "$CL/rules/deploy.ini"
echo "pw=Zq8xV2mN7pL4" > "$CL/rules/notes.cfg"
CLAUDE_HOME="$CL" bash "$BIN" "$BRAIN"
[ ! -e "$BRAIN/claude/rules/deploy.ini" ] && [ ! -e "$BRAIN/claude/rules/notes.cfg" ] \
  && ok "files outside the text allowlist are never copied" || no "an unlisted file type was copied"
rm "$CL/rules/deploy.ini" "$CL/rules/notes.cfg"

echo 'curl -H "x: Zq8xV2mN7pL4Yt9w"' > "$CL/rules/inline.sh"
MY_SERVICE_API_KEY=Zq8xV2mN7pL4Yt9w CLAUDE_HOME="$CL" bash "$BIN" "$BRAIN" 2>/dev/null; rc=$?
[ "$rc" = 1 ] && ok "refuses a shell secret pasted into a hook" || no "inlined shell secret exited $rc"
rm "$CL/rules/inline.sh"

# A settings.json jq can't parse must stop the run, never skip the check.
cp "$CL/settings.json" "$T/good.json"; printf '{"env":{"K":"Zq8xV2mN7pL4Yt9w"}' > "$CL/settings.json"
CLAUDE_HOME="$CL" bash "$BIN" "$BRAIN" 2>/dev/null; rc=$?
[ "$rc" = 1 ] && ok "unreadable settings.json fails closed" || no "broken settings exited $rc"
mv "$T/good.json" "$CL/settings.json"

# A refused run must leave the last good mirror exactly as it was.
before="$(cat "$BRAIN/claude/rules/writing.md")"
echo "changed" > "$CL/rules/writing.md"
echo 'x ghp_abcdefghijklmnopqrstuvwxyz0123' > "$CL/rules/gh.md"
CLAUDE_HOME="$CL" bash "$BIN" "$BRAIN" 2>/dev/null; rc=$?
[ "$rc" = 1 ] && [ ! -e "$BRAIN/claude/rules/gh.md" ] && [ "$(cat "$BRAIN/claude/rules/writing.md")" = "$before" ] \
  && ok "a refused run writes nothing into the repo" || no "refused run touched the repo (rc $rc)"

echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
