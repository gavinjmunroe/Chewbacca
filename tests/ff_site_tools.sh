#!/bin/bash
# logo-fetch, texts-photos and railway-attach, offline. Incidents: 2026-10-29 on the
# Firm Foundation /team page, a 16px Cisco mark and two globe placeholders shipped,
# Gavin's photos took a hand-written chat.db join, and the Vercel-to-Railway move took
# a GraphQL session by hand with DNS lines rewritten for the registrar.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }

# A PNG header is enough for logo-fetch --check: signature, IHDR length, IHDR, width, height.
png(){ python3 -c "import struct,sys;open(sys.argv[1],'wb').write(b'\x89PNG\r\n\x1a\n'+struct.pack('>I',13)+b'IHDR'+struct.pack('>II',int(sys.argv[2]),int(sys.argv[2]))+b'\0'*9)" "$1" "$2"; }
png "$T/crisp.png" 128; png "$T/globe.png" 16; echo "not a png" > "$T/bad.png"

python3 "$ROOT/bin/logo-fetch" --check "$T/crisp.png" >/dev/null && ok "a 128px mark passes" || no "a 128px mark passes"
python3 "$ROOT/bin/logo-fetch" --check "$T/globe.png" >/dev/null && no "a 16px placeholder is refused" || ok "a 16px placeholder is refused"
python3 "$ROOT/bin/logo-fetch" --check "$T/bad.png" >/dev/null && no "a non-PNG is refused" || ok "a non-PNG is refused"

# texts-photos against a tiny chat.db with one sent JPEG, one HEIC-free missing file, one of mine.
python3 - "$T" <<'PY'
import sqlite3, sys, time, os
t = sys.argv[1]
db = sqlite3.connect(f"{t}/chat.db")
db.executescript("""
CREATE TABLE handle(ROWID INTEGER PRIMARY KEY, id TEXT);
CREATE TABLE chat_handle_join(chat_id INTEGER, handle_id INTEGER);
CREATE TABLE chat_message_join(chat_id INTEGER, message_id INTEGER);
CREATE TABLE message(ROWID INTEGER PRIMARY KEY, date INTEGER, is_from_me INTEGER);
CREATE TABLE message_attachment_join(message_id INTEGER, attachment_id INTEGER);
CREATE TABLE attachment(ROWID INTEGER PRIMARY KEY, filename TEXT, mime_type TEXT);
""")
now = int((time.time() - 978307200) * 1e9)
open(f"{t}/a.jpg", "wb").write(b"\xff\xd8\xff\xd9")
db.execute("INSERT INTO handle VALUES (1, '+15550100')")
db.execute("INSERT INTO chat_handle_join VALUES (7, 1)")
for mid, me, att, fn, mime in [(1, 0, 1, f"{t}/a.jpg", "image/jpeg"), (2, 0, 2, f"{t}/gone.heic", "image/heic"), (3, 1, 3, f"{t}/a.jpg", "image/jpeg"), (4, 0, 4, f"{t}/a.pdf", "application/pdf")]:
    db.execute("INSERT INTO message VALUES (?, ?, ?)", (mid, now - mid, me))
    db.execute("INSERT INTO chat_message_join VALUES (7, ?)", (mid,))
    db.execute("INSERT INTO message_attachment_join VALUES (?, ?)", (mid, att))
    db.execute("INSERT INTO attachment VALUES (?, ?, ?)", (att, fn, mime))
db.commit()
PY
out=$(TEXTS_PHOTOS_DB="$T/chat.db" python3 "$ROOT/bin/texts-photos" +15550100 --out "$T/out" 2>&1)
[ "$(ls "$T/out" | wc -l | tr -d ' ')" = 1 ] && ok "only the image they sent is saved" || no "only the image they sent is saved ($out)"
printf '%s' "$out" | grep -q "1 never downloaded" && ok "a missing attachment is named, with how to fetch it" || no "a missing attachment is named ($out)"
TEXTS_PHOTOS_DB="$T/chat.db" python3 "$ROOT/bin/texts-photos" +15559999 --out "$T/none" >/dev/null 2>&1 && no "an unknown handle exits non-zero" || ok "an unknown handle exits non-zero"

# railway-attach's DNS lines: apex as ALIAS, www as CNAME, the TXT verification kept.
lines=$(python3 - "$ROOT" <<'PY'
import runpy, sys
mod = runpy.run_path(sys.argv[1] + "/bin/railway-attach")
print("\n".join(mod["dns_lines"]("example.com", [{"hostlabel": "", "requiredValue": "abc.up.railway.app"}], "_railway-verify", "railway-verify=1")))
print("\n".join(mod["dns_lines"]("www.example.com", [{"hostlabel": "www", "requiredValue": "def.up.railway.app"}], "_railway-verify.www", "railway-verify=2")))
PY
)
printf '%s' "$lines" | grep -q "^ALIAS  @  abc.up.railway.app$" && ok "the apex record is an ALIAS on @" || no "the apex record is an ALIAS on @ ($lines)"
printf '%s' "$lines" | grep -q "^CNAME  www  def.up.railway.app$" && ok "www is a CNAME" || no "www is a CNAME"
printf '%s' "$lines" | grep -q "^TXT  _railway-verify.www  railway-verify=2$" && ok "the verification TXT is printed" || no "the verification TXT is printed"

echo "  $pass passed, $fail failed"; [ "$fail" -eq 0 ]
