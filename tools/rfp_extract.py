#!/usr/bin/env python3
"""Turn an RFP into a compliance matrix: every requirement, deadline and scoring rule, verbatim, with page and line.

    rfp-extract <rfp.pdf|.txt|.md> [--csv matrix.csv] [--json]

Agencies sell "a Claude skill that extracts requirements from RFPs" (aurapathai.com, Rhea
case study, read 2026-11-03). A model summary of an RFP can drop a "shall" or invent one, and
the proposal team only finds out when the bid is thrown out. This reads the text without a
model: each sentence with a binding verb becomes a row, quoted exactly, with the page and line
it came from, so a reviewer can check every row against the source in seconds. Rows are typed
mandatory (shall, must, required), desired (should, preferred, may), deadline (a date near
due/submit/questions) or scoring (points, percent or weight near evaluation). The CSV has empty
response, owner and status columns for the team to fill.
"""
import argparse
import csv
import json
import os
import re
import shutil
import subprocess
import sys

MANDATORY = re.compile(r"\b(shall|must|is required|are required|required to|will be required|mandatory)\b", re.I)
DESIRED = re.compile(r"\b(should|preferred|is desired|desirable|may provide|is encouraged)\b", re.I)
MONTHS = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
DATE = re.compile(rf"\b(?:{MONTHS}\s+\d{{1,2}}(?:st|nd|rd|th)?,?\s+\d{{4}}|\d{{1,2}}/\d{{1,2}}/\d{{2,4}}|\d{{4}}-\d{{2}}-\d{{2}})\b", re.I)
DEADLINE_WORDS = re.compile(r"\b(due|deadline|submit|submitted|submission|questions|inquiries|no later than|closing|award)\b", re.I)
SCORING = re.compile(r"(\b\d{1,3}\s*(?:points?|pts)\b|\b\d{1,3}\s*%|\bweight(?:ed|ing)?\b)", re.I)
SCORING_WORDS = re.compile(r"\b(evaluat\w*|criteria|criterion|score\w*|scoring|weight\w*)\b", re.I)
CLAUSE = re.compile(r"^\d+(?:\.\d+)+\s+\S")
SECTION = re.compile(r"^\s*((?:section\s+)?\d+(?:\.\d+)*\.?|[A-Z]\.|[IVX]+\.)\s+[A-Z][^\n]{2,80}$")
# A sentence ends at . ! ? or ; followed by space and a capital, or at a blank line. RFPs
# number their clauses, so "3.2 The vendor shall" must not split at "3.".
SENTENCE_END = re.compile(r"(?<=[a-z0-9\)][.!?;])\s+(?=[A-Z(])")


def _die(msg):
    print(f"rfp-extract: {msg}", file=sys.stderr)
    sys.exit(2)


def read_pages(path):
    if not os.path.exists(path):
        _die(f"no such file: {path}")
    if path.lower().endswith(".pdf"):
        exe = shutil.which("pdftotext")
        if not exe:
            _die("reading a PDF needs pdftotext (brew install poppler), or pass a .txt export")
        out = subprocess.run([exe, "-layout", path, "-"], capture_output=True, text=True)
        if out.returncode != 0:
            _die(f"pdftotext failed: {out.stderr.strip()[:200]}")
        text = out.stdout
    else:
        with open(path, encoding="utf-8", errors="replace") as f:
            text = f.read()
    return text.split("\f")


def sentences(pages):
    """Yield (page, line, section, sentence) with the line the sentence starts on."""
    section = ""
    for pno, page in enumerate(pages, 1):
        buf, start = [], None
        lines = page.split("\n")
        for lno, raw in enumerate(lines + [""], 1):
            line = raw.strip()
            is_heading = bool(SECTION.match(raw)) and not MANDATORY.search(line) and not DESIRED.search(line)
            # A heading or a new numbered clause starts a new paragraph, so it never glues
            # onto the clause above or below it.
            if (is_heading or CLAUSE.match(line)) and buf:
                yield from _split(pno, start, section, " ".join(buf))
                buf, start = [], None
            if is_heading:
                section = line[:80]
                continue
            if not line:
                if buf:
                    yield from _split(pno, start, section, " ".join(buf))
                buf, start = [], None
                continue
            if start is None:
                start = lno
            buf.append(line)


def _split(pno, lno, section, para):
    para = re.sub(r"\s+", " ", para).strip()
    for s in SENTENCE_END.split(para):
        s = s.strip()
        if len(s) >= 12:
            yield pno, lno, section, s


def classify(s):
    if DATE.search(s) and DEADLINE_WORDS.search(s):
        return "deadline"
    if SCORING.search(s) and SCORING_WORDS.search(s):
        return "scoring"
    if MANDATORY.search(s):
        return "mandatory"
    if DESIRED.search(s):
        return "desired"
    return None


def extract(pages):
    rows, seen = [], set()
    for pno, lno, section, s in sentences(pages):
        kind = classify(s)
        if not kind:
            continue
        key = re.sub(r"\W+", " ", s.lower()).strip()
        if key in seen:
            continue
        seen.add(key)
        rows.append({"id": f"R{len(rows) + 1:03d}", "kind": kind, "page": pno, "line": lno,
                     "section": section, "text": s, "response": "", "owner": "", "status": ""})
    return rows


def summary(rows):
    counts = {}
    for r in rows:
        counts[r["kind"]] = counts.get(r["kind"], 0) + 1
    return counts


def main(argv=None):
    p = argparse.ArgumentParser(prog="rfp-extract", description=__doc__.split("\n\n")[0])
    p.add_argument("rfp")
    p.add_argument("--csv", help="write the compliance matrix here")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    rows = extract(read_pages(a.rfp))
    if not rows:
        _die("found no requirements. If this is a scanned PDF, OCR it first (bin/ingest).")
    if a.csv:
        with open(a.csv, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0]))
            w.writeheader(); w.writerows(rows)
    if a.json:
        print(json.dumps({"counts": summary(rows), "rows": rows}, indent=2))
        return 0
    c = summary(rows)
    print(", ".join(f"{c.get(k, 0)} {k}" for k in ("mandatory", "desired", "deadline", "scoring")))
    for r in rows:
        if r["kind"] in ("deadline", "scoring"):
            print(f"{r['id']} {r['kind']} p{r['page']}:{r['line']}  {r['text'][:140]}")
    if a.csv:
        print(a.csv)
    return 0


if __name__ == "__main__":
    sys.exit(main())
