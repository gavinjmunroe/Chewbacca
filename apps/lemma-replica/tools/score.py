#!/usr/bin/env python3
"""Score docs/DELTAS.md: how many measured axes match.

The score used to be a count of `| ... |` rows, and the table header
`| axis | theirs | ours | delta |` matched that pattern once per section, so
11 header rows were scored as 11 misses (136 of 220 against 136 of 209
real). A row is an axis only if it is a data row: not the header, not the
separator. Run tools/check_measure.py first; this trusts the file.
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
HEADER = re.compile(r"^\|\s*axis\s*\|", re.I)
ROW = re.compile(r"^\|\s*[a-z][^|]*\|[^|]*\|[^|]*\|([^|]*)\|\s*$")


def axis_rows(text):
    return [m for line in text.splitlines()
            if not HEADER.match(line) and (m := ROW.match(line))]


def score(text):
    rows = axis_rows(text)
    ok = sum(1 for m in rows if m.group(1).strip() == "ok")
    return ok, len(rows)


if __name__ == "__main__":
    ok, n = score((ROOT / "docs" / "DELTAS.md").read_text())
    print(f"axes matching  {ok} of {n}  {100 * ok / max(n, 1):.0f}%")
