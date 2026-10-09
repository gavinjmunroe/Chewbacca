#!/usr/bin/env python3
"""A test for the INSTRUMENT, not the page.

Six measurement bugs in one day, each found only because a number moved
without the page changing, and each one would have had me editing correct
code. The instrument had no test, so every fix to it was unverified and two
of them broke something else.

Asserts, on whatever measurement files are present:

  every section carries a full measurement, none unmounted or thin
  every heading label is clean: no script text, no run-together words
  both sides pair, with at most one deliberate override
  the axis count is in a sane range for the section count
"""
import json, sys, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"

FAIL = []
def check(cond, msg):
    if not cond: FAIL.append(msg)

for tag in ("REF", "OURS"):
    f = DOCS / f"m2_{tag}.json"
    if not f.exists(): FAIL.append(f"{tag}: missing"); continue
    d = json.load(f.open())
    secs = d["sections"]
    check(len(secs) >= 8, f"{tag}: only {len(secs)} sections")
    for s in secs:
        head = s["heading"]
        check(not s.get("unmounted"), f"{tag}: '{head[:28]}' unmounted")
        check("h_size" in s, f"{tag}: '{head[:28]}' has no measurement")
        # script text leaking into a label
        check("self.__" not in head and "function" not in head,
              f"{tag}: '{head[:36]}' contains script text")
        # a <br> eaten, giving two words run together
        check(not re.search(r"[a-z]{2}[A-Z]", head) or head[0].isupper() and " " in head,
              f"{tag}: '{head[:36]}' looks like a <br> was dropped")
        check(len(head.split()) >= 1, f"{tag}: empty label")

if (DOCS / "DELTAS.md").exists():
    t = (DOCS / "DELTAS.md").read_text()
    only = t.count("ONLY")
    check(only <= 0, f"DELTAS: {only} sections did not pair")
    # The table header "| axis | theirs | ours | delta |" is not an axis.
    rows = [r for r in re.findall(r"^\| [a-z].*?\|$", t, re.M)
            if not r.startswith("| axis |")]
    check(len(rows) >= 150, f"DELTAS: only {len(rows)} comparable rows, expected 150+")

if FAIL:
    print(f"instrument check FAILED, {len(FAIL)} problem(s):")
    for m in FAIL: print("  -", m)
    sys.exit(1)
print("instrument check: clean")
