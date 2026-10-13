#!/bin/bash
# `chewbacca usc syllabus` fills a seeded ledger from the syllabi lockin
# pulled, for any student. On the 2026-10-13 USC week walk the seeded files
# had no class times, office hours, attendance budget or grading, so "can I
# skip Wednesday" and "where's my grade" had nothing to answer from.
#
# Four made-up courses, one per format a USC syllabus arrives in (PDF, DOCX,
# PPTX, a Brightspace HTML page), shaped like the real ones read that day:
# a header block, a two-column layout that prints every line twice, a lab
# section list, a lab manager's address, a percent column that adds to 105,
# a labor-based contract, a scanned PDF, and an AI policy paragraph that
# must never reach the ledger.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0; ok() { echo "  ok   $1"; }; no() { echo "  FAIL $1"; fail=1; }
PY=/usr/bin/python3
export HOME="$T/home" COURSEWORK_DIR="$T/home/coursework"
L="$COURSEWORK_DIR"; S="$L/slides"
mkdir -p "$L/courses"
seed() { printf 'code: "%s"\ntitle: "%s"\nterm: "Fall 2026"\ndeliverables: []\n' "$1" "$2" > "$L/courses/$3.yml"; }
seed "CHEM 105a" "General Chemistry" chem-105a
seed "PSYC 100" "Introduction to Psychology" psyc-100
seed "WRIT 150" "Writing and Critical Reasoning" writ-150
seed "ARTS 101" "Drawing" arts-101
# A field the student already wrote: never overwritten, a disagreement reported.
cat >> "$L/courses/psyc-100.yml" <<'Y'
absences:
  allowed: 4
  used: 1
Y

$PY - "$S" <<'PY'
import sys, zipfile
from pathlib import Path
s = Path(sys.argv[1])

def pdf(pages):
    """A real multi-page PDF with an xref table, which PDFKit insists on."""
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", None, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    kids = []
    for lines in pages:
        esc = [l.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") for l in lines]
        body = "BT /F1 10 Tf 14 TL 50 740 Td " + " ".join(f"({l}) Tj T*" for l in esc) + " ET"
        objs.append(f"<< /Length {len(body)} >>\nstream\n{body}\nendstream")
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {len(objs)} 0 R "
                    "/Resources << /Font << /F1 3 0 R >> >> >>")
        kids.append(f"{len(objs)} 0 R")
    objs[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>"
    out, offs = "%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offs.append(len(out)); out += f"{i} 0 obj\n{o}\nendobj\n"
    x = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n" + "".join(f"{o:010d} 00000 n \n" for o in offs)
    return out + f"trailer << /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{x}\n%%EOF\n"

def put(rel, data):
    p = s / rel; p.parent.mkdir(parents=True, exist_ok=True)
    (p.write_bytes if isinstance(data, bytes) else p.write_text)(data)

# CHEM 105a: a PDF lecture syllabus shaped like BISC 101's, plus a lab one.
put("CHEM-105/Syllabus/CHEM 105a Syllabus Fall 2026.pdf", pdf([
    ["CHEM 105a General Chemistry", "4 Units", "Tuesday and Thursday from 9:30am to 10:50am",
     "In Person - Room SGM 124", "Labs:", "30510R Monday 2:00-4:50 pm", "30512R Friday 8:00-10:50 am",
     "Instructor: Dana Whitfield, PhD", "Office: SSC 410", "Office Hours: TBD",
     "Office Hours: Mon 1-2pm and Thu 11am-noon", "Contact Info: dwhitfield@usc.edu"],
    ["Grading Breakdown", "The course grade will be based upon 500 possible points:",
     "Assignment Points % of Grade", "Midterm I 100 ~20", "Midterm II 100 ~20", "Final Exam 150 ~30",
     "Laboratory 100 ~20", "Problem Sets 50 ~10", "Grading Scale", "A 93-100"],
    ["Attendance is not graded, but exams cannot be made up.",
     "Students may use AI tools for practice, and two absences of AI use are allowed without citation."],
]))
put("CHEM-105/Lab/CHEM 105a Lab Syllabus.pdf", pdf([
    ["CHEM 105a Laboratory", "Lab manager: Pat Ruiz", "E-mail: pruiz@usc.edu", "Office: SSC 101"]]))
# A scan: a page with no text layer.
put("CHEM-105/Syllabus/CHEM 105a Syllabus scan.pdf", pdf([[]]))

# PSYC 100: a DOCX shaped like ACAD 324's, with the 105% percent column.
para = lambda t: f"<w:p><w:r><w:t>{t}</w:t></w:r></w:p>"
doc = "".join(para(t) for t in [
    "PSYC 100: Introduction to Psychology", "Units: 4.0",
    "Term: Fall 2026, Monday &amp; Wednesday 12:00 to 1:50 pm", "Location: SGM 101",
    "Instructor: Lee Park", "Office / Office Hours: Virtual / Wednesdays 3:00-4:00 pm",
    "Contact Info: lpark@usc.edu", "IT Help", "Contact Info: psychelp@usc.edu",
    "Grading Breakdown", "Assignment Points % Of Grade", "Participation 100 pts 10%",
    "Quizzes 150 pts 15%", "Projects: Research &amp; Design 250 pts 30%", "Midterm 200 pts 20%",
    "Final Project 300 pts 30%", "TOTAL 1000 pts 100%",
    "Attendance", "Each student will be allowed three absences over the semester for which no explanation is required.",
    "Generative AI Policy", "Using ChatGPT is permitted with citation; more than two absences of disclosure lowers the grade."])
for d in ("PSYC-100", "WRIT-150"):
    (s / d).mkdir(parents=True, exist_ok=True)
z = zipfile.ZipFile(s / "PSYC-100" / "PSYC 100 Syllabus.docx", "w")
z.writestr("word/document.xml", f'<w:document xmlns:w="w"><w:body>{doc}</w:body></w:document>')
z.close()

# WRIT 150: a PPTX, two-column text printed twice, and a labor contract.
slide = lambda paras: ('<p:sld xmlns:p="p" xmlns:a="a"><p:txBody>' + "".join(
    f"<a:p><a:r><a:t>{t}</a:t></a:r></a:p>" for t in paras) + "</p:txBody></p:sld>")
z = zipfile.ZipFile(s / "WRIT-150" / "WRIT 150 Syllabus.pptx", "w")
z.writestr("ppt/slides/slide1.xml", slide([
    "WRIT 150 SECTION 64000 WRIT 150 SECTION 64000", "TUES. &amp; THURS. 2:00–3:20 P.M. TUES. &amp; THURS. 2:00–3:20 P.M.",
    "THH 208 THH 208", "OFFICE HOURS OFFICE HOURS", "ASSIGNED TEXTS ASSIGNED TEXTS", "FRIDAYS FRIDAYS",
    "1:00–3:00 P.M. 1:00–3:00 P.M.", "email: jwells@usc.edu"]))
z.writestr("ppt/slides/slide2.xml", slide([
    "GRADING CONTRACT", "This course uses a labor-based grading contract.",
    "ABSENCES LATE ESSAYS LATE ANCILLARY", "B or above 3 or fewer None 0–3"]))
z.close()

# ARTS 101: a Brightspace HTML page, and a percent table that adds to 90.
put("ARTS-101/Course Info/ARTS 101 Syllabus.html", """<html><head><style>p{color:red}</style>
<script>var x = "MWF 8:00-9:00 am";</script></head><body>
<h2>ARTS 101 Drawing</h2><p>Meets: MWF 9:00-9:50 am, Watt Hall WAH 104</p>
<p>Office hours: Tue 10-11am in WAH 210</p><p>Email: <a href="mailto:rkim@usc.edu">rkim@usc.edu</a></p>
<h3>Grading</h3><table><tr><td>Portfolio</td><td>50%</td></tr><tr><td>Critiques</td><td>25%</td></tr>
<tr><td>Sketchbook</td><td>15%</td></tr></table>
<p>More than two absences will lower your final grade by a third of a letter.</p></body></html>""")
PY

out="$($PY "$ROOT/bin/chewbacca-usc" syllabus 2>&1)"
[ "$(cat "$L"/courses/*.yml | grep -c source)" = 0 ] && printf '%s' "$out" | grep -q "would fill meets" \
  && ok "without --apply it says what it would fill and writes nothing" || no "dry run: $out"
out="$($PY "$ROOT/bin/chewbacca-usc" syllabus --apply 2>&1)"
show() { node "$ROOT/bin/coursework" show "$1" --json; }

# Each answer, from its own file and page.
got="$(show chem | $PY -c '
import json, sys
c = json.load(sys.stdin)[0]
m = c["meets"]
i = c["instructor"]
print(len(m), m[0]["days"], m[0]["start"], m[0]["end"], m[0]["room"], m[0]["source"])
print(i["email"], "|", i["office"], "|", i["office_hours"], "|", i["office_hours_source"])
print([(g["name"], g.get("points"), g.get("weight")) for g in c["grading"]], c["grading"][0]["source"])
print(c["absences"].get("ungraded"), c["absences"].get("allowed"))')"
want="1 ['Tue', 'Thu'] 09:30 10:50 SGM 124 CHEM 105a Syllabus Fall 2026.pdf, page 1
dwhitfield@usc.edu | SSC 410 | Mon 1-2pm and Thu 11am-noon | CHEM 105a Syllabus Fall 2026.pdf, page 1
[('Midterm I', 100, None), ('Midterm II', 100, None), ('Final Exam', 150, None), ('Laboratory', 100, None), ('Problem Sets', 50, None)] CHEM 105a Syllabus Fall 2026.pdf, page 2
True None"
[ "$got" = "$want" ] \
  && ok "PDF: class times and room from the header (lab section list left out), office hours past a TBD, points with no rounded percents, no attendance grade" \
  || no "CHEM from PDF:
$got
want:
$want"
grep -q "pruiz" "$L/courses/chem-105a.yml" && no "the lab manager's address became the instructor's"
printf '%s' "$out" | grep -q "can't read: CHEM 105a Syllabus scan.pdf (no text layer" \
  && ok "a scanned syllabus is named, never read as empty" || no "scan not named: $out"

got="$(show psyc | $PY -c '
import json, sys
c = json.load(sys.stdin)[0]
m, i = c["meets"][0], c["instructor"]
print(m["days"], m["start"], m["end"], m["room"], i["email"], "|", i["office_hours"])
print([(g["name"], g.get("points"), g.get("weight")) for g in c["grading"]])
print(c["absences"]["allowed"], c["absences"]["used"])')"
want="['Mon', 'Wed'] 12:00 13:50 SGM 101 lpark@usc.edu | Virtual / Wednesdays 3:00-4:00 pm
[('Participation', 100, None), ('Quizzes', 150, None), ('Projects: Research & Design', 250, None), ('Midterm', 200, None), ('Final Project', 300, None)]
4 1"
[ "$got" = "$want" ] \
  && ok "DOCX: the IT help desk isn't the instructor, a percent column adding to 105 falls back to points" \
  || no "PSYC from DOCX:
$got
want:
$want"
printf '%s' "$out" | grep -q "left alone, differs: absences: syllabus says 3 free (PSYC 100 Syllabus.docx, text), the ledger says 4" \
  && ok "a value the student wrote is kept and the disagreement is reported" || no "conflict not reported: $out"

got="$(show writ | $PY -c '
import json, sys
c = json.load(sys.stdin)[0]
m, i = c["meets"][0], c["instructor"]
print(m["days"], m["start"], m["end"], m["room"], "|", i["office_hours"], "|", c["grading_model"], c["absences"]["allowed"])')"
[ "$got" = "['Tue', 'Thu'] 14:00 15:20 THH 208 | FRIDAYS 1:00–3:00 P.M. | contract 3" ] \
  && ok "PPTX: a two-column layout printed twice, a labeled office-hours block, a labor contract and its absence table" \
  || no "WRIT from PPTX: $got"

got="$(show arts | $PY -c '
import json, sys
c = json.load(sys.stdin)[0]
m, i = c["meets"][0], c["instructor"]
print(m["days"], m["start"], m["end"], m["room"], i["email"], "|", i["office_hours"], "|", c["absences"]["allowed"], c.get("grading"))')"
[ "$got" = "['Mon', 'Wed', 'Fri'] 09:00 09:50 WAH 104 rkim@usc.edu | Tue 10-11am in WAH 210 | 2 None" ] \
  && ok "Brightspace HTML: scripts ignored, MWF read, and a grading table adding to 90% isn't written" \
  || no "ARTS from HTML: $got"
printf '%s' "$out" | grep -q "not in the syllabus: grading (the syllabus table adds to 90%" \
  && ok "the off grading table is named as a gap" || no "90% table not named: $out"

# The CLI answers the two questions the walk couldn't.
node "$ROOT/bin/coursework" attendance arts | grep -q "2 left of 2" \
  && ok "\"can I skip Wednesday\" now has a budget to answer from" || no "attendance: $(node "$ROOT/bin/coursework" attendance arts)"
node "$ROOT/bin/coursework" check > "$T/check" 2>&1
grep -q "CHEM 105a: no grading breakdown\|PSYC 100: no meeting times\|WRIT 150: no grading" "$T/check" \
  && no "coursework check still lists a gap the syllabus filled: $(cat "$T/check")" \
  || ok "coursework check no longer lists the gaps the syllabi answered"

# Never the AI policy: not a word of it, and its "two absences" isn't the budget.
grep -il "chatgpt\|generative\|\bAI\b\|disclosure\|citation" "$L"/courses/*.yml \
  && no "AI policy text reached the ledger" || ok "no AI policy text reaches the ledger"
printf '%s' "$out" | grep -qi "chatgpt\|generative\| AI " && no "the run printed AI policy text" || ok "and none is printed"

# Rerunning changes nothing.
sum1="$(cat "$L"/courses/*.yml | cksum)"
$PY "$ROOT/bin/chewbacca-usc" syllabus --apply > /dev/null 2>&1
[ "$sum1" = "$(cat "$L"/courses/*.yml | cksum)" ] && ok "a second --apply writes nothing" || no "rerun changed the ledger"

# Compare mode scores a filled ledger against a hand-written one, writing nothing there.
mkdir -p "$T/hand/courses"
cp "$L/courses/arts-101.yml" "$T/hand/courses/"
sed -i '' 's/start: "09:00"/start: "10:00"/' "$T/hand/courses/arts-101.yml"
before="$(cksum < "$T/hand/courses/arts-101.yml")"
cmp="$($PY "$ROOT/bin/chewbacca-usc" syllabus --compare "$T/hand" 2>&1)"
printf '%s' "$cmp" | grep -q "conflict ARTS 101     class times" && printf '%s' "$cmp" | grep -q "match    ARTS 101     room" \
  && [ "$before" = "$(cksum < "$T/hand/courses/arts-101.yml")" ] \
  && ok "--compare counts matches and conflicts and never writes to the ledger it reads" || no "compare: $cmp"

exit "$fail"
