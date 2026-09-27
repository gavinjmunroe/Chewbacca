#!/usr/bin/env python3
"""The judge: does this checkout answer the logged slow requests with no model?

    python3 tests/voice_cases.py --shapes open,make
    python3 tests/voice_cases.py --top 3

`bin/evolve --expect` runs this twice, once before a proposed change and once
after, and keeps the change only if it failed before and passes after. That
flip is the one thing a structural score cannot show: that the change fixed
the failure it was written for.

The cases are real sentences from ~/.chewbacca/learn/cases/voice.jsonl, which
`bin/reflect --write` fills from the voice log. They are private, which is why
this is not in tests/run.sh: the public suite has no cases to judge.

THE RULES A PROPOSAL IS HELD TO:
  - every case of every named shape must reach a fast path, except
  - a shape or a single sentence the proposer declined, in
    ~/.chewbacca/learn/declined.jsonl with a reason, which is skipped and
    printed, so a decline is never silent, and
  - at least one case must be left to judge. Declining everything is not a fix.

A proposal may never edit this file. `bin/propose` refuses a change that
touches it, because a judge the defendant can rewrite is not a judge.
"""
from __future__ import annotations

import argparse
import importlib.util
import os
import sys
import tempfile
from importlib.machinery import SourceFileLoader
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import learnloop as L  # noqa: E402


def fast_path():
    # The bridge must not write into the real voice log while being judged.
    os.environ.setdefault("SUPERASSISTANT_DIR", tempfile.mkdtemp(prefix="superassistant-judge-"))
    path = ROOT / "bin" / "hud-listen"
    spec = importlib.util.spec_from_file_location(
        "hud_listen", path, loader=SourceFileLoader("hud_listen", str(path)))
    module = importlib.util.module_from_spec(spec)
    sys.modules["hud_listen"] = module
    spec.loader.exec_module(module)
    return module.fast_path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--shapes", default="", help="comma separated, as reflect names them")
    ap.add_argument("--top", type=int, default=3)
    a = ap.parse_args()

    shapes = [s.strip() for s in a.shapes.split(",") if s.strip()]
    # Declines are skipped here, not in select(): a shape named on the command
    # line was chosen before the proposal ran, and one it declined during the
    # run must still show up as declined rather than silently vanish.
    groups = L.rank(L.read_jsonl(L.CASES / "voice.jsonl"), skip={})
    groups = [g for g in groups if g["shape"] in shapes] if shapes else groups[:a.top]
    if not groups:
        print("nothing to judge: no live cases for", shapes or f"the top {a.top}")
        return 2

    claims = fast_path()
    declined, left = L.declined(), L.declined_cases()
    judged, failing = 0, 0
    for g in groups:
        if g["shape"] in declined:
            print(f"DECLINED  {g['shape']}: {declined[g['shape']].get('why', '')}")
            continue
        cases = [c for c in g["cases"] if c["id"] not in left]
        for c in g["cases"]:
            if c["id"] in left:
                print(f"LEFT      \"{c['said'][:60]}\": {left[c['id']].get('why', '')}")
        judged += len(cases)
        missed = [c for c in cases if not claims(c["said"])]
        failing += len(missed)
        print(f"{'ok  ' if not missed else 'FAIL'}      {g['shape']}: "
              f"{len(cases) - len(missed)}/{len(cases)} reach a fast path")
        for c in missed[:6]:
            print(f"            still to the model: [{c['id']}] \"{c['said'][:64]}\"")
    if not judged:
        print("every case was declined, so nothing was fixed")
        return 1
    return 1 if failing else 0


if __name__ == "__main__":
    sys.exit(main())
