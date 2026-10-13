#!/usr/bin/env python3
"""Neighbourhood of the shipped rrf3 + feedback config, on the DEV sets only.

Sets brain's module constants (W_DENSE, RRF_K, PRF_B, PRF_M) one cell at a
time and scores brain.rank() itself, so a row here is what `brain ask` would
give with those constants. Net is queries gained minus lost against the
shipped constants over dev+dev2+dev3.

    BRAIN_INDEX=/frozen/.brain python3 bench/fusion_grid.py
"""
import itertools, os, sys
import numpy as np
np.seterr(all="ignore")  # Accelerate matmul raises spurious overflow flags on 0-vectors

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from cards import bench, brain, goldset, qvecs, SETS, SEALED  # noqa: E402


def main():
    db, rows, E = bench.load_index()
    files = {r[1] for r in rows}
    data = []
    for name in SETS.values():
        if name == SEALED:
            raise SystemExit("refusing the sealed set")
        try:
            qs = [q for q in goldset.load(name) if q.get("hops") != "trap"]
        except SystemExit:
            continue
        for q, qv in zip(qs, qvecs([q["q"] for q in qs])):
            g = bench.resolve_gold(q["gold"], files)
            if g:
                data.append((g, E @ qv, brain.lexical(db, q["q"])))
    ship = (brain.W_DENSE, brain.RRF_K, brain.PRF_B, brain.PRF_M)

    def hits(cell):
        brain.W_DENSE, brain.RRF_K, brain.PRF_B, brain.PRF_M = cell
        out = []
        for g, dense, lex in data:
            top = [f for f, _ in brain.rank(rows, dense, lex, 5, E=E)[0]]
            out.append(bool(g & set(top)))
        return out

    base = hits(ship)
    print(f"n={len(data)}  shipped {ship}: {sum(base)} hits")
    rows_out = []
    for cell in itertools.product((0.6, 0.7, 0.8), (5, 10, 20), (0.4, 0.6, 0.8, 1.0), (3, 5, 8)):
        h = hits(cell)
        g = sum(1 for a, b in zip(base, h) if b and not a)
        l = sum(1 for a, b in zip(base, h) if a and not b)
        rows_out.append((g - l, g, l, cell))
    for net, g, l, cell in sorted(rows_out, reverse=True)[:12]:
        print(f"  w={cell[0]} k={cell[1]} b={cell[2]} m={cell[3]}  net {net:+d} (+{g} -{l})")
    brain.W_DENSE, brain.RRF_K, brain.PRF_B, brain.PRF_M = ship


if __name__ == "__main__":
    main()
