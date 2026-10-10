#!/usr/bin/env python3
"""A long hub folder cannot fill brain's top 5 for a question it does not answer.

On 2026-10-09 most sealed-set misses lost to two long domains/ subfolders whose
every chunk was mildly on topic, so under mean aggregation their files took
three or four of the five slots for unrelated questions. The fixture here is
synthetic and rebuilds that shape: one hub folder of long files that all score
a little above the short note that actually answers.

Hermetic: calls brain.rank() on made-up rows and scores, no index, no Ollama.
"""
import importlib.util
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAIN = os.environ.get("BRAIN_PY") or os.path.join(ROOT, "apps", "brain-retrieval", "src", "brain.py")
MAX_HUB_IN_TOP5 = 1     # the most slots one hub folder may hold in the top 5

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"  ok  {name}")
    else:
        failed += 1
        print(f"  FAIL {name}  {detail}")


def load_brain():
    spec = importlib.util.spec_from_file_location("brain_under_test", BRAIN)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def corpus(answer_cos):
    """Five long hub files (12 chunks each) at cosine 0.70 everywhere, one short
    answering note, and twelve short unrelated notes below both."""
    rows, dense, lex = [], [], {}
    def add(f, cos, bm25=0.0):
        cid = len(rows) + 1
        rows.append((cid, f, "", "synthetic", len(rows)))
        dense.append(cos)
        if bm25:
            lex[cid] = bm25
    for h in "abcde":
        for i in range(12):
            add(f"domains/hub/{h}.md", 0.70 - 0.001 * i, 1.0)
    add("memory/answer.md", answer_cos, 2.0)
    for i in range(12):
        add(f"memory/other_{i:02}.md", 0.55 + 0.005 * i)
    return rows, np.asarray(dense, dtype="float32"), lex


def hub_slots(top):
    return sum(1 for f, _ in top if f.startswith("domains/hub/"))


def main():
    brain = load_brain()
    check("the shipped folder cap is at most the allowed hub slots",
          0 < brain.FOLDER_CAP <= MAX_HUB_IN_TOP5, f"FOLDER_CAP={brain.FOLDER_CAP}")

    for label, answer_cos in [("answer scores just under the hub", 0.66),
                              ("answer scores above the hub", 0.75)]:
        rows, dense, lex = corpus(answer_cos)
        old, _ = brain.rank(rows, dense, lex, 5, folder_cap=0)
        top, _ = brain.rank(rows, dense, lex, 5)
        names = [f for f, _ in top]
        # The fixture must reproduce the failure, or the checks below prove nothing.
        check(f"{label}: without a cap the hub fills the top 5 (fixture is live)",
              hub_slots(old) > MAX_HUB_IN_TOP5, [f for f, _ in old])
        check(f"{label}: the hub folder holds at most {MAX_HUB_IN_TOP5} of the top 5",
              hub_slots(top) <= MAX_HUB_IN_TOP5, names)
        check(f"{label}: the answering note is in the top 5",
              "memory/answer.md" in names, names)
        check(f"{label}: still five results", len(names) == 5, names)

    # Flat stores are not folders: many memory/ notes may share the top 5.
    rows, dense, lex = corpus(0.66)
    rows = [r for r in rows if not r[1].startswith("domains/hub/")]
    dense = np.asarray([0.6 + 0.01 * i for i in range(len(rows))], dtype="float32")
    rows = [(r[0], r[1], r[2], r[3], i) for i, r in enumerate(rows)]
    top, _ = brain.rank(rows, dense, {}, 5)
    check("memory/ notes are never capped as one folder",
          sum(1 for f, _ in top if f.startswith("memory/")) == 5, [f for f, _ in top])
    check("team memory paths are not a folder", brain.folder("~/code/x/team/memory/a.md") is None)
    check("a domains/ subfolder is a folder", brain.folder("domains/hub/a.md") == "domains/hub")
    check("a top-level domains/ file is not", brain.folder("domains/mission.md") is None)

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
