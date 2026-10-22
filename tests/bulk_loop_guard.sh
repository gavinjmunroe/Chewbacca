#!/usr/bin/env bash
# bulk-loop-guard on the shapes it has to get right, plus contacts-bulk's
# replace plan (pure Python, never touches Contacts). The first assertions are
# refusals, so a guard that returns early can never pass this file.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
GUARD="$ROOT/.claude/hooks/bulk-loop-guard.sh"
FAILED=0
note() { echo "    $1"; }
fail() { echo "    FAIL: $1"; FAILED=1; }

verdict() {
  local cmd out; cmd="$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$1")"
  out="$(printf '{"session_id":"t","tool_name":"Bash","tool_input":{"command":%s}}' "$cmd" \
    | HOOKD_INNER=1 bash "$GUARD" 2>/dev/null)"
  local rc=$?
  [ "$rc" = "0" ] || { echo "exit$rc"; return; }
  case "$out" in *'"deny"'*) echo deny ;; "") echo allow ;; *) echo "odd" ;; esac
}
denies() { local v; v="$(verdict "$1")"; [ "$v" = deny ] && note "denies: ${1:0:60}" || fail "${1:0:60} got $v, expected deny"; }
allows() { local v; v="$(verdict "$1")"; [ "$v" = allow ] && note "allows: ${1:0:60}" || fail "${1:0:60} got $v, expected allow"; }

[ -x "$GUARD" ] || { echo "    FAIL: $GUARD is not executable"; exit 1; }

# The exact 2026-10-21 shape.
denies 'osascript <<EOF
tell application "Contacts"
  repeat with p in people
    set f to first name of p
    set l to last name of p
  end repeat
end tell
EOF'
denies 'osascript -e "tell application \"Notes\" to repeat with n in every note
set t to name of n
end repeat"'
denies 'osascript -l JavaScript -e "const C=Application(\"Contacts\"); for (const p of C.people()) { out.push(p.firstName()) }"'
denies 'osascript -l JavaScript -e "const ps=Application(\"Contacts\").people; for(let i=0;i<n;i++){ x.push(ps[i].lastName()) }"'

# A script written to a file and run in the same command is read too.
TMP="$(mktemp -d)"
printf 'tell application "Messages"\nrepeat with c in chats\nset n to name of c\nend repeat\nend tell\n' > "$TMP/slow.applescript"
denies "osascript $TMP/slow.applescript"
printf 'const p=Application("Contacts").people; const ids=p.id(), l=p.lastName(); JSON.stringify(ids)\n' > "$TMP/fast.js"
allows "osascript -l JavaScript $TMP/fast.js"
rm -rf "$TMP"

allows 'osascript -l JavaScript -e "const p=Application(\"Contacts\").people; const ids=p.id(), f=p.firstName();"'
allows 'osascript -e "tell application \"Contacts\" to get last name of every person"'
allows 'osascript -e "tell application \"Finder\" to repeat with i from 1 to 3
beep
end repeat"'
allows 'osascript -e "repeat with p in people
set x to name of p
end repeat" # per-item: three ids from the user'
allows 'echo "repeat with p in people"'
allows 'git log --oneline | head'

# contacts-bulk's plan: case-insensitive, every field, old values kept.
python3 - "$ROOT/bin/contacts-bulk" <<'PY' || FAILED=1
import importlib.machinery, importlib.util, sys
loader = importlib.machinery.SourceFileLoader("cb", sys.argv[1])
spec = importlib.util.spec_from_loader("cb", loader)
cb = importlib.util.module_from_spec(spec); loader.exec_module(cb)
blank = {f: "" for f in cb.FIELDS}
rows = [
    dict(blank, id="1", firstName="Matt A2f USC"),
    dict(blank, id="2", lastName="George A2F", note="known from: A2F"),
    dict(blank, id="3", lastName="Unrelated"),
]
e = cb.plan(rows, "A2F", "GenCollege")
assert [x["id"] for x in e] == ["1", "2"], e
assert e[0]["set"] == {"firstName": "Matt GenCollege USC"}, e[0]
assert e[1]["set"] == {"lastName": "George GenCollege", "note": "known from: GenCollege"}, e[1]
assert e[1]["was"]["note"] == "known from: A2F"
assert cb.plan(rows, "A2F", "X", case=True)[0]["id"] == "2"
assert cb.plan(rows, "a.f", "X") == []          # text, never a regex
assert len(cb.matches(rows, "a2f")) == 2
print("    contacts-bulk plan: case-insensitive, every field, old values kept")
PY

exit $FAILED
