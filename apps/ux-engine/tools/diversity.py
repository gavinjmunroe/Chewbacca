#!/usr/bin/env python3
"""How different are these pages from each other, actually?

Mean pairwise Jaccard distance over the design-token feature sets. 0.0 means
every sample made the same choices; 1.0 means they share nothing.

This is the number that decides whether "generate several and pick" is worth
anything. If repeated sampling scores near 0, best-of-N is choosing between
copies and the whole approach is theatre.

    python3 tools/diversity.py corpus/slop --group-by-brief
"""
import argparse
import itertools
import pathlib
import statistics
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import tokens  # noqa: E402


def jaccard_distance(a, b):
    if not a and not b:
        return 0.0
    return 1.0 - len(a & b) / len(a | b)


def score_group(paths):
    feats = [tokens.features(p.read_text(errors="ignore"), "html") for p in paths]
    feats = [f for f in feats if f]
    if len(feats) < 2:
        return None
    return statistics.mean(jaccard_distance(a, b)
                           for a, b in itertools.combinations(feats, 2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--group-by-brief", action="store_true",
                    help="group files as <brief>-<n>.html and average within brief")
    a = ap.parse_args()

    root = pathlib.Path(a.path)
    files = sorted(root.glob("*.html"))
    if not files:
        print(f"no html in {root}", file=sys.stderr)
        return 1

    if a.group_by_brief:
        groups = {}
        for f in files:
            brief = f.stem.rsplit("-", 1)[0]
            groups.setdefault(brief, []).append(f)
        scores = {}
        for brief, ps in sorted(groups.items()):
            s = score_group(ps)
            if s is not None:
                scores[brief] = s
                print(f"  {brief:<16} n={len(ps)}  distance {s:.3f}")
        if scores:
            print(f"\nmean within-brief distance: "
                  f"{statistics.mean(scores.values()):.3f}  "
                  f"({len(scores)} briefs, {len(files)} files)")
    else:
        s = score_group(files)
        print(f"mean pairwise distance: {s:.3f}  ({len(files)} files)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
