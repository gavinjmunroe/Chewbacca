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
  - every case the proposer was shown must reach a fast path, except
  - a shape or a single sentence the proposer declined, in
    ~/.chewbacca/learn/declined.jsonl with a reason, which is skipped and
    printed, so a decline is never silent, and
  - at least one case must be left to judge. Declining everything is not a fix.
  - A declined sentence that now reaches a fast path anyway fails. The
    proposer said it belongs to the model, and a parser that grabs it
    contradicts the reason given.

HELD-OUT CASES. One sentence in three is never shown to the proposer
(learnloop.held_out). They are scored on their own line and used by `evolve
--n` to rank candidates, but none of them has to pass: the proposer cannot
decline a sentence it never saw, and on 2026-09-27 six of fifteen "open"
sentences rightly stayed with the model, so a rule demanding them would pay a
parser to grab what belongs to the model. A shape that passes everything it
was shown and none of two or more held out is printed as MEMORISED, for the
person reading the branch, and does not fail. One thing does fail:
  - a held-out sentence of five words or more quoted in the change. The
    proposer saw it, so it no longer tests anything.
Held-out misses are printed by id, never by sentence, because this output is
archived under ~/.chewbacca/evolve where a later proposer could read it.

The last line is `JUDGE {...}`, the counts as JSON, for evolve to read.

A proposal may never edit this file. `bin/propose` refuses a change that
touches it, because a judge the defendant can rewrite is not a judge.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
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
    ap.add_argument("--change", default="",
                    help="read the change from this file instead of `git diff HEAD` (tests)")
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
    seen = L.exposed()
    change = Path(a.change).read_text(encoding="utf-8") if a.change else change_text()
    judged, failing, grabbed, memorised = 0, 0, 0, []
    held_pass, held_total, all_shown, all_held = 0, 0, [], []
    for g in groups:
        held = [c for c in g["cases"] if c["id"] not in left and L.held_out(c, seen)]
        all_held += held
        if g["shape"] in declined:
            print(f"DECLINED  {g['shape']}: {declined[g['shape']].get('why', '')}")
            for c in g["cases"]:
                path = claims(c["said"])
                if path:
                    grabbed += 1
                    print(f"GRABBED   [{c['id']}] reaches {path}, but the shape was declined")
            # Its held cases stay in the count as not reached. Declining a
            # whole shape must not lift a candidate's held-out share.
            held_total += len(held)
            continue
        for c in g["cases"]:
            if c["id"] in left:
                path = claims(c["said"])
                grabbed += bool(path)
                print(f"{'GRABBED ' if path else 'LEFT    '}  \"{c['said'][:60]}\": "
                      f"{left[c['id']].get('why', '')}" + (f" (now reaches {path})" if path else ""))
        shown = [c for c in g["cases"] if c["id"] not in left and c not in held]
        all_shown += shown
        judged += len(shown)
        missed = [c for c in shown if not claims(c["said"])]
        failing += len(missed)
        if shown:
            print(f"{'ok  ' if not missed else 'FAIL'}      {g['shape']}: "
                  f"{len(shown) - len(missed)}/{len(shown)} reach a fast path")
        for c in missed[:6]:
            print(f"            still to the model: [{c['id']}] \"{c['said'][:64]}\"")
        if held:
            passed = [c for c in held if claims(c["said"])]
            held_pass, held_total = held_pass + len(passed), held_total + len(held)
            print(f"          {g['shape']} held out: {len(passed)}/{len(held)} reach a fast path"
                  + (f", still to the model: {', '.join(c['id'] for c in held if c not in passed)}"
                     if len(passed) < len(held) else ""))
            if shown and not missed and len(held) >= 2 and not passed:
                memorised.append(g["shape"])
                print(f"MEMORISED {g['shape']}: passes every case it was shown and none it was "
                      f"not. Not a failure: read the held-out ids before merging")
    quoted = [c["id"] for c in L.quoted(all_held, change, all_shown)]
    for cid in quoted:
        print(f"SEEN      [{cid}] a held-out sentence is quoted in the change")
    print("JUDGE " + json.dumps({"train": [judged - failing, judged], "held": [held_pass, held_total],
                                 "grabbed": grabbed, "memorised": memorised, "quoted": quoted}))
    if not judged:
        print("every case was declined or held out, so nothing was fixed")
        return 1
    return 1 if failing or grabbed or quoted else 0


def change_text() -> str:
    """The lines the working tree adds against HEAD, new files included when
    evolve has marked them intent-to-add. Added lines only: a diff's context
    lines are text the change did not write. Empty outside a git checkout."""
    r = subprocess.run(["git", "-C", str(ROOT), "diff", "HEAD"], capture_output=True, text=True)
    if r.returncode != 0:
        return ""
    return "\n".join(line[1:] for line in r.stdout.splitlines()
                     if line.startswith("+") and not line.startswith("+++"))


if __name__ == "__main__":
    sys.exit(main())
