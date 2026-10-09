#!/bin/bash
# brightspace-sync: due must list each assignment once, and the file and
# transcript scans must pick the right items and write nothing without --apply.
#
# The duplicate case is real. A course calendar listed "Week 3 part 1 Problem
# Set" on 2026-09-17 and again on 2026-12-11, and the second copy would have
# become a reminder three months away for work already done.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail() { echo "  FAIL $1"; exit 1; }
BS="$ROOT/bin/brightspace-sync"

python3 - "$T/fixture.json" <<'PY'
import datetime as d, json, sys
now = d.datetime.now(d.timezone.utc)
iso = lambda days: (now + d.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
fx = {
    "/lp/1.63/enrollments/myenrollments/": {
        "Items": [{"OrgUnit": {"Id": 1, "Name": "20263_1 TEST-101: Intro"}, "Access": {"IsActive": True}}],
        "PagingInfo": {"HasMoreItems": False},
    },
    "/le/1.99/1/calendar/events/myEvents/": {"Objects": [
        {"Title": "HW 1", "StartDateTime": iso(1)},
        {"Title": "HW 1", "StartDateTime": iso(3)},
        {"Title": "Exam prep", "StartDateTime": iso(2)},
    ]},
    "/le/1.99/1/content/toc": {"Modules": [
        {"Title": "Notes", "Topics": [
            {"TopicId": 10, "Title": "Chapter 3 Notes", "TypeIdentifier": "File", "Url": "/content/enforced/1/ch3.pdf"},
            {"TopicId": 11, "Title": "Chapter 4 Notes", "TypeIdentifier": "File", "Url": "/content/enforced/1/ch4.pdf"},
            {"TopicId": 12, "Title": "Ch. 5 Lecture", "TypeIdentifier": "Link",
             "Url": "https://x.hosted.panopto.com/Panopto/Pages/Viewer.aspx?id=7e77dc45-43e1-41b1-aade-b4a000ef6309"},
        ]},
        {"Title": "MT #2 Practice", "Topics": [
            {"TopicId": 13, "Title": "Practice Test", "TypeIdentifier": "File", "Url": "/content/enforced/1/pt.pdf"},
        ]},
    ]},
}
json.dump(fx, open(sys.argv[1], "w"))
PY
export BRIGHTSPACE_FIXTURE="$T/fixture.json" BRIGHTSPACE_STATE="$T/state"

out=$(python3 "$BS" due --days 5 2>/dev/null) || fail "due exited non-zero"
[ "$(printf '%s\n' "$out" | grep -c 'HW 1')" = 1 ] || fail "HW 1 should be listed once: $out"
printf '%s\n' "$out" | grep -q 'TEST-101 .*Exam prep' || fail "Exam prep missing or course code wrong: $out"

out=$(python3 "$BS" files TEST-101 --from-chapter 4 --also 'MT ?#?2' --out "$T/dl" 2>/dev/null) || fail "files exited non-zero"
printf '%s\n' "$out" | grep -q 'Chapter 4 Notes.pdf' || fail "Chapter 4 should be picked: $out"
printf '%s\n' "$out" | grep -q 'Practice Test.pdf' || fail "MT #2 module should be kept by --also: $out"
printf '%s\n' "$out" | grep -q 'Chapter 3' && fail "Chapter 3 should be skipped: $out"
[ ! -e "$T/dl" ] || fail "a scan without --apply wrote files"

out=$(python3 "$BS" transcripts TEST-101 --from-chapter 4 --out "$T/dl" 2>/dev/null) || fail "transcripts exited non-zero"
printf '%s\n' "$out" | grep -q 'Ch. 5 Lecture.txt' || fail "Ch. 5 recording should be listed: $out"
[ ! -e "$T/dl" ] || fail "a transcript scan without --apply wrote files"

python3 "$BS" files NOPE-999 >/dev/null 2>&1 && fail "an unknown course should exit non-zero"
echo "  ok"
