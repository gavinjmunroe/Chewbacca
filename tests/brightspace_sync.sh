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
        "Items": [
            {"OrgUnit": {"Id": 1, "Name": "20263_1 TEST-101: Intro"}, "Access": {"IsActive": True}},
            # A past term stays enrolled and active, the way a 20253 seminar
            # still showed in Fall 2026, and must not reach due or the picker.
            {"OrgUnit": {"Id": 2, "Name": "20253_9 OLD-100: Past"}, "Access": {"IsActive": True}},
            # A lecture and its lab share one code.
            {"OrgUnit": {"Id": 3, "Name": "20263_2 LAB-200: Bio"}, "Access": {"IsActive": True}},
            {"OrgUnit": {"Id": 4, "Name": "20263_3 LAB-200: Bio"}, "Access": {"IsActive": True}},
        ],
        "PagingInfo": {"HasMoreItems": False},
    },
    "/le/1.99/1/calendar/events/myEvents/": {"Objects": [
        {"Title": "HW 1", "StartDateTime": iso(1)},
        {"Title": "HW 1", "StartDateTime": iso(3)},
        {"Title": "Exam prep", "StartDateTime": iso(2)},
    ]},
    "/le/1.99/2/calendar/events/myEvents/": {"Objects": [{"Title": "Old essay", "StartDateTime": iso(1)}]},
    "/le/1.99/3/calendar/events/myEvents/": {"Objects": []},
    "/le/1.99/4/calendar/events/myEvents/": {"Objects": []},
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
due_out="$out"
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

printf '%s\n' "$due_out" | grep -q 'Old essay' && fail "a past term's course reached due"
courses=$(python3 "$BS" courses 2>/dev/null) || fail "courses exited non-zero"
printf '%s\n' "$courses" | grep -q 'OLD-100' && fail "courses listed a past term by default: $courses"
python3 "$BS" courses --all-terms 2>/dev/null | grep -q 'OLD-100' || fail "courses --all-terms should list past terms"
err=$(python3 "$BS" links LAB-200 2>&1 >/dev/null) && fail "a code shared by lecture and lab should not pick one silently"
printf '%s\n' "$err" | grep -q '(3)' && printf '%s\n' "$err" | grep -q '(4)' || fail "the ambiguity error should name both ids: $err"

# `chewbacca api login brightspace` saves the session as brightspace.json, not
# under the host name; the tool must find it there.
mkdir -p "$T/home/.api-anything/sessions"
echo '{"cookies":[{"name":"d2lSessionVal","value":"fake-session","domain":"brightspace.usc.edu"}]}' \
  > "$T/home/.api-anything/sessions/brightspace.json"
HOME="$T/home" python3 - "$BS" <<'PY' || fail "the chewbacca api session name was not found"
import importlib.machinery, importlib.util, os, sys
os.environ.pop("BRIGHTSPACE_SESSION", None)
loader = importlib.machinery.SourceFileLoader("bs", sys.argv[1])
spec = importlib.util.spec_from_loader("bs", loader); m = importlib.util.module_from_spec(spec); loader.exec_module(m)
assert "d2lSessionVal=fake-session" in m.cookie_header(), m.cookie_header()
PY

# decks: ACAD 185 posts no Content files. Every lecture deck is a Google Slides
# link in the master sheet, so the Content walk found nothing after 10/16 and
# A20 was built on 2026-11-02 without the W10S20 lecture that assigned it.
GX="$T/gx"; mkdir -p "$GX" "$T/cw/courses"
python3 - "$GX" <<'PY2'
import openpyxl, sys
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Schedule and Deliverables"
ws.append(["Session ID", "Date", "Session Topic", "Course Assignment(s) Given"])
rows = [("W10S20", "Storytelling for Product Leaders", "presentation/d/DECKaaaaaaaaaaaaaaaaaaaa1"),
        ("W11S21", "Advertising in the Age of AI", "presentation/d/DECKbbbbbbbbbbbbbbbbbbbb2"),
        ("W11S22", "Private Deck", "presentation/d/DECKcccccccccccccccccccc3"),
        ("W12S23", "Same deck linked twice", "presentation/d/DECKaaaaaaaaaaaaaaaaaaaa1")]
for i, (sid, title, path) in enumerate(rows, start=2):
    ws.cell(i, 1, sid); c = ws.cell(i, 3, title); c.hyperlink = f"https://docs.google.com/{path}/edit"
ws.cell(2, 4, "A20 Hero's Journey, A22 Landing Page Live")
ws.cell(5, 4, "A20 v2 feedback")
wb.save(f"{sys.argv[1]}/SHEETxxxxxxxxxxxxxxxxxxxxxxx.xlsx")
for gid in ("DECKaaaaaaaaaaaaaaaaaaaa1", "DECKbbbbbbbbbbbbbbbbbbbb2"):
    open(f"{sys.argv[1]}/{gid}.pdf", "wb").write(b"%PDF-1.4\n%%EOF\n")
open(f"{sys.argv[1]}/DECKcccccccccccccccccccc3.pdf", "wb").write(b"<html>Sign in</html>")
PY2
echo 'master_sheet: "SHEETxxxxxxxxxxxxxxxxxxxxxxx"' > "$T/cw/courses/test-101.yml"
export GOOGLE_EXPORT_FIXTURE="$GX" COURSEWORK_DIR="$T/cw"
out=$(python3 "$BS" decks TEST-101 --out "$T/sl" 2>&1) || fail "decks scan exited non-zero: $out"
printf '%s\n' "$out" | grep -q 'would save  W10S20 Storytelling for Product Leaders.pdf' || fail "decks should name the session and title: $out"
[ "$(printf '%s\n' "$out" | grep -c 'Storytelling')" = 1 ] || fail "a deck linked twice should be listed once: $out"
[ ! -e "$T/sl" ] || fail "a decks scan without --apply wrote files"
mkdir -p "$T/sl/TEST-101"; : > "$T/sl/TEST-101/W11S21 Advertising in the Age of AI.txt"
out=$(python3 "$BS" decks TEST-101 --out "$T/sl" --apply 2>&1) || fail "decks --apply exited non-zero: $out"
[ -s "$T/sl/TEST-101/W10S20 Storytelling for Product Leaders.pdf" ] || fail "W10S20 deck not saved: $out"
[ -s "$T/sl/TEST-101/master.xlsx" ] || fail "the master sheet copy was not saved"
python3 - "$T/sl/TEST-101/assigned-in.json" <<'PY2' || fail "assigned-in.json should map A20 and A22 to W10S20, first session wins"
import json, sys
g = json.load(open(sys.argv[1]))
assert g["A20"] == {"session": "W10S20", "deck": "W10S20 Storytelling for Product Leaders.pdf"}, g
assert g["A22"]["session"] == "W10S20", g
PY2
printf '%s\n' "$out" | grep -q 'saved.*W11S21' && fail "a deck already on disk was pulled again: $out"
printf '%s\n' "$out" | grep -q 'not shared  W11S22 Private Deck' || fail "a sign-in page should be reported: $out"
[ -e "$T/sl/TEST-101/W11S22 Private Deck.pdf" ] && fail "a sign-in page was saved as a deck"
out=$(python3 "$BS" decks all --out "$T/sl" 2>&1) || fail "decks all exited non-zero: $out"
printf '%s\n' "$out" | grep -q 'saved' && fail "decks all pulled a deck already on disk: $out"
printf '%s\n' "$out" | grep -q 'linked decks' || fail "decks all did not reach the TEST-101 ledger: $out"
python3 "$BS" decks NOLEDGER-1 --out "$T/sl" >/dev/null 2>&1 && fail "decks with no master_sheet should exit non-zero"

# refresh pieces: ledger ids ("Project 4b" is P4b), the deck index, and a
# master sheet found from an announcement (where ACAD 185 links its own).
mkdir -p "$T/cw2/courses" "$T/sl2/ACAD-324" "$T/sl2/ACAD-185"
printf '  - { name: "Project 4b Ideation and Selection", due: 2026-11-02 }\n  - { name: "Quiz 2: Design" }\n' > "$T/cw2/courses/acad-324g.yml"
printf 'brightspace_org: "x"\n  - { name: "A20 Hero'"'"'s Journey v1" }\n' > "$T/cw2/courses/acad-185.yml"
printf 'P4b due Monday. Bring three concepts.\n' > "$T/sl2/ACAD-324/PoD_wk10.2_Select.txt"
printf 'Nothing to see\n' > "$T/sl2/ACAD-324/PoD_wk1.txt"
COURSEWORK_DIR="$T/cw2" GOOGLE_EXPORT_FIXTURE="$GX" python3 - "$BS" "$T" <<'PY2' || fail "refresh pieces"
import importlib.machinery, importlib.util, json, sys, types
loader = importlib.machinery.SourceFileLoader("bs", sys.argv[1])
spec = importlib.util.spec_from_loader("bs", loader); m = importlib.util.module_from_spec(spec); loader.exec_module(m)
T = sys.argv[2]
assert m.ledger_ids("ACAD-324") == {"P4b"}, m.ledger_ids("ACAD-324")
idx = m.index_course("ACAD-324", f"{T}/sl2")
assert [h["deck"] for h in idx["P4b"]] == ["PoD_wk10.2_Select.txt"], idx
assert json.load(open(f"{T}/sl2/ACAD-324/deck-index.json")) == idx
class News:
    def json(self, path):
        assert path == "/le/1.99/7/news/", path
        return [{"Body": {"Html": '<a href="https://docs.google.com/spreadsheets/d/SHEETxxxxxxxxxxxxxxxxxxxxxxx/edit">Master Spreadsheet</a>'}}]
c = {"id": 7, "code": "ACAD-185"}
assert m.find_master_sheet(News(), c, types.SimpleNamespace(apply=False)) == "SHEETxxxxxxxxxxxxxxxxxxxxxxx"
assert "master_sheet" not in open(f"{T}/cw2/courses/acad-185.yml").read(), "a scan wrote the ledger"
m.find_master_sheet(News(), c, types.SimpleNamespace(apply=True))
assert m.master_sheet("ACAD-185") == "SHEETxxxxxxxxxxxxxxxxxxxxxxx"
assert m.find_master_sheet(News(), c, types.SimpleNamespace(apply=True)) is None, "a second run should leave a set sheet alone"
PY2
unset GOOGLE_EXPORT_FIXTURE COURSEWORK_DIR
echo "  ok"
