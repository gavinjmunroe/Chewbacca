#!/usr/bin/env python3
"""Does doc2query help brain.rank()? Dev sweep, and one sealed run per frozen config.

Needs bench/d2q_build.py to have filled $BRAIN_INDEX/bench-cache/d2q.json.
Each file's questions are embedded once (cached beside the index); per query a
file's probe score is its best question cosine, passed to brain.rank(probes=).

    BRAIN_INDEX=/frozen/.brain python3 bench/d2q_eval.py
    BRAIN_INDEX=/frozen/.brain python3 bench/d2q_eval.py --sealed bench/frozen/X.json   # ONCE
"""
import argparse, json, os, sys, time
import numpy as np
np.seterr(all="ignore")  # Accelerate matmul raises spurious overflow flags on 0-vectors

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from cards import bench, brain, goldset, qvecs, evaluate, SETS, SEALED, IDX, CACHE, _embed_cached  # noqa: E402


def load_probes(files):
    cache = json.load(open(os.path.join(CACHE, "d2q.json")))
    by_file = {}
    for v in cache.values():
        if v["file"] in files and v["q"]:
            by_file[v["file"]] = v["q"]
    owners, texts = [], []
    for f in sorted(by_file):
        for q in by_file[f]:
            owners.append(f); texts.append(q)
    V = _embed_cached(f"d2q-{len(texts)}", texts)
    return np.asarray(owners), V, len(by_file)


def probe_scores(owners, V, qv):
    s = V @ qv
    out = {}
    for f, x in zip(owners, s):
        if x > out.get(f, -9.0):
            out[f] = float(x)
    return out


def run(qs, gold, db, rows, E, owners, V, kn):
    Q = qvecs([q["q"] for q in qs])
    ranked = []
    for q, qv in zip(qs, Q):
        dense, lex = E @ qv, brain.lexical(db, q["q"])
        probes = probe_scores(owners, V, qv) if kn.get("probe_w") or kn.get("probe_merge") else None
        ranked.append([f for f, _ in brain.rank(rows, dense, lex, 50, E=E, probes=probes, **kn)[0]])
    return evaluate(qs, gold, ranked)


def load_set(name, files):
    qs = [q for q in goldset.load(name) if q.get("hops") != "trap"]
    gold = [bench.resolve_gold(q["gold"], files) for q in qs]
    keep = [i for i, g in enumerate(gold) if g]
    return [qs[i] for i in keep], [gold[i] for i in keep]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sealed")
    a = ap.parse_args()
    db, rows, E = bench.load_index()
    files = {r[1] for r in rows}
    owners, V, nf = load_probes(files)
    print(f"index {IDX}: {len(files)} files; questions for {nf} files, {len(owners)} vectors", flush=True)
    if a.sealed:
        frozen = json.load(open(a.sealed))
        if "frozen_at" not in frozen:
            raise SystemExit("not frozen")
        log = a.sealed + ".sealed-run"
        if os.path.exists(log):
            raise SystemExit(f"already scored once: {log}")
        qs, gold = load_set(SEALED, files)
        r0, h0, m0, b = run(qs, gold, db, rows, E, owners, V, {})
        r1, h1, m1, h = run(qs, gold, db, rows, E, owners, V, frozen["cfg"])
        g = sum(1 for x, y in zip(b, h) if y and not x); l = sum(1 for x, y in zip(b, h) if x and not y)
        out = (f"SEALED n={len(qs)} index={IDX} files={len(files)}\n"
               f"  rrf3+prf (no probes)     r@5 {r0:5.1f}% +/-{h0:4.1f}  MRR {m0:.3f}\n"
               f"  {frozen['name']:24} r@5 {r1:5.1f}% +/-{h1:4.1f}  MRR {m1:.3f}  +{g} -{l}\n"
               f"  run_at {time.strftime('%Y-%m-%dT%H:%M:%S%z')}\n")
        open(log, "w").write(out)
        print(out)
        return
    grid = [("rrf3+prf", {})]
    grid += [(f"probe list w={w}", {"probe_w": w}) for w in (0.15, 0.3, 0.5, 0.7)]
    grid += [("probe merged into best chunk", {"probe_merge": True})]
    # feedback() returns cosines, so a merge with feedback on compares like with like.
    grid += [("rrf3, no feedback", {"prf_b": 0}), ("merged, no feedback", {"probe_merge": True, "prf_b": 0})]
    for sname, fname in SETS.items():
        try:
            qs, gold = load_set(fname, files)
        except SystemExit:
            continue
        print(f"\n{sname} n={len(qs)}", flush=True)
        base = None
        for name, kn in grid:
            r, h, m, hits = run(qs, gold, db, rows, E, owners, V, kn)
            base = base or hits
            g = sum(1 for x, y in zip(base, hits) if y and not x); l = sum(1 for x, y in zip(base, hits) if x and not y)
            print(f"  {name:30} r@5 {r:5.1f}% +/-{h:4.1f}  MRR {m:.3f}  +{g} -{l}", flush=True)


if __name__ == "__main__":
    main()
