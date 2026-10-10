#!/usr/bin/env python3
"""Lone hub files: three ideas, swept on the DEV set against a frozen index.

The folder cap (2026-10-10) stops a domains/<x> subfolder holding more than one
top-5 slot, but long single files directly under domains/ are not in a folder,
and on the sealed set they took the slots the cap freed. This compares three
materially different fixes, each on top of the shipped folder cap:

  agg      score a file by its best chunks (max, or mean of the top m), not the
           mean over every chunk, so many weak hits cannot add up
  section  rank (file, heading) sections, a file scores as its best section
  hub      a per-file prior from hubness measured on the corpus itself: how
           often a file lands in other files' nearest-neighbour lists
           (k-occurrence, chunk space), how often it reaches the top 5 for
           query-shaped probes it is not the source of (headings, file slugs),
           and CSLS, which subtracts each chunk's mean similarity to its own
           neighbours
  lone     a cap on top-level domains/*.md files taken together

Every variant calls brain.rank() so the number is what `brain ask` would give.

    BRAIN_INDEX=/path/to/frozen/.brain python3 bench/lone.py
    BRAIN_INDEX=... python3 bench/lone.py --sealed '{"prior":"slugs","hub_beta":0.1}'   # ONCE
"""
import argparse, collections, json, os, re, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hubs      # noqa: E402  (index loading, query vectors, gold resolution)
import goldset   # noqa: E402
brain = hubs.brain

SHIPPED = {"folder_cap": 1}


def hub_prior(rows, E, k=10):
    """Hubness measured on the corpus itself, for the bench's hub knobs.

    kocc maps each file to its k-occurrence over the mean: every chunk acts as
    a pseudo-query, ranks the other files by mean cosine, and each of its top k
    files gets a vote weighted 1/chunks(own file), so a long file does not get
    more votes just by being long. r is CSLS's per-chunk neighbourhood density,
    the mean cosine to its k nearest chunks in other files. Costs one 3,805^2
    matmul, about a second, so it is not run per ask."""
    files = sorted({r[1] for r in rows})
    fid = {f: i for i, f in enumerate(files)}
    ri = np.asarray([r[4] for r in rows]); fi = np.asarray([fid[r[1]] for r in rows])
    X = E[ri]
    S = X @ X.T
    cnt = np.bincount(fi, minlength=len(files)).astype("float32")
    M = np.zeros((len(rows), len(files)), "float32"); M[np.arange(len(rows)), fi] = 1
    F = (S @ M) / cnt                                   # chunk x file mean cosine
    F[np.arange(len(rows)), fi] = -np.inf
    top = np.argpartition(-F, k, axis=1)[:, :k]
    votes = np.zeros(len(files))
    np.add.at(votes, top.ravel(), np.repeat(1.0 / cnt[fi], k))
    kocc = {f: votes[i] / votes.mean() for f, i in fid.items()}
    same = fi[:, None] == fi[None, :]
    S[same] = -np.inf
    r = np.sort(np.partition(-S, k, axis=1)[:, :k], axis=1)
    rx = np.zeros(E.shape[0], "float32"); rx[ri] = (-r).mean(axis=1)
    return {"kocc": kocc, "r": rx}


def probes(rows, kind):
    """Query-shaped probes drawn from the corpus, each with the files it must
    not vote for (its own source). headings: every distinct section heading.
    slugs: every file's name turned into words."""
    if kind == "headings":
        src = collections.defaultdict(set)
        for r in rows:
            if r[2].strip():
                src[r[2].strip()].add(r[1])
        return sorted(src.items())
    out = []
    for f in sorted({r[1] for r in rows}):
        words = re.sub(r"[_\-.]+", " ", os.path.splitext(os.path.basename(f))[0]).strip()
        if len(words.split()) >= 2:
            out.append((words, {f}))
    return out


def probe_prior(db, rows, E, kind, k=5):
    """Hubness in query space: how often each file reaches the shipped top k
    for a probe it is not the source of, over the mean. Uses brain.rank()."""
    ps = probes(rows, kind)
    vecs = np.asarray(brain.embed([q for q, _ in ps]), "float32")
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-9
    votes = collections.Counter()
    for (q, own), v in zip(ps, vecs):
        top, _ = brain.rank(rows, E @ v, brain.lexical(db, q), k + len(own), **SHIPPED)
        for f in [f for f, _ in top if f not in own][:k]:
            votes[f] += 1
    files = {r[1] for r in rows}
    mean = sum(votes.values()) / len(files)
    return {f: votes[f] / mean for f in files}, len(ps)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sealed", help="json knobs for the chosen variant. Run ONCE.")
    ap.add_argument("--misses", action="store_true")
    a = ap.parse_args()
    db, rows, E = hubs.load_index()
    print(f"index {hubs.IDX}: {len({r[1] for r in rows})} files, {len(rows)} chunks")
    prior = hub_prior(rows, E)
    pri = {"corpus": prior}
    for kind in ("headings", "slugs"):
        kocc, n = probe_prior(db, rows, E, kind)
        pri[kind] = {"kocc": kocc, "r": prior["r"]}
        print(f"probe prior {kind}: {n} probes")
    def run(pp, name, kn):
        kn = dict(kn); hub = pri[kn.pop("prior", "corpus")]
        r, h, m, hb = hubs.evaluate(pp, rows, hub=hub, **kn)
        print(f"{name:34} r@5 {r:5.1f}% +/-{h:4.1f}  MRR {m:.3f}")
        if a.misses:
            for f, c in hb.most_common(6):
                print(f"    in top5 on a miss {c:3}  {f}")
    if a.sealed:
        kn = dict(SHIPPED, **json.loads(a.sealed))
        qs = [q for q in goldset.load("queries_independent.json") if q.get("hops") != "trap"]
        pp = hubs.prepare(qs, db, rows, E)
        print(f"SEALED n={len(pp)}")
        run(pp, "shipped (folder cap 1)", SHIPPED)
        run(pp, "chosen " + a.sealed, kn)
        return
    pp = hubs.prepare(goldset.load("queries.json"), db, rows, E)
    print(f"dev n={len(pp)}")
    grid = [("shipped (folder cap 1)", SHIPPED)]
    grid += [(f"(a) best chunks top_m={m}", dict(SHIPPED, top_m=m)) for m in (1, 2, 3, 5)]
    grid += [("(b) section unit", dict(SHIPPED, unit="section"))]
    grid += [(f"(b) section, top_m={m}", dict(SHIPPED, unit="section", top_m=m)) for m in (1, 3)]
    grid += [(f"(c) k-occurrence beta={b}", dict(SHIPPED, hub_beta=b))
             for b in (0.05, 0.1, 0.2, 0.3, 0.5, 1.0)]
    grid += [(f"(c) CSLS gamma={g}", dict(SHIPPED, csls=g)) for g in (0.25, 0.5, 1.0)]
    for kind in ("headings", "slugs"):
        grid += [(f"(c) {kind} k-occ beta={b}", dict(SHIPPED, prior=kind, hub_beta=b))
                 for b in (0.05, 0.1, 0.2, 0.3, 0.5, 1.0)]
    grid += [(f"(d) lone-file cap={c}", dict(SHIPPED, lone_cap=c)) for c in (1, 2)]
    for name, kn in grid:
        run(pp, name, kn)


if __name__ == "__main__":
    main()
