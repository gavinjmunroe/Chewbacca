#!/usr/bin/env python3
"""brain.rank() fuses by rank, counts a file's best chunk, and feeds back once.

2026-10-12: on dev3, a blind set built to reproduce the sealed misses (questions
worded unlike their note), two shapes cost most queries. A long note whose one
answering chunk ranked near the top of all chunks lost because its file mean
sank under its other chunks; and the query alone never reached notes its own
top chunks pointed at. These fixtures rebuild both shapes and fail on the
minmax-only rank() that shipped before.

Hermetic: synthetic rows and vectors, no index, no Ollama.
"""
import importlib.util
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAIN = os.environ.get("BRAIN_PY") or os.path.join(ROOT, "apps", "brain-retrieval", "src", "brain.py")

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


def long_answer_corpus():
    """One long note whose 1 answering chunk (0.90) sits among 20 off-topic
    ones (0.30), so its mean is 0.33, and six short notes at 0.60 to 0.65 that
    do not answer. Lexical matches nothing."""
    rows, dense = [], []
    def add(f, cos):
        rows.append((len(rows) + 1, f, "", "synthetic", len(rows)))
        dense.append(cos)
    add("domains/long_answer.md", 0.90)
    for _ in range(20):
        add("domains/long_answer.md", 0.30)
    for i in range(6):
        add(f"memory/short_{i}.md", 0.60 + 0.01 * i)
    return rows, np.asarray(dense, dtype="float32")


def feedback_corpus():
    """2-d vectors. The query is (1, 0). Five near-duplicate chunks in five
    notes sit at 30 degrees; the answer at +50 degrees leans their way, a
    decoy at -48 degrees leans away and scores higher on the raw query."""
    def at(deg):
        r = np.radians(deg)
        return [np.cos(r), np.sin(r)]
    rows, E = [], []
    for i in range(5):
        rows.append((len(rows) + 1, f"memory/cluster_{i}.md", "", "x", len(rows)))
        E.append(at(30 + 0.1 * i))
    rows.append((len(rows) + 1, "memory/answer.md", "", "x", len(rows))); E.append(at(50))
    rows.append((len(rows) + 1, "memory/a_decoy.md", "", "x", len(rows))); E.append(at(-48))
    E = np.asarray(E, dtype="float32")
    return rows, E, E @ np.asarray([1.0, 0.0], dtype="float32")


def main():
    brain = load_brain()

    rows, dense = long_answer_corpus()
    old, _ = brain.rank(rows, dense, {}, 5, fusion="minmax") if hasattr(brain, "FUSION") else \
        brain.rank(rows, dense, {}, 5)
    check("fixture is live: mean-only fusion drops the long answering note",
          "domains/long_answer.md" not in [f for f, _ in old], old)
    top, _ = brain.rank(rows, dense, {}, 5)
    check("shipped rank keeps a long note whose best chunk is the top chunk",
          "domains/long_answer.md" in [f for f, _ in top], top)

    rows, E, dense = feedback_corpus()
    raw, dv_raw = brain.rank(rows, dense, {}, 7)
    raw = [f for f, _ in raw]
    check("fixture is live: the raw query ranks the decoy over the answer",
          raw.index("memory/a_decoy.md") < raw.index("memory/answer.md"), raw)
    fed, dv_fed = brain.rank(rows, dense, {}, 7, E=E)
    fed = [f for f, _ in fed]
    check("feedback moves the answer ahead of the decoy",
          fed.index("memory/answer.md") < fed.index("memory/a_decoy.md"), fed)
    check("abstention cosines stay raw under feedback", dv_raw == dv_fed)

    q = np.asarray([1.0, 0.0], dtype="float32")
    top = np.argsort(-dense)[:brain.PRF_M]
    want = E @ (q + brain.PRF_B * E[top].mean(axis=0))
    check("feedback() is E @ (q + b * mean of the top m chunks)",
          np.allclose(brain.feedback(E, dense), want, atol=1e-5))
    check("feedback() passes a missing dense through", brain.feedback(E, None) is None)

    # Ties share a rank: a file's name never decides between equal scores.
    rows_t = [(1, "memory/a_low.md", "", "x", 0), (2, "memory/z_high.md", "", "x", 1),
              (3, "~/code/kit/team/memory/z_team.md", "", "x", 2), (4, "memory/m_mid.md", "", "x", 3)]
    d_t = np.asarray([0.20, 0.50, 0.50, 0.45], dtype="float32")
    top_t, _ = brain.rank(rows_t, d_t, {}, 4)
    names_t = [f for f, _ in top_t]
    check("with no lexical match, a higher cosine beats an earlier name",
          names_t.index("memory/z_high.md") < names_t.index("memory/a_low.md"), names_t)
    sc = dict(top_t)
    check("equal cosines get equal scores, team memory paths included",
          abs(sc["memory/z_high.md"] - sc["~/code/kit/team/memory/z_team.md"]) < 1e-12, sc)

    check("lexical-only mode still ranks (no dense, no feedback)",
          [f for f, _ in brain.rank(rows, None, {1: 3.0}, 3)[0]][0] == "memory/cluster_0.md")

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
