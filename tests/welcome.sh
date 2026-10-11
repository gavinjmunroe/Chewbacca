#!/usr/bin/env bash
# chewbacca welcome: the six tappable questions after install, and what each
# answer writes. Runs on the stock macOS Python, because a fresh Mac has no
# other one. Caleb's bar, 2026-10-09: "My grandma should be able to use this."
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="${STOCK_PYTHON:-/usr/bin/python3}"; [ -x "$PY" ] || PY=python3
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0; pass() { echo "  ok   $1"; }; bad() { echo "  FAIL $1"; fail=1; }
export HOME="$T/home" CHEWBACCA_HOME="$T/home/.chewbacca" CHEWBACCA_BRAIN_DIR="$T/brain"
mkdir -p "$HOME" "$T/brain"
printf '# You\n\n- **Name:** YOUR_NAME\n' > "$T/brain/YOU.md"
W() { "$PY" "$ROOT/bin/chewbacca-welcome" "$@"; }

W questions | "$PY" -c '
import json, sys
d = json.load(sys.stdin)
qs = [q for s in d["screens"] for q in s]
assert len(qs) <= 6, "too many questions"
assert all(len(s) <= 2 for s in d["screens"]), "more than two questions on a screen"
assert all(len(q["options"]) <= 4 for q in qs), "more than four options"
assert d["defaults"]["confirm"] == "always", "skipping safety must mean always ask"
' && pass "at most two questions a screen, four options each, safe default" || bad "question set shape"

W status >/dev/null 2>&1 && bad "status says welcomed before any answers" || pass "status is false before the welcome"

out="$(W save --name Rose --goals texts,calendar,"my garden club" --comfort new --tone warm --confirm skip)" \
  || bad "save exited non-zero"
grep -q 'Name:\*\* Rose' "$T/brain/YOU.md" && pass "name fills the template placeholder" || bad "name not written"
grep -q 'never ask me to type a command' "$T/brain/YOU.md" && pass "comfort answer becomes a standing rule" || bad "comfort rule missing"
grep -q 'Always ask me before sending' "$T/brain/YOU.md" && pass "a skipped safety question means always ask" || bad "skip did not default to always ask"
grep -q 'my garden club' "$T/brain/YOU.md" && pass "an Other goal keeps the person's own words" || bad "Other goal lost"
printf '%s' "$out" | "$PY" -c '
import json, sys
d = json.load(sys.stdin)
assert d["permissions"] == ["full-disk-access", "automation"], d["permissions"]
assert d["permission_command"].endswith("--only full-disk-access,automation")
assert len(d["primers"]) == 2
' && pass "texts asks for exactly Messages access, with a primer line first" || bad "permissions for texts"
W status >/dev/null && pass "status is true after saving" || bad "status after save"

out="$(W save --name Rose --goals writing --comfort builder --tone short --confirm big)"
[ "$(grep -c 'BEGIN chewbacca-welcome' "$T/brain/YOU.md")" = 1 ] && pass "saving again rewrites the section in place" || bad "duplicate welcome sections"
grep -q 'I build software' "$T/brain/YOU.md" && ! grep -q 'never ask me to type' "$T/brain/YOU.md" \
  && pass "a changed answer replaces the old rule" || bad "old answer survived a re-save"
printf '%s' "$out" | "$PY" -c 'import json,sys; d=json.load(sys.stdin); assert d["permissions"]==[] and d["permission_command"] is None' \
  && pass "writing-only asks for no Mac permission at all" || bad "writing-only requested a permission"

W save --comfort expert >/dev/null 2>&1 && bad "an unknown answer was accepted" || pass "an unknown answer is refused, not guessed"

# Every permission a goal names must be one the guide can actually walk.
"$PY" - "$ROOT" <<'PYEOF' && pass "every goal's permissions exist in the permission guide" || bad "goal names a permission the guide cannot walk"
import sys
from importlib.machinery import SourceFileLoader
root = sys.argv[1]
w = SourceFileLoader("w", root + "/bin/chewbacca-welcome").load_module()
p = SourceFileLoader("p", root + "/bin/chewbacca-permissions").load_module()
known = {n[1] for n in p.SETS["chewbacca"]}
assert all(set(g["permissions"]) <= known for g in w.GOALS.values())
PYEOF

# A USC student. Detected from a Chrome profile's cookie hosts (no values, no
# Keychain), so skipping the question still lands on the USC path, and the
# first thing offered is their own classes plus the free-Codex step.
W questions | "$PY" -c 'import json,sys; assert json.load(sys.stdin)["detected"]["school"] is None' \
  && pass "no Chrome, no school guessed" || bad "a school was detected on a Mac with no Chrome"
mkdir -p "$T/chrome/Profile 3"
"$PY" -c 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("create table cookies(host_key text, name text)"); c.execute("insert into cookies values (?,?)", ("brightspace.usc.edu","d2lSessionVal")); c.commit()' "$T/chrome/Profile 3/Cookies"
export CHEWBACCA_CHROME_DIR="$T/chrome"
W questions | "$PY" -c 'import json,sys; d=json.load(sys.stdin); assert d["detected"]["school"]=="usc"; assert all(len(s)<=2 for s in d["screens"])' \
  && pass "a Chrome profile that used Brightspace is detected as USC" || bad "USC not detected"
out="$(W save --name Tommy --goals writing --comfort comfortable --tone short --confirm always --school skip)"
printf '%s' "$out" | "$PY" -c '
import json, sys
d = json.load(sys.stdin)
s = d["school"]
assert d["first_try"][0] == "I need to lock in on school", d["first_try"]
assert s["connect_command"] == "chewbacca usc lockin"
assert s["codex_page"].startswith("https://itservices.usc.edu/"), s
assert "Always Allow" in " ".join(d["primers"])
assert not any(w in json.dumps(d) for w in ("/sy" + "llabus", "/lock"))
' && pass "USC: lock in is the first try, the free Codex step points at usc.edu, the Keychain prompt is primed" \
  || bad "USC welcome result: $out"
grep -q "I'm a USC student" "$T/brain/YOU.md" && pass "being a USC student becomes a standing rule" || bad "USC rule missing"
unset CHEWBACCA_CHROME_DIR

grep -q 'welcome skill' "$ROOT/start.sh" && [ -f "$ROOT/skills/welcome/SKILL.md" ] \
  && pass "the install hands off to the welcome" || bad "start.sh does not start the welcome"
grep -q '"welcome"' "$ROOT/config/settings/toolkit.json" && pass "the welcome skill is in the install list" || bad "welcome skill would never install"
exit "$fail"
