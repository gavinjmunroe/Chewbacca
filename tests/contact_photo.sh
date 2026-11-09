#!/usr/bin/env bash
# contact-photo finds a card's photo in a Sources/ db, strips the leading 0x01 byte,
# and fails cleanly on a card with no photo. Synthetic dbs only, never real Contacts.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/Sources/A"
python3 - "$T" <<'PY'
import sqlite3, sys
t = sys.argv[1]
for path, rows in ((f"{t}/AddressBook-v22.abcddb", [("Other", "Person", None, None)]),
                   (f"{t}/Sources/A/AddressBook-v22.abcddb", [("Joe", "Hwang", "Pastor", b"\x01\xff\xd8JPEGDATA"), ("Luke", "Ren", None, None)])):
    c = sqlite3.connect(path)
    c.execute("create table ZABCDRECORD (ZFIRSTNAME, ZLASTNAME, ZORGANIZATION, ZIMAGEDATA)")
    c.executemany("insert into ZABCDRECORD values (?,?,?,?)", rows); c.commit()
PY
CONTACTS_DIR="$T" "$ROOT/bin/contact-photo" "Hwang" "$T/out.jpg" >/dev/null
[ "$(head -c 2 "$T/out.jpg" | xxd -p)" = "ffd8" ] || { echo "FAIL: photo not stripped to the JPEG start"; exit 1; }
CONTACTS_DIR="$T" "$ROOT/bin/contact-photo" --list "Ren" | grep -q "no photo" || { echo "FAIL: --list missed the no-photo card"; exit 1; }
if CONTACTS_DIR="$T" "$ROOT/bin/contact-photo" "Luke" "$T/none.jpg" 2>/dev/null; then echo "FAIL: no-photo card exited 0"; exit 1; fi
[ ! -e "$T/none.jpg" ] || { echo "FAIL: wrote a file for a card with no photo"; exit 1; }
echo "contact_photo: all checks passed"
