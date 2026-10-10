#!/usr/bin/env python3
"""Sweep the hub-file knobs in src/brain.py on the DEV set, against a live index.

Uses brain.rank() itself, so a number here is the number `brain ask` would
produce. Point BRAIN_INDEX at a copy of ~/second-brain/.brain (index.db plus
its emb-*.npy): the launchd job rewrites the live one every 10 minutes, and a
sweep should not straddle a rebuild.

    python3 bench/hubs.py                 # dev sweep
    python3 bench/hubs.py --sealed CFG    # the sealed 73, ONCE per change

A gold path that has moved since the set was written resolves by basename,
the same rule the 2026-10-09 measurement used.
"""
import argparse, collections, json, math, os, sqlite3, sys, urllib.request
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "src"))
import goldset   # noqa: E402
import brain     # noqa: E402

IDX = os.environ.get("BRAIN_INDEX", os.path.expanduser("~/second-brain/.brain"))
OFF = {"alpha": 0, "folder_cap": 0, "len_b": 0}


def load_index():
    db = sqlite3.connect(f"file:{os.path.join(IDX, 'index.db')}?mode=ro", uri=True)
    rows = db.execute("SELECT id,file,section,text,row FROM chunk ORDER BY id").fetchall()
    npy = dict(db.execute("SELECT k,v FROM meta")).get("npy", "emb.npy")
    return db, rows, np.load(os.path.join(IDX, npy))


_cache = {}
def qvec(q):
    if q not in _cache:
        req = urllib.request.Request(brain.OLLAMA + "/api/embed",
            data=json.dumps({"model": brain.MODEL, "input": [q], "keep_alive": "30m"}).encode(),
            headers={"Content-Type": "application/json"})
        v = np.asarray(json.loads(urllib.request.urlopen(req, timeout=120).read())["embeddings"][0], "float32")
        _cache[q] = v / (np.linalg.norm(v) + 1e-9)
    return _cache[q]


def resolver(files):
    by_base = collections.defaultdict(list)
    for f in files:
        by_base[os.path.basename(f)].append(f)
    def resolve(g):
        if g in files:
            return {g}
        return set(by_base.get(os.path.basename(g), []))
    return resolve


def prepare(qs, db, rows, E):
    resolve = resolver({r[1] for r in rows})
    out = []
    for q in qs:
        gold = set().union(*[resolve(g) for g in q["gold"]]) if q["gold"] else set()
        if gold:
            out.append((q, gold, E @ qvec(q["q"]), brain.lexical(db, q["q"])))
    return out


def evaluate(prepped, rows, k=5, **knobs):
    hit = mrr = 0.0
    hubs = collections.Counter()
    for q, gold, dense, lex in prepped:
        top, _ = brain.rank(rows, dense, lex, 50, **knobs)
        names = [f for f, _ in top]
        if gold & set(names[:k]):
            hit += 1
        else:
            for f in names[:k]:
                hubs[brain.folder(f) or f] += 1
        for i, f in enumerate(names):
            if f in gold:
                mrr += 1 / (i + 1)
                break
    n = len(prepped)
    p = hit / n
    return p * 100, 196 * math.sqrt(p * (1 - p) / n), mrr / n, hubs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sealed", help='json knobs, e.g. {"folder_cap":2}. Run ONCE.')
    ap.add_argument("--misses", action="store_true", help="print what fills the top 5 on a miss")
    a = ap.parse_args()
    db, rows, E = load_index()
    print(f"index {IDX}: {len({r[1] for r in rows})} files, {len(rows)} chunks")
    if a.sealed:
        knobs = dict(OFF, **json.loads(a.sealed))
        qs = [q for q in goldset.load("queries_independent.json") if q.get("hops") != "trap"]
        pp = prepare(qs, db, rows, E)
        for name, kn in [("baseline", OFF), ("chosen " + a.sealed, knobs)]:
            r, h, m, hubs = evaluate(pp, rows, **kn)
            print(f"SEALED n={len(pp)}  {name:40} r@5 {r:5.1f}% +/-{h:4.1f}  MRR {m:.3f}")
            if a.misses:
                for f, c in hubs.most_common(6):
                    print(f"    in top5 on a miss {c:3}  {f}")
        return
    pp = prepare(goldset.load("queries.json"), db, rows, E)
    print(f"dev n={len(pp)}")
    grid = [("baseline", OFF)]
    grid += [(f"chunk-count alpha={x}", dict(OFF, alpha=x)) for x in (0.01, 0.02, 0.03, 0.05, 0.1, 0.2, 0.5, 1.0)]
    grid += [(f"folder cap={c}", dict(OFF, folder_cap=c)) for c in (1, 2, 3)]
    grid += [(f"bm25 length b={b}", dict(OFF, len_b=b)) for b in (0.25, 0.5, 0.75, 1.0)]
    for name, kn in grid:
        r, h, m, hubs = evaluate(pp, rows, **kn)
        print(f"{name:26} r@5 {r:5.1f}% +/-{h:4.1f}  MRR {m:.3f}")
        if a.misses and name == "baseline":
            for f, c in hubs.most_common(8):
                print(f"    in top5 on a miss {c:3}  {f}")


if __name__ == "__main__":
    main()
