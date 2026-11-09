#!/bin/bash
# brightspace submit must route a group dropbox to the caller's own group and
# an individual one to them, and files/content must write the bytes Brightspace
# returns. On 2026-10-22 a group upload had no path but a visible Chrome tab,
# and that tab flashed over Caleb mid-task.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail() { echo "  FAIL $1"; exit 1; }

printf 'PDFBYTES' > "$T/team.pdf"
python3 - "$T/fixture.json" <<'PY'
import base64, json, sys
fx = {
  "/lp/1.63/users/whoami": {"Identifier": "366125"},
  "/le/1.75/1/dropbox/folders/10": {"Name": "Team Doc", "GroupTypeId": 7, "Attachments": []},
  "/le/1.75/1/dropbox/folders/11": {"Name": "Solo Doc", "GroupTypeId": None,
                                     "Attachments": [{"FileId": 5, "FileName": "brief.pdf"}]},
  "/lp/1.43/1/groupcategories/7/groups/": [
      {"GroupId": 900, "Name": "Other Team", "Enrollments": [1, 2]},
      {"GroupId": 901, "Name": "Chip In", "Enrollments": [366125, 3]}],
  "/le/1.75/1/dropbox/folders/11/attachments/5": base64.b64encode(b"BRIEF").decode(),
  "/le/1.75/1/dropbox/folders/11/submissions/": [
      {"Submissions": [{"Id": 77, "SubmissionDate": "2026-10-22T07:21:42Z",
                        "Files": [{"FileId": 8, "FileName": "mine.pdf", "Size": 4}]}]}],
  "/le/1.75/1/dropbox/folders/11/submissions/77/files/8": base64.b64encode(b"MINE").decode(),
  "/le/1.75/1/dropbox/folders/12": {"Name": "Hostile", "GroupTypeId": None,
                                     "Attachments": [{"FileId": 6, "FileName": "../../escape.pdf"}]},
  "/le/1.75/1/dropbox/folders/12/attachments/6": base64.b64encode(b"X").decode(),
  "/le/1.75/1/dropbox/folders/12/submissions/": [],
  "/le/1.75/2/content/toc": {"Modules": [{"Title": "..", "Modules": [], "Topics": [
      {"TopicId": 9, "Title": "x", "TypeIdentifier": "File", "Url": "/content/x.pdf"}]}]},
  "/le/1.75/2/content/topics/9/file": base64.b64encode(b"Y").decode(),
  "/le/1.75/1/content/toc": {"Modules": [{"Title": "Week 1", "Modules": [], "Topics": [
      {"TopicId": 3, "Title": "Slides", "TypeIdentifier": "File", "Url": "/content/w1/Slides 1.pdf"},
      {"TopicId": 4, "Title": "Reading", "TypeIdentifier": "Link", "Url": "https://example.edu/r"}]}]},
  "/le/1.75/1/content/topics/3/file": base64.b64encode(b"SLIDES").decode(),
}
json.dump(fx, open(sys.argv[1], "w"))
PY
run() { BRIGHTSPACE_FIXTURE="$T/fixture.json" python3 "$ROOT/bin/brightspace" "$@"; }

out=$(run submit 1 10 "$T/team.pdf" --dry-run) || fail "group dry run exited nonzero"
echo "$out" | grep -q "group Chip In (901)" || fail "group dropbox didn't resolve the caller's own group: $out"
out=$(run submit 1 11 "$T/team.pdf" --dry-run) || fail "solo dry run exited nonzero"
echo "$out" | grep -q "for you" || fail "individual dropbox routed as a group: $out"
run submit 1 10 "$T/missing.pdf" --dry-run >/dev/null 2>&1 && fail "a missing file was accepted"

run files 1 11 --out "$T/dl" >/dev/null || fail "files exited nonzero"
[ "$(cat "$T/dl/brief.pdf")" = "BRIEF" ] || fail "dropbox attachment bytes wrong"
[ "$(cat "$T/dl/mine.pdf")" = "MINE" ] || fail "submitted file bytes wrong"

run content 1 --out "$T/c" >/dev/null || fail "content exited nonzero"
[ "$(cat "$T/c/Week 1/Slides 1.pdf")" = "SLIDES" ] || fail "content file not written under its module"
grep -q "https://example.edu/r" "$T/c/links.tsv" || fail "link topic not listed in links.tsv"

# Instructor-chosen names like "../../escape.pdf" or a ".." module must land
# inside the output folder, never beside it.
mkdir -p "$T/box"
run files 1 12 --out "$T/box/dl" >/dev/null 2>&1
run content 2 --out "$T/box/c" >/dev/null 2>&1
[ -e "$T/escape.pdf" ] || [ -e "$T/box/escape.pdf" ] && fail "a ../ file name wrote outside the output folder"
[ -n "$(find "$T/box" -maxdepth 1 -type f)" ] && fail "a .. module wrote outside the output folder"
[ "$(cat "$T/box/dl/.._.._escape.pdf" 2>/dev/null)" = "X" ] || fail "sanitised attachment not written inside the folder"

echo "  ok brightspace submit routing, files and content downloads"
