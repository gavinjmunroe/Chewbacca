#!/usr/bin/env python3
"""people-amber: Amber's own tests pass here, the Python filler twin agrees with
the JS one, meeting capture strips an outro, and people-check reads a store,
routes unsure rows to Jev and reads Jev's noul answer shape. No network: Jev
is a fake module."""
import json
import sqlite3
import subprocess
import sys
import tempfile
import types
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent)
if not subprocess.run(["sh", "-c", "command -v node"], capture_output=True).stdout:
    print("SKIP: node not installed")
    sys.exit(77)
sys.path.insert(0, str(ROOT / "bin/lib"))
sys.path.insert(0, str(ROOT / "tools"))
import meeting_capture  # noqa: E402
import people_amber  # noqa: E402
from transcript_filler import strip_transcript_filler  # noqa: E402

fails = []


def no(msg):
    fails.append(msg)
    print("FAIL:", msg)


r = subprocess.run(["node", "--test"], cwd=ROOT / "bin/lib/people-amber", capture_output=True, text=True)
if r.returncode != 0 or "# fail 0" not in r.stdout:
    no("Amber's own tests failed:\n" + r.stdout[-800:])

samples = [
    "So the plan is to ship Friday. Thank you for watching!",
    "Subtitles by the Amara.org community",
    "We should call Roy. Thanks.",
    "Thanks for watching. The budget is 40k. Bye-bye.",
    "  [BLANK_AUDIO]  ",
    "I made a video and said thanks for watching to everyone in it. Then we left.",
    "",
]
for text in samples:
    js = people_amber.amber("filler", {"text": text})
    py = strip_transcript_filler(text)
    if (js["text"], js["removed"], js["allFiller"]) != (py["text"], py["removed"], py["all_filler"]):
        no(f"filler twins disagree on {text!r}: js={js} py={py}")

if meeting_capture.clean_transcript("Call Gavin at noon. Thank you for watching!") != "Call Gavin at noon.":
    no("meeting capture kept Whisper's outro")
if meeting_capture.clean_transcript("Call Gavin at noon. Thanks.") != "Call Gavin at noon. Thanks.":
    no("meeting capture ate a real 'Thanks.'")

with tempfile.TemporaryDirectory() as t:
    db = Path(t) / "people.db"
    con = sqlite3.connect(db)
    con.executescript("""
      CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, email TEXT, company TEXT,
        location TEXT, created_at TEXT, deleted_at TEXT);
      CREATE TABLE identities (person_id INTEGER, kind TEXT, value TEXT);
      INSERT INTO people (id, name, company) VALUES (1, 'Nate Kaplan', 'PwC'), (2, 'Nathan Kaplan', NULL),
        (3, '262966', NULL), (4, 'M', NULL), (5, 'Sam Lee', NULL), (6, 'Samuel Lee', NULL);
      INSERT INTO people (id, name, deleted_at) VALUES (7, 'Gone Person', '2026-01-01');
      INSERT INTO identities VALUES (2, 'email', 'nk@pwc.com'), (5, 'phone', '+1 310 555 0100'),
        (6, 'phone', '(310) 555-0100'), (4, 'phone', '+1 213 555 0199');
    """)
    con.commit()
    con.close()
    rows = people_amber.store_rows(db)
    if sorted(r["id"] for r in rows) != [1, 2, 3, 4, 5, 6]:
        no(f"store_rows should skip deleted people: {[r['id'] for r in rows]}")

    asked = []

    def fake_ask(state, questions, decision=None):
        asked.append((decision, sorted(questions)))
        return {k: {"type": "noul", "noul": 0.95} for k in questions}

    sys.modules["jev"] = types.SimpleNamespace(
        ask=fake_ask, probability=lambda v: float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None)

    verdicts = {v["id"]: v for v in people_amber.realness(rows, use_jev=True)}
    if verdicts[3]["isReal"] or verdicts[3]["decided_by"] != "rules":
        no(f"a shortcode is the rules' call, not Jev's: {verdicts[3]}")
    if verdicts[4]["decided_by"] != "jev" or not verdicts[4]["isReal"]:
        no(f"a one-letter name is unsure and should go to Jev, whose 0.95 makes it real: {verdicts[4]}")
    if verdicts[1]["decided_by"] != "rules":
        no("a plainly named person should never cost a Jev call")

    pairs = people_amber.dupes(rows, use_jev=True)
    by = {frozenset((p["keep"]["name"], p["drop"]["name"])): p for p in pairs}
    sam = by.get(frozenset(("Sam Lee", "Samuel Lee")))
    nate = by.get(frozenset(("Nate Kaplan", "Nathan Kaplan")))
    if not sam or sam["decided_by"] != "rules":
        no(f"a shared phone is provable by the rules alone: {sam}")
    if not nate or nate["decided_by"] != "jev" or nate["jev"] != 0.95:
        no(f"Nate/Nathan at PwC is 'likely' and should read Jev's noul answer: {nate}")
    if any(d == "people-dupes" and any(k for k in qs) and sam and "Sam" in json.dumps(qs) for d, qs in asked):
        no("a provable pair was sent to Jev")

    del sys.modules["jev"]

print("ok" if not fails else f"{len(fails)} failed")
sys.exit(1 if fails else 0)
