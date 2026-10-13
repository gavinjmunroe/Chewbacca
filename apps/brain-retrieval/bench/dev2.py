#!/usr/bin/env python3
"""Score the SHIPPED ranker on one gold set and count lone-hub misses.

No knobs: brain.rank() runs with its defaults, so the number is what
`brain ask` gives today. Built for dev2, the 2026-10-10 blind set written so
that a lone file directly under domains/ (mission.md, story.md, ...) can
actually cost a query, which the first 25-query dev set never showed.

A miss is "caused by lone domains/*.md files" when at least one such file
(not itself gold) holds a top-5 slot AND the gold file would be in the top 5
if those lone files were removed from the list. A miss where lone files sit
in the top 5 but the gold is ranked too low to be rescued is counted
separately, as "lone file present".

    BRAIN_INDEX=/frozen/.brain python3 bench/dev2.py                # dev2
    BRAIN_INDEX=/frozen/.brain python3 bench/dev2.py --set queries.json
Never point --set at the sealed file; it has its own once-per-change rule.
"""
import argparse, collections, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hubs      # noqa: E402  (index loading, query vectors, gold resolution)
import goldset   # noqa: E402
brain = hubs.brain

SEALED = "queries_independent.json"


def is_lone(f):
    return f.startswith("domains/") and f.count("/") == 1


def score(prepped, rows, k=5, E=None):
    hit = mrr = 0.0
    caused, present, misses = 0, 0, []
    filler = collections.Counter()
    for q, gold, dense, lex in prepped:
        top, _ = brain.rank(rows, dense, lex, 50, E=E)
        names = [f for f, _ in top]
        rank = next((i + 1 for i, f in enumerate(names) if f in gold), None)
        if rank:
            mrr += 1 / rank
        if rank and rank <= k:
            hit += 1
            continue
        lone_top = [f for f in names[:k] if is_lone(f) and f not in gold]
        without = [f for f in names if not (is_lone(f) and f not in gold)]
        rescued = any(f in gold for f in without[:k])
        if lone_top and rescued:
            caused += 1
        elif lone_top:
            present += 1
        for f in names[:k]:
            filler[f if is_lone(f) else (brain.folder(f) or f.split("/")[0] + "/")] += 1
        misses.append((q["q"], rank, names[:k], bool(lone_top), rescued))
    n = len(prepped)
    return hit / n, mrr / n, caused, present, misses, filler


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", default="queries_dev2.json")
    ap.add_argument("--misses", action="store_true", help="print each miss and its top 5")
    a = ap.parse_args()
    if a.set == SEALED:
        raise SystemExit("refusing the sealed set: use hubs.py --sealed, once per change")
    db, rows, E = hubs.load_index()
    qs = goldset.load(a.set)
    pp = hubs.prepare(qs, db, rows, E)
    print(f"index {hubs.IDX}: {len({r[1] for r in rows})} files, {len(rows)} chunks")
    print(f"{a.set}: {len(qs)} questions, {len(pp)} with a gold file in the index")
    p, mrr, caused, present, misses, filler = score(pp, rows, E=E)
    n = len(pp)
    ci = 196 * (p * (1 - p) / n) ** 0.5
    print(f"shipped ranker  r@5 {p*100:5.1f}% +/-{ci:4.1f}  MRR {mrr:.3f}  misses {len(misses)}")
    print(f"misses caused by lone domains/*.md (rescued if lone files removed): {caused}")
    print(f"misses with a lone file in the top 5 but gold too deep to rescue: {present}")
    print("top-5 slots on misses:")
    for f, c in filler.most_common(10):
        print(f"  {c:3}  {f}")
    if a.misses:
        for q, rank, top, lone, rescued in misses:
            tag = "LONE-CAUSED" if lone and rescued else ("lone-present" if lone else "other")
            print(f"\n[{tag}] gold rank {rank}  {q}")
            for f in top:
                print(f"    {f}")


if __name__ == "__main__":
    main()
