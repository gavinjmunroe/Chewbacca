#!/bin/bash
# A USC student who isn't Caleb, on a fresh Mac with only Chrome and an agent:
# install -> welcome answers -> their courses -> every lecture file -> due list.
#
# Each step was a wall on 2026-10-10. setup never linked the real `chewbacca`
# over start.sh's stub, so `chewbacca usc` printed stub help. brightspace and
# chewbacca api imported `cryptography`, which /usr/bin/python3 doesn't have.
# brightspace-sync needed an api engine built from GitHub before it would read
# a session Chrome already held. "Pull my slides" had no one command. Nothing
# here touches the network, a real Chrome profile, or a USC system: Brightspace
# is a fixture, Chrome is a scratch folder, `open` is a fake that logs.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0; ok() { echo "  ok   $1"; }; no() { echo "  FAIL $1"; fail=1; }
NODE_DIR="$(dirname "$(command -v node)")"
export HOME="$T/home" CHEWBACCA_NO_RUNTIME=1 CHEWBACCA_CHROME_DIR="$T/chrome" \
  BRIGHTSPACE_STATE="$T/state" BRIGHTSPACE_DELAY=0,0
mkdir -p "$HOME/.local/bin" "$T/chrome" "$T/fake"
unset COURSEWORK_DIR CHEWIE_CHROME_PROFILE CHEWBACCA_ROOT CHEWBACCA_BRAIN_DIR
# Stock macOS python3 first, the one a fresh Mac has, and an `open` that logs.
printf '#!/bin/sh\necho "$*" >> "%s/opened"\n' "$T" > "$T/fake/open"; chmod +x "$T/fake/open"
: > "$T/opened"
export PATH="$T/fake:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$NODE_DIR"

# 1. Install. start.sh leaves its six-verb stub first; setup must replace it.
awk '/^cat > "\$BIN_DIR\/chewbacca" <</{on=1; next} on && /^[A-Z]+$/{exit} on' "$ROOT/start.sh" \
  > "$HOME/.local/bin/chewbacca"
chmod +x "$HOME/.local/bin/chewbacca"
grep -q 'Installed by start.sh' "$HOME/.local/bin/chewbacca" || no "could not read start.sh's stub"
bash "$ROOT/setup.sh" --only settings --profile student --name "Tommy Trojan" > "$T/setup.log" 2>&1 \
  || no "setup exited non-zero: $(tail -3 "$T/setup.log")"
for tool in chewbacca coursework brightspace brightspace-sync; do
  [ -L "$HOME/.local/bin/$tool" ] && ok "$tool is on PATH after install" || no "$tool is not linked into ~/.local/bin"
done
help="$(chewbacca --help 2>&1)"
printf '%s' "$help" | grep -q 'lockin pulls your courses' && ok "chewbacca on PATH is the real CLI, usc included" \
  || no "chewbacca on PATH is still the stub: $help"

# A rerun of start.sh (chewbacca update on a tarball install) finds that link
# and must replace it, never write its stub through it into the kit's CLI.
mkdir -p "$T/rerun/bin"; echo REAL > "$T/rerun/cli"; ln -s "$T/rerun/cli" "$T/rerun/bin/chewbacca"
awk '/^# `chewbacca` on PATH, so update/{on=1} on{print} on && /^chmod \+x "\$BIN_DIR\/chewbacca"$/{exit}' "$ROOT/start.sh" \
  > "$T/rerun/stub.sh"
grep -q 'Installed by start.sh' "$T/rerun/stub.sh" || no "could not read start.sh's stub block"
BIN_DIR="$T/rerun/bin" bash "$T/rerun/stub.sh"
[ "$(cat "$T/rerun/cli")" = REAL ] && ok "a start.sh rerun replaces the link instead of writing through it" \
  || no "start.sh wrote its stub through the symlink into the real CLI"

# 2. Welcome. A Chrome profile that has used Brightspace, holding the cookie
# the readers need, encrypted the way Chrome does with a fake Keychain secret.
mkdir -p "$T/chrome/Profile 2"
/usr/bin/python3 - "$T/chrome/Profile 2/Cookies" <<'PY'
import hashlib, sqlite3, subprocess, sys, time
key = hashlib.pbkdf2_hmac("sha1", b"fake-safe-storage", b"saltysalt", 1003, 16)
pt = b"\xff" * 32 + b"tommy-session"  # Chrome's 32-byte host hash, not UTF-8
pt += bytes([16 - len(pt) % 16]) * (16 - len(pt) % 16)
blob = b"v10" + subprocess.run(["/usr/bin/openssl", "enc", "-e", "-aes-128-cbc", "-K", key.hex(),
                                "-iv", (b" " * 16).hex(), "-nopad"], input=pt, capture_output=True, check=True).stdout
c = sqlite3.connect(sys.argv[1])
c.execute("create table cookies(host_key text, name text, encrypted_value blob, last_access_utc int)")
c.execute("insert into cookies values (?,?,?,?)", ("brightspace.usc.edu", "d2lSessionVal", blob, int(time.time() * 1e6)))
c.commit()
PY
mkdir -p "$T/brain"; printf '# You\n' > "$T/brain/YOU.md"
q="$(CHEWBACCA_BRAIN_DIR="$T/brain" chewbacca welcome questions)"
printf '%s' "$q" | /usr/bin/python3 -c 'import json,sys; assert json.load(sys.stdin)["detected"]["school"]=="usc"' \
  && ok "welcome detects a USC student from Chrome" || no "welcome did not detect USC: $q"
w="$(CHEWBACCA_BRAIN_DIR="$T/brain" chewbacca welcome save --name Tommy --goals skip --comfort getby --tone short --confirm always --school usc)"
printf '%s' "$w" | /usr/bin/python3 -c '
import json, sys
d = json.load(sys.stdin)
assert d["first_try"][0] == "I need to lock in on school"
assert d["school"]["connect_command"] == "chewbacca usc lockin"
assert "itservices.usc.edu" in d["school"]["codex_page"]' \
  && ok "welcome ends on lock in, with the free USC Codex step" || no "welcome USC result: $w"

# The cookie reader on stock python3 with no `cryptography`: openssl decrypts.
CHEWBACCA_CHROME_SAFE_KEY=fake-safe-storage /usr/bin/python3 - "$ROOT/bin/brightspace" <<'PY' \
  && ok "Chrome's Brightspace cookie decrypts on stock python3 with no cryptography package" \
  || no "the cookie reader still needs the cryptography package"
import importlib.machinery, importlib.util, sys
sys.modules["cryptography"] = None  # import fails the way it does on a fresh Mac
loader = importlib.machinery.SourceFileLoader("bs", sys.argv[1])
spec = importlib.util.spec_from_loader("bs", loader); m = importlib.util.module_from_spec(spec); loader.exec_module(m)
assert m.PROFILE == "Profile 2", m.PROFILE
assert m.chrome_cookies() == {"d2lSessionVal": "tommy-session"}, m.chrome_cookies()
PY

# 3. Lock in, against a fixture Brightspace for a student with other courses.
/usr/bin/python3 - "$T/fixture.json" <<'PY'
import datetime as d, json, sys
now = d.datetime.now(d.timezone.utc)
iso = lambda days: (now + d.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
enr = lambda i, n: {"OrgUnit": {"Id": i, "Name": n}, "Access": {"IsActive": True}}
fx = {
    "/lp/1.63/enrollments/myenrollments/": {"Items": [
        enr(601, "20263_31001 MATH-226: Calculus III"),
        enr(602, "20263_31002 CSCI-104: Data Structures"),
        enr(603, "20263_31003 CSCI-104: Data Structures"),   # the lab, same code
        enr(604, "20263_31004 ITP-115: Python"),
        enr(500, "20253_29999 GESM-110: Last Year"),          # past term, ignored
    ], "PagingInfo": {"HasMoreItems": False}},
    "/le/1.99/601/calendar/events/myEvents/": {"Objects": [
        {"Title": "Midterm 1", "StartDateTime": iso(9)}, {"Title": "HW 4", "StartDateTime": iso(2)}]},
    "/le/1.99/602/calendar/events/myEvents/": {"Objects": [{"Title": "PA 2: Linked Lists", "StartDateTime": iso(1)}]},
    "/le/1.99/603/calendar/events/myEvents/": {"Objects": [{"Title": "Lab 5", "StartDateTime": iso(4)}]},
    "/le/1.99/604/calendar/events/myEvents/": {"Objects": []},
    "/le/1.99/601/content/toc": {"Modules": [{"Title": "Week 6", "Topics": [
        {"TopicId": 7001, "Title": "Lecture 11 Double Integrals", "TypeIdentifier": "File", "Url": "/c/l11.pdf"},
        {"TopicId": 7002, "Title": "Hidden key", "TypeIdentifier": "File", "Url": "/c/key.pdf", "IsHidden": True}]}]},
    "/le/1.99/602/content/toc": {"Modules": [{"Title": "Slides", "Topics": [
        {"TopicId": 7101, "Title": "Lecture 9 Linked Lists", "TypeIdentifier": "File", "Url": "/c/l9.pptx"}]}]},
    "/le/1.99/603/content/toc": {"Modules": []},
    "/le/1.99/604/content/toc": {"Modules": [{"Title": "Notes", "Topics": [
        {"TopicId": 7201, "Title": "Loops", "TypeIdentifier": "File", "Url": "/c/loops.pdf"},
        {"TopicId": 7202, "Title": "Zoom link", "TypeIdentifier": "Link", "Url": "https://usc.zoom.us/j/1"}]}]},
    "/le/1.99/601/content/topics/7001/file": "MATH226 L11 PDF BYTES",
    "/le/1.99/602/content/topics/7101/file": "CSCI104 L9 PPTX BYTES",
    "/le/1.99/604/content/topics/7201/file": "ITP115 LOOPS PDF BYTES",
}
json.dump(fx, open(sys.argv[1], "w"))
PY
export BRIGHTSPACE_FIXTURE="$T/fixture.json"
before=$fail
scan="$(chewbacca usc lockin 2>&1)"
for want in "Fall 2026: 3 courses" "MATH-226" "CSCI-104" "ITP-115" "Start with: CSCI-104 PA 2: Linked Lists" "would add 3 course file" "3 file(s) to pull"; do
  printf '%s' "$scan" | grep -qF "$want" || no "lockin scan is missing \"$want\": $scan"
done
printf '%s' "$scan" | grep -q GESM && no "last term's course reached lockin"
ls "$HOME/coursework/courses/"*.yml >/dev/null 2>&1 && no "the lockin scan wrote ledger files"
[ -e "$HOME/coursework/slides" ] && no "the lockin scan wrote files"
[ "$fail" = "$before" ] && ok "lockin lists their own courses, what's due first and what it would pull, and writes nothing"

applied="$(chewbacca usc lockin --apply 2>&1)" || no "lockin --apply exited non-zero: $applied"
[ "$(cat "$HOME/coursework/slides/MATH-226/Week 6/Lecture 11 Double Integrals.pdf" 2>/dev/null)" = "MATH226 L11 PDF BYTES" ] \
  && [ -f "$HOME/coursework/slides/CSCI-104/Slides/Lecture 9 Linked Lists.pptx" ] \
  && [ -f "$HOME/coursework/slides/ITP-115/Notes/Loops.pdf" ] \
  && ok "every visible lecture file landed in ~/coursework/slides/<CODE>/" || no "files not pulled: $applied"
find "$HOME/coursework/slides" -name 'Hidden key*' | grep -q . && no "a hidden file was pulled"
[ -f "$HOME/coursework/courses/csci-104.yml" ] && grep -q 'Lab 5' "$HOME/coursework/courses/csci-104.yml" \
  && grep -q 'source: "Brightspace calendar' "$HOME/coursework/courses/csci-104.yml" \
  && ok "the ledger was built from their enrollment, lecture and lab merged, every item sourced" \
  || no "ledger not seeded: $(ls "$HOME/coursework/courses" 2>&1)"
grep -q 'term: "Fall 2026"' "$HOME/coursework/semester.yml" 2>/dev/null || no "semester.yml not written from the term code"
again="$(chewbacca usc lockin --apply 2>&1)"
printf '%s' "$again" | grep -q "Pulled 0 file" && printf '%s' "$again" | grep -q "every course already has a file" \
  && ok "a rerun pulls nothing new and overwrites no ledger file" || no "rerun was not idempotent: $again"

# 4. What's due, from the ledger lockin built.
due="$(coursework due --days 14 2>&1)"
first="$(printf '%s\n' "$due" | grep -E 'PA 2|HW 4|Lab 5|Midterm 1' | head -1)"
printf '%s' "$first" | grep -q 'PA 2' && printf '%s' "$due" | grep -q 'Midterm 1' \
  && ok "coursework due reads the new ledger, soonest first" || no "coursework due: $due"
check="$(coursework check 2>&1)"
printf '%s' "$check" | grep -q 'no AI policy recorded' \
  && ok "check flags the unknown AI policy on the seeded courses" || no "check did not flag the missing AI policy"
[ -s "$T/opened" ] && no "something opened a page while signed in: $(cat "$T/opened")"

# 5. Signed out: one BLOCKED line, and the one page they need, once. A
# profile with other sites' cookies, its file hours old, is a student who never
# signed in, not a wedged Chrome: "quit Chrome" would hide the sign-in page.
unset BRIGHTSPACE_FIXTURE
rm -rf "$T/chrome/Profile 2"
mkdir -p "$T/chrome/Default"
/usr/bin/python3 -c 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("create table cookies(host_key text, name text, encrypted_value blob, last_access_utc int)"); c.execute("insert into cookies values (?,?,?,?)", (".google.com","NID",b"",1)); c.commit()' "$T/chrome/Default/Cookies"
touch -t 202601010000 "$T/chrome/Default/Cookies"
out="$(chewbacca usc lockin 2>&1)"; rc=$?
[ "$rc" = 3 ] && printf '%s' "$out" | grep -q '^BLOCKED: Brightspace' && ! printf '%s' "$out" | grep -q 'Quit Chrome' \
  && ok "signed out says BLOCKED in one line" || no "signed-out lockin: rc=$rc $out"
chewbacca usc lockin >/dev/null 2>&1
[ "$(grep -c 'brightspace.usc.edu' "$T/opened")" = 1 ] && ok "only the one sign-in page opened, once, across two runs" \
  || no "open calls: $(cat "$T/opened")"
exit "$fail"
