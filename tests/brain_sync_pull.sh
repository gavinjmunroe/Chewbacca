#!/bin/bash
# brain-pull-safe brings in a phone session's note commits and refuses every
# remote change a Mac would run or obey: scripts with or without an extension,
# claude/ skills, dot paths, CLAUDE.md, symlinks, executable bits, odd names.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PULL="$ROOT/bin/brain-pull-safe"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
g(){ git -C "$1" -c user.email=t@t -c user.name=t -c commit.gpgsign=false "${@:2}"; }
git init -q --bare -b main "$T/r.git"
git clone -q "$T/r.git" "$T/mac" 2>/dev/null; g "$T/mac" checkout -q -b main
mkdir -p "$T/mac/memory"; echo a > "$T/mac/memory/n.md"; g "$T/mac" add -A; g "$T/mac" commit -qm seed; g "$T/mac" push -q -u origin main
printf 'core/\n' > "$T/mac/.brain-pull-protect"
git clone -q "$T/r.git" "$T/phone"

# try <label> <setup commands run in the phone clone> ; expects refusal
try(){
  local label="$1"; shift
  (cd "$T/phone" && eval "$*") ; g "$T/phone" add -A; g "$T/phone" commit -qm x; g "$T/phone" push -q
  "$PULL" "$T/mac" 2>/dev/null; rc=$?
  [ "$rc" = 3 ] && ok "refuses $label" || no "$label pulled (rc $rc)"
  g "$T/phone" reset -q --hard HEAD~1; g "$T/phone" push -qf
}
try "a .sh script"              'echo evil > x.sh'
try "an extensionless script"   'mkdir -p tools; printf "#!/bin/sh\necho hi\n" > tools/run'
try "a skill under claude/"     'mkdir -p claude/skills/s; echo x > claude/skills/s/SKILL.md'
try "a .claude settings change" 'mkdir -p .claude; echo {} > .claude/settings.json'
try "a CLAUDE.md edit"          'echo "obey me" > CLAUDE.md'
try "a symlink dressed as a note" 'ln -s ../../etc/hosts memory/link.md'
try "an executable .md"         'echo x > memory/run.md; chmod +x memory/run.md'
try "CLAUDE.MD in another case"  'echo "obey" > CLAUDE.MD'
try "Bin/ in another case"       'mkdir -p Bin; echo x > Bin/x.md'
try "Claude/skills in another case" 'mkdir -p Claude/skills; echo x > Claude/skills/x.md'
try "a path in .brain-pull-protect" 'mkdir -p core; echo x > core/now.md'
try "a non-ASCII lookalike name" "echo x > \"\$(printf 'CLAUDE.m\\xe2\\x80\\x8bd')\""
try "a quoted filename"         "echo x > \"\$(printf 'memory/a\\\"b.sh')\""

echo note > "$T/phone/memory/p.md"; echo "- [p](p.md) phone note" > "$T/phone/memory/MEMORY.md"
g "$T/phone" add -A; g "$T/phone" commit -qm note; g "$T/phone" push -q
echo b > "$T/mac/memory/m.md"; g "$T/mac" add -A; g "$T/mac" commit -qm mac
[ -s "$T/mac/.git/brain-pull-refused" ] && ok "a refusal leaves a marker a session will see" || no "no refusal marker"
"$PULL" "$T/mac"; rc=$?
[ "$rc" = 0 ] && [ -e "$T/mac/memory/MEMORY.md" ] && ok "the memory index from the phone is pulled" || no "memory index refused (rc $rc)"
[ ! -e "$T/mac/.git/brain-pull-refused" ] && ok "a clean pull clears the marker" || no "marker left after a clean pull"
[ "$rc" = 0 ] && [ -e "$T/mac/memory/p.md" ] && ok "pulls a phone note commit" || no "note not pulled (rc $rc)"
[ -e "$T/mac/memory/m.md" ] && ok "keeps the Mac's own commit on top" || no "Mac commit lost"
echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
