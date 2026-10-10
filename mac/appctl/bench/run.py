#!/usr/bin/env python3
"""Measure chewie app find against labeled picks, to set do's confidence cutoff.

    python3 mac/appctl/bench/run.py dev        pick a cutoff here
    python3 mac/appctl/bench/run.py sealed     then score it once here

Each case is an intent over a frozen window snapshot (snap_*.json, taken from
apps with nothing personal in them) and the control a person would mean, or
none. The cost of a mistake is lopsided: `do` pressing the wrong control is
the failure that matters, while a refusal only hands the pick back to the
person. So the cutoff is the lowest one with zero wrong presses on dev, and
the sealed set says whether that held.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))
import app_find  # noqa: E402

CUTOFFS = [0.0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]


def run(split: str) -> list[dict]:
    cases = json.loads((HERE / "cases.json").read_text())[split]
    out = []
    for c in cases:
        snap = json.loads((HERE / f"snap_{c['snap']}.json").read_text())
        r = app_find.find(snap, c["intent"])
        got = (r.get("element") or {}).get("label") if r.get("i") is not None else "none"
        out.append({**c, "got": got, "confidence": float(r.get("confidence") or 0), "via": r.get("via")})
    return out


def score(rows: list[dict], cutoff: float) -> dict:
    pressed = [r for r in rows if r["got"] != "none" and r["confidence"] >= cutoff]
    wrong = [r for r in pressed if r["got"] != r["expect"]]
    should = [r for r in rows if r["expect"] != "none"]
    right = [r for r in pressed if r["got"] == r["expect"]]
    return {"cutoff": cutoff, "pressed": len(pressed), "wrong_presses": len(wrong),
            "coverage": f"{len(right)}/{len(should)}"}


def main() -> int:
    split = sys.argv[1] if len(sys.argv) > 1 else "dev"
    rows = run(split)
    for r in rows:
        mark = "ok " if r["got"] == r["expect"] else "XX "
        print(f"{mark} {r['confidence']:.2f}  {r['intent']!r:45} -> {r['got']!r}  (want {r['expect']!r}, {r['via']})")
    print()
    for c in CUTOFFS:
        print(score(rows, c))
    (HERE / f"result_{split}.json").write_text(json.dumps(rows, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
