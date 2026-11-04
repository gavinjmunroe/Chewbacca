#!/bin/bash
# brightspace takes names, not ids, on every command, and post proves itself.
#
# On 2026-11-03 a WRIT 150 discussion post spent most of its time finding
# three ids: the ou wasn't in the ledger and the forum/topic came from a
# separate `discuss` listing. The API calls took 412ms. So a course name and a
# topic or dropbox name resolve from a cache with no call, a miss rereads once,
# two matches stop with both listed, and a post is read back before it's
# reported.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail() { echo "  FAIL $1"; exit 1; }

mkdir -p "$T/courses"
printf 'code: WRIT 150\ntitle: "Writing"\nitems: []\n' > "$T/courses/writ-150.yml"
printf 'code: BISC 101Lxg\norg_unit_id: 1\nitems: []\n' > "$T/courses/bisc-101.yml"
printf 'code: ACAD 185\nitems: []\n' > "$T/courses/acad-185.yml"
printf 'code: ACAD 324g\nitems: []\n' > "$T/courses/acad-324g.yml"
echo "My three topic ideas." > "$T/body.txt"

python3 - "$T/fixture.json" <<'PY'
import json, sys
enr = "/lp/1.43/enrollments/myenrollments/?orgUnitTypeId=3&pageSize=100"
org = lambda i, name: {"OrgUnit": {"Id": i, "Code": "x", "Name": name}}
fx = {enr: {"Items": [org(302009, "20263_64805 WRIT-150: Writing"),
                      org(302776, "20263_13102 BISC-101: Cells"), org(302780, "20263_13105 BISC-101: Cells"),
                      org(298850, "20263_10212 ACAD-185: Analytics"), org(299120, "20263_10300 ACAD-324: Design")]}}
for ou in (302776, 302780, 298850, 299120):
    fx[f"/le/1.75/{ou}/discussions/forums/"] = []
    fx[f"/le/1.75/{ou}/dropbox/folders/"] = []
fx["/le/1.75/302780/dropbox/folders/"] = [{"Id": 77, "Name": "Presentation Topics"}]
fx["/le/1.75/302780/dropbox/folders/77"] = {"Id": 77, "Name": "Presentation Topics", "GroupTypeId": None}
fx["/le/1.75/302009/discussions/forums/"] = [{"ForumId": 124816, "Name": "Writing Project 3 Ancillary Assignments"}]
fx["/le/1.75/302009/discussions/forums/124816/topics/"] = [
    {"TopicId": 344550, "Name": "Topic Ideas for WP3"},
    {"TopicId": 339376, "Name": "Outline and Potential Sources for WP3"},
    {"TopicId": 339378, "Name": "WP3 Rough Draft (and Peer Review Response)"},
    {"TopicId": 339379, "Name": "WP3 Rough Draft"}]
fx["/le/1.75/302009/dropbox/folders/"] = []
base = "/le/1.75/302009/discussions/forums/124816/topics/344550/posts/"
fx["POST /d2l/api" + base] = {"PostId": 555}
fx[base + "555"] = {"PostId": 555, "Subject": "Ideas", "PostingUserDisplayName": "Test Student",
                    "DatePosted": "2026-11-04T05:13:58Z", "Message": {"Text": "My three topic ideas.\n"}}
json.dump(fx, open(sys.argv[1], "w"))
PY
run() { BRIGHTSPACE_FIXTURE="$T/fixture.json" BRIGHTSPACE_MAP="$T/map.json" COURSEWORK_DIR="$T" \
          python3 "$ROOT/bin/brightspace" "$@"; }

# A miss on an empty cache reads the course once and saves it.
out=$(run post WRIT "Topic Ideas for WP3" --subject x --body-file "$T/body.txt" --dry-run) || fail "dry run failed: $out"
echo "$out" | grep -q "(302009/124816/344550)" || fail "topic not resolved: $out"
[ -s "$T/map.json" ] || fail "cache not saved"

# A hit makes no call at all: with the discussion reads gone from the
# fixture, a lookup that reached the network would die on KeyError.
python3 - "$T/fixture.json" "$T/offline.json" <<'PY'
import json, sys
fx = json.load(open(sys.argv[1]))
json.dump({k: v for k, v in fx.items() if "discussions/forums/" not in k or "/posts/" in k}, open(sys.argv[2], "w"))
PY
for course in WRIT writ-150 "writ 150" 302009; do
  out=$(BRIGHTSPACE_FIXTURE="$T/offline.json" BRIGHTSPACE_MAP="$T/map.json" COURSEWORK_DIR="$T" \
        python3 "$ROOT/bin/brightspace" post "$course" topic ideas wp3 --subject x --body-file "$T/body.txt" --dry-run) \
    || fail "cached lookup for $course went to the network: $out"
  echo "$out" | grep -q "(302009/124816/344550)" || fail "$course resolved wrong: $out"
done

# Ambiguity stops with both listed, never a guess.
out=$(run post WRIT WP3 --subject x --body-file "$T/body.txt" --dry-run 2>&1) && fail "ambiguous topic accepted"
echo "$out" | grep -q "344550" && echo "$out" | grep -q "339376" || fail "ambiguous topic didn't list both: $out"
out=$(run classlist ACAD 2>&1) && fail "ambiguous course accepted"
echo "$out" | grep -q "ACAD 185" && echo "$out" | grep -q "ACAD 324" || fail "ambiguous course didn't list both: $out"
# ...but an exact name wins over a longer one holding the same words.
out=$(run post WRIT "WP3 Rough Draft" --subject x --body-file "$T/body.txt" --dry-run) || fail "exact name refused: $out"
echo "$out" | grep -q "/339379)" || fail "exact name didn't win: $out"
out=$(run post WRIT "Nope Topic" --subject x --body-file "$T/body.txt" --dry-run 2>&1) && fail "unknown topic accepted"
echo "$out" | grep -q "Topic Ideas for WP3" || fail "a miss should list the course's topics: $out"

# Ids still work, so old commands keep running.
out=$(run post 302009 124816 344550 --subject x --body-file "$T/body.txt" --dry-run) || fail "ids refused: $out"
echo "$out" | grep -q "(302009/124816/344550)" || fail "ids changed: $out"

# A dropbox resolves by name across a course's two org units (BISC lab).
out=$(run submit BISC "presentation topics" "$T/body.txt" --dry-run) || fail "dropbox by name failed: $out"
echo "$out" | grep -q "Presentation Topics: 1 file" || fail "dropbox not resolved: $out"

# post reads the post back and prints it; a read-back that differs fails.
out=$(run post WRIT "Topic Ideas for WP3" --subject Ideas --body-file "$T/body.txt") || fail "post failed: $out"
echo "$out" | grep -q "posted 555 by Test Student" || fail "post not read back: $out"
echo "$out" | grep -q "My three topic ideas." || fail "read-back text not printed: $out"
echo "Something else entirely." > "$T/other.txt"
out=$(run post WRIT "Topic Ideas for WP3" --subject Ideas --body-file "$T/other.txt" 2>&1) && fail "a mismatched read-back passed"
echo "$out" | grep -q "Do NOT post again" || fail "mismatch not explained: $out"

# map writes each course's org_unit_id into its ledger yml, once.
run map >/dev/null || fail "map failed"
grep -qx "org_unit_id: 302009" "$T/courses/writ-150.yml" || fail "WRIT ledger has no org_unit_id: $(cat "$T/courses/writ-150.yml")"
grep -qx "org_unit_id: \[302776, 302780\]" "$T/courses/bisc-101.yml" || fail "BISC ledger not updated: $(cat "$T/courses/bisc-101.yml")"
[ "$(grep -c org_unit_id "$T/courses/bisc-101.yml")" = 1 ] || fail "org_unit_id duplicated"
before=$(cat "$T/courses/writ-150.yml"); run map >/dev/null
[ "$before" = "$(cat "$T/courses/writ-150.yml")" ] || fail "a second map rewrote the ledger"
echo "  ok brightspace resolves names from cache, stops on ambiguity, reads posts back"
