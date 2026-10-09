#!/bin/bash
# chewbacca google must read a Doc by URL as text, read EVERY tab of a Sheet
# (Drive's CSV export only gives the first), refuse a file that isn't a Doc,
# Sheet or Slides, and export inside a private dir (gws refuses -o outside its
# cwd, and a bare export once dropped download.txt into ~). gws is faked.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
no() { echo "FAIL: $*"; fail=1; }

cat > "$T/gws" <<'SH'
#!/usr/bin/env python3
import json, os, sys
a = sys.argv[1:]
p = json.loads(a[a.index("--params") + 1]) if "--params" in a else {}
cmd = " ".join(x for x in a[:3] if not x.startswith("-"))
if cmd == "drive files get":
    kinds = {"DOCID12345678901234567": "application/vnd.google-apps.document",
             "SHEETID123456789012345": "application/vnd.google-apps.spreadsheet",
             "PDFID12345678901234567": "application/pdf"}
    print(json.dumps({"name": "Thing " + p["fileId"][:3], "mimeType": kinds[p["fileId"]]}))
elif cmd == "drive files export":
    out = a[a.index("-o") + 1]
    if os.path.isabs(out) or ".." in out:
        print(json.dumps({"error": {"message": "outside the current directory"}})); sys.exit(1)
    open(out, "w").write("Hello from the doc\n"); print(json.dumps({"status": "success"}))
elif cmd == "sheets spreadsheets get":
    print(json.dumps({"sheets": [{"properties": {"title": "Tab One"}}, {"properties": {"title": "Tab Two"}}]}))
elif a[:4] == ["sheets", "spreadsheets", "values", "get"]:
    rows = {"'Tab One'": [["a", "b"]], "'Tab Two'": [["c", "has,comma"]]}[p["range"]]
    print(json.dumps({"values": rows}))
else:
    print(json.dumps({"error": {"message": "unexpected " + " ".join(a)}})); sys.exit(1)
SH
chmod +x "$T/gws"
export CHEWBACCA_GWS="$T/gws"

out="$(cd "$T" && bash "$ROOT/bin/chewbacca" google read "https://docs.google.com/document/d/DOCID12345678901234567/edit" 2>&1)"
printf '%s' "$out" | grep -q "Hello from the doc" || no "a Doc URL did not read as text: $out"
[ -e "$T/out.txt" ] || [ -e "$HOME/download.txt" ] && no "an export landed outside a private temp dir"

out="$(bash "$ROOT/bin/chewbacca" google read SHEETID123456789012345 2>&1)"
printf '%s' "$out" | grep -q "## Tab Two" || no "only the first tab of a Sheet was read: $out"
printf '%s' "$out" | grep -q 'c,"has,comma"' || no "a cell with a comma was not quoted"

bash "$ROOT/bin/chewbacca" google read PDFID12345678901234567 >/dev/null 2>&1 && no "a non-Doc file was read instead of refused"

[ "$fail" -eq 0 ] && echo "chewbacca google: ok"
exit "$fail"
