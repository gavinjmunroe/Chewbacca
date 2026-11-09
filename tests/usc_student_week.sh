#!/bin/bash
# A made-up USC student's week, after lockin, on a fresh Mac: the four places
# the 2026-10-13 walk got stuck.
#
#   Welcome: Brightspace cookies said "student" and the goal question offered
#     texts and family, appointments, letters and look-ups, nothing about class.
#   Monday: lockin pulled the slides and syllabi, and nothing on a fresh Mac
#     read them. `chewbacca docs` wants genoffice, stock python3 has no PDF
#     library, there's no pdftotext, and six real BISC decks were .ppt.
#   Mid-week: a missed class and a team list lived in announcements, readable
#     only one course at a time through the api engine.
#   Friday: `coursework grade` said "nothing graded yet" over a 71 on a
#     midterm, because the seeded ledger has no scores and nothing read them.
#
# No network, no real Chrome, no USC system: Brightspace is a fixture and the
# student is invented.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0; ok() { echo "  ok   $1"; }; no() { echo "  FAIL $1"; fail=1; }
PY=/usr/bin/python3
export HOME="$T/home" CHEWBACCA_CHROME_DIR="$T/chrome" BRIGHTSPACE_STATE="$T/state" BRIGHTSPACE_DELAY=0,0 \
  CHEWBACCA_NO_OPEN=1 COURSEWORK_DIR="$T/home/coursework"
unset CHEWIE_CHROME_PROFILE CHEWBACCA_ROOT
mkdir -p "$HOME" "$T/chrome"

# ── Welcome: a Mac with no Brightspace cookie, then one with ──────────────────
goals() { $PY "$ROOT/bin/chewbacca-welcome" questions | $PY -c '
import json, sys
d = json.load(sys.stdin)
g = [q for s in d["screens"] for q in s if q["key"] == "goals"][0]
assert len(g["options"]) <= 4, "the question tool shows four options at most"
print(" ".join(o["value"] for o in g["options"]))'; }
plain="$(goals)"
mkdir -p "$T/chrome/Profile 1"
$PY - "$T/chrome/Profile 1/Cookies" <<'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute("create table cookies(host_key text, name text, encrypted_value blob, last_access_utc int)")
c.execute("insert into cookies values ('brightspace.usc.edu', 'd2lSessionVal', x'00', 1)"); c.commit()
PY
student="$(goals)"
case " $student " in *" classes "*) ok "a detected student is offered help with classes ($student)" ;;
  *) no "a detected student's goal options have nothing about class: $student" ;; esac
case " $plain " in *" classes "*) no "a Mac with no school was offered classes: $plain" ;;
  *) ok "a Mac with no school keeps the general goals ($plain)" ;; esac

# ── A Brightspace with two current courses (one with a lab) and last spring ──
$PY - "$T/fx.json" <<'PY'
import datetime as d, json, sys
now = d.datetime.now(d.timezone.utc)
iso = lambda days: (now + d.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
enr = lambda i, n: {"OrgUnit": {"Id": i, "Name": n, "Code": n.split()[0]}, "Access": {"IsActive": True}}
E = {"Items": [enr(702, "20263_13150 BISC-120: General Biology"), enr(703, "20263_13152 BISC-120: General Biology"),
               enr(705, "20263_52300 PSYC-100: Introduction to Psychology"), enr(600, "20253_99999 GESM-120: Last Spring")],
     "PagingInfo": {"HasMoreItems": False}}
g = lambda n, a, b: {"GradeObjectName": n, "PointsNumerator": a, "PointsDenominator": b, "DisplayedGrade": f"{a} / {b}"}
news = lambda t, txt, days, pub=True: {"Title": t, "Body": {"Text": txt, "Html": ""}, "StartDate": iso(days), "IsPublished": pub}
toc = lambda tid, title, url: {"Modules": [{"Title": "Course Info", "Topics": [
    {"TopicId": tid, "Title": title, "TypeIdentifier": "File", "Url": url}], "Modules": []}]}
def pdf(line):
    # A real one-page PDF with an xref table, which PDFKit insists on.
    body = f"BT /F1 11 Tf 50 700 Td ({line}) Tj ET"
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            f"<< /Length {len(body)} >>\nstream\n{body}\nendstream", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offs = "%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offs.append(len(out)); out += f"{i} 0 obj\n{o}\nendobj\n"
    x = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n" + "".join(f"{o:010d} 00000 n \n" for o in offs)
    return out + f"trailer << /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{x}\n%%EOF\n"
syllabus = pdf("Office hours Wed 1-2pm ZHS 260")
fx = {
  "/lp/1.63/enrollments/myenrollments/": E,
  "/lp/1.43/enrollments/myenrollments/?orgUnitTypeId=3&pageSize=100": E,
  "/le/1.99/702/grades/values/myGradeValues/": [g("Midterm 1", 71, 100), g("Weekly Quiz 5", 6, 10)],
  "/le/1.99/703/grades/values/myGradeValues/": [g("Lab 5 Report", 18, 20)],
  "/le/1.99/705/grades/values/myGradeValues/": [],
  "/le/1.99/600/grades/values/myGradeValues/": [g("Last spring essay", 1, 100)],
  "/le/1.99/702/news/": [news("Midterm 2 room", "Midterm 2 is in SGM 123.", -2), news("Week 1 welcome", "Hi all", -40)],
  "/le/1.99/703/news/": [news("Draft lab note", "not published", -1, False)],
  "/le/1.99/705/news/": [news("Group assignments posted", "Team 7: Jordan Rivera, Sam Okafor.", -4)],
  "/le/1.99/702/calendar/events/myEvents/": {"Objects": [{"Title": "Midterm 2", "StartDateTime": iso(8)}]},
  "/le/1.99/703/calendar/events/myEvents/": {"Objects": []},
  "/le/1.99/705/calendar/events/myEvents/": {"Objects": []},
  "/le/1.99/702/content/toc": toc(8101, "BISC 120 Syllabus", "/c/bisc.pdf"),
  "/le/1.99/703/content/toc": {"Modules": []},
  "/le/1.99/705/content/toc": toc(8401, "Unit 3 notes", "/c/notes.txt"),
  "/le/1.99/702/content/topics/8101/file": syllabus,
  "/le/1.99/705/content/topics/8401/file": "Memory: encoding, storage, retrieval\n",
}
json.dump(fx, open(sys.argv[1], "w"))
PY
export BRIGHTSPACE_FIXTURE="$T/fx.json"

# ── Friday: grades from every current course in one call ─────────────────────
gr="$($PY "$ROOT/bin/brightspace" grades --json 2>&1)"
printf '%s' "$gr" | $PY -c '
import json, sys
d = {c["course"]: c["grades"] for c in json.load(sys.stdin)}
assert set(d) == {"BISC 120", "PSYC 100"}, d.keys()
names = {g["name"]: g["percent"] for g in d["BISC 120"]}
assert names == {"Midterm 1": 71, "Weekly Quiz 5": 60, "Lab 5 Report": 90}, names
assert d["PSYC 100"] == []' \
  && ok "brightspace grades reads every current course, lecture and lab together, last term left out" \
  || no "brightspace grades: $gr"
$PY "$ROOT/bin/brightspace" grades | grep -q "nothing released yet" \
  && ok "a course with no released grades says so" || no "grades text has no empty-course line"

# ── Mid-week: what did I miss ────────────────────────────────────────────────
nw="$($PY "$ROOT/bin/brightspace" news --days 7 2>&1)"
for want in "Midterm 2 room" "SGM 123" "Group assignments posted" "Team 7"; do
  printf '%s' "$nw" | grep -qF "$want" || no "brightspace news is missing \"$want\": $nw"
done
printf '%s' "$nw" | grep -q "Week 1 welcome" && no "news older than the window was shown"
printf '%s' "$nw" | grep -q "Draft lab note" && no "an unpublished announcement was shown"
[ "$(printf '%s\n' "$nw" | grep -n 'Midterm 2 room' | cut -d: -f1)" -lt "$(printf '%s\n' "$nw" | grep -n 'Group assignments' | cut -d: -f1)" ] 2>/dev/null \
  && ok "brightspace news lists every course's announcements in the window, newest first" \
  || no "news order or content wrong: $nw"

# ── Monday: lockin reads the syllabi into the ledger, then every file reads ──
applied="$($PY "$ROOT/bin/chewbacca-usc" lockin --apply 2>&1)"
oh="$(node "$ROOT/bin/coursework" show bisc --json 2>&1 | $PY -c 'import json,sys; i=json.load(sys.stdin)[0]["instructor"]; print(i["office_hours"], "|", i["office_hours_source"])' 2>&1)"
[ "$oh" = "Wed 1-2pm ZHS 260 | BISC 120 Syllabus.pdf, page 1" ] \
  && ok "lockin --apply reads the syllabus it pulled into the ledger, with the page" || no "lockin syllabus fill: $oh / $applied"

# ── Friday: released scores land on the ledger's grading parts ───────────────
cat >> "$COURSEWORK_DIR/courses/bisc-120.yml" <<'Y'
grading_model: weighted
grading:
  - { name: "Midterm I", points: 100, source: "syllabus p5" }
  - { name: "Final Exam", points: 100, source: "syllabus p5" }
  - { name: "Weekly Quizzes", points: 20, source: "syllabus p5" }
Y
sc="$($PY "$ROOT/bin/chewbacca-usc" grades --apply 2>&1)"
gr="$(node "$ROOT/bin/coursework" grade bisc 2>&1)"
printf '%s' "$gr" | grep -q "standing      71.0%" && printf '%s' "$sc" | grep -q "no single grading part for: Weekly Quiz 5, Lab 5 Report" \
  && grep -q 'score: 71, max: 100, score_source: "Brightspace grades (Midterm 1)' "$COURSEWORK_DIR/courses/bisc-120.yml" \
  && ok "coursework grade adds up the 71 on Midterm 1, and one quiz of many isn't guessed into a part" \
  || no "grades into ledger: $sc / $gr"
before="$(cksum < "$COURSEWORK_DIR/courses/bisc-120.yml")"
$PY "$ROOT/bin/chewbacca-usc" grades --apply > /dev/null 2>&1
[ "$before" = "$(cksum < "$COURSEWORK_DIR/courses/bisc-120.yml")" ] && ok "a second grades --apply writes nothing" || no "grades rerun changed the ledger"

S="$COURSEWORK_DIR/slides"
mkdir -p "$S/BISC-120/Lectures" "$S/PSYC-100/Readings"
$PY - "$S" <<'PY'
import struct, sys, zipfile
s = sys.argv[1]
z = zipfile.ZipFile(f"{s}/BISC-120/Lectures/Lecture 14 Photosynthesis.pptx", "w")
for i, words in ((2, "C4 &amp; CAM plants"), (1, "Calvin cycle fixes CO2 with rubisco")):
    z.writestr(f"ppt/slides/slide{i}.xml", '<p:sld xmlns:p="p" xmlns:a="a"><p:txBody><a:p><a:pPr lvl="1"/>'
               f'<a:r><a:t>{words}</a:t></a:r></a:p></p:txBody></p:sld>')
z.close()
z = zipfile.ZipFile(f"{s}/PSYC-100/Readings/Group plan.docx", "w")
z.writestr("word/document.xml", '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Sam does the survey</w:t></w:r></w:p></w:body></w:document>')
z.close()
def atom(kind, data):
    return struct.pack("<HHI", 0, kind, len(data)) + data
ppt = b"\xd0\xcf\x11\xe0" + b"\x00" * 60 + atom(0x0FA0, "Diffusion across membranes".encode("utf-16-le")) \
      + atom(0x0FA8, b"Click to edit Master title style") + atom(0x0FA8, b"Osmosis moves water") + b"\x00" * 40
open(f"{s}/BISC-120/Lectures/Lecture 10 Diffusion.ppt", "wb").write(ppt)
PY
rd="$($PY "$ROOT/bin/chewbacca-usc" read bisc120 2>&1)"; before=$fail
for want in "--- page 1" "Office hours Wed 1-2pm ZHS 260" "--- slide 1" "Calvin cycle fixes CO2 with rubisco" \
            "C4 & CAM plants" "Diffusion across membranes" "Osmosis moves water"; do
  printf '%s' "$rd" | grep -qF -- "$want" || no "usc read bisc120 is missing \"$want\""
done
printf '%s' "$rd" | grep -q "Click to edit Master" && no "a .ppt master placeholder leaked into the text"
s1="$(printf '%s\n' "$rd" | grep -n 'Calvin cycle' | cut -d: -f1)"; s2="$(printf '%s\n' "$rd" | grep -n 'C4 & CAM' | cut -d: -f1)"
[ "$fail" = "$before" ] && [ -n "$s1" ] && [ -n "$s2" ] && [ "$s1" -lt "$s2" ] \
  && ok "PDF pages, .pptx slides in slide order and an old .ppt all read on a stock Mac" || no "usc read: $rd"
fd="$($PY "$ROOT/bin/chewbacca-usc" read --find "sam survey" 2>&1)"
[ "$fd" = "PSYC-100/Readings/Group plan.docx, text: Sam does the survey" ] \
  && ok "--find searches every course and cites the file each line came from" || no "--find: $fd"
$PY "$ROOT/bin/chewbacca-usc" read ECON > "$T/econ" 2>&1 && no "an unknown course read as success"
grep -q "have: BISC-120, PSYC-100" "$T/econ" && ok "an unknown course names the folders there are" || no "unknown course: $(cat "$T/econ")"

exit "$fail"
