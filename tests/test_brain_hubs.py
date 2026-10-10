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


def lone_corpus():
    """Five long files sitting directly under domains/, no subfolder, 12 chunks
    each at cosine 0.70, one short answering note at 0.66, and short filler.
    The shape the folder cap missed on the 2026-10-10 sealed run."""
    rows, dense, lex = [], [], {}
    def add(f, cos, bm25=0.0):
        cid = len(rows) + 1
        rows.append((cid, f, "", "synthetic", len(rows)))
        dense.append(cos)
        if bm25:
            lex[cid] = bm25
    for h in "abcde":
        for i in range(12):
            add(f"domains/lone_{h}.md", 0.70 - 0.001 * i, 1.0)
    add("memory/answer.md", 0.66, 2.0)
    for i in range(12):
        add(f"memory/other_{i:02}.md", 0.55 + 0.005 * i)
    return rows, np.asarray(dense, dtype="float32"), lex


def lone_files(brain):
    """The lone-file knobs bench/lone.py sweeps. Each must do what its name
    says, or the table in TODO.md measured something else; and each stays off
    by default, because the one that won on dev lost 12 points sealed."""
    rows, dense, lex = lone_corpus()
    lone = lambda top: sum(1 for f, _ in top if f.startswith("domains/lone_"))
    shipped, _ = brain.rank(rows, dense, lex, 5)
    check("lone domains/ files are outside the folder cap (fixture is live)",
          lone(shipped) > 1, [f for f, _ in shipped])
    check("default rank equals every lone-file knob passed as off",
          shipped == brain.rank(rows, dense, lex, 5, top_m=None, unit="file",
                                hub=None, hub_beta=0.0, csls=0.0, lone_cap=0)[0])

    top, _ = brain.rank(rows, dense, lex, 5, lone_cap=1)
    names = [f for f, _ in top]
    check("lone_cap=1 holds lone domains/ files to one slot", lone(top) == 1, names)
    check("lone_cap=1 lets the answering note in", "memory/answer.md" in names, names)

    kocc = {f"domains/lone_{h}.md": 20.0 for h in "abcde"}
    top, _ = brain.rank(rows, dense, lex, 5, hub={"kocc": kocc}, hub_beta=0.5)
    names = [f for f, _ in top]
    check("a high k-occurrence prior demotes the lone files",
          names[0] == "memory/answer.md", names)

    # Best-chunk scoring: one strong chunk among weak ones now outranks a file
    # of uniformly middling chunks, which plain mean aggregation never allows.
    rows2 = [(1, "domains/long.md", "", "x", 0), (2, "domains/long.md", "", "x", 1),
             (3, "domains/long.md", "", "x", 2), (4, "memory/spiky.md", "", "x", 3),
             (5, "memory/spiky.md", "", "x", 4)]
    d2 = np.asarray([0.6, 0.6, 0.6, 0.9, 0.2], dtype="float32")
    mean_top, _ = brain.rank(rows2, d2, {}, 2)
    max_top, _ = brain.rank(rows2, d2, {}, 2, top_m=1)
    check("mean aggregation ranks the uniform long file first",
          mean_top[0][0] == "domains/long.md", mean_top)
    check("top_m=1 ranks the file with the best chunk first",
          max_top[0][0] == "memory/spiky.md", max_top)

    rows3 = [(1, "domains/long.md", "a", "x", 0), (2, "domains/long.md", "b", "x", 1),
             (3, "memory/flat.md", "", "x", 2)]
    d3 = np.asarray([0.9, 0.1, 0.6], dtype="float32")
    sec, _ = brain.rank(rows3, d3, {}, 2, unit="section")
    check("unit=section scores a file by its best section",
          sec[0][0] == "domains/long.md", sec)


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

    lone_files(brain)

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
