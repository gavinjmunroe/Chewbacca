#!/usr/bin/env python3
"""A second embedding model beside nomic, averaged per chunk. DEV sets only.

The September ablation swapped models one at a time and found recall@5 a wash
(RESULTS.md). An ensemble was never tried: two models that miss different
paraphrases could cover each other. Chunk text is the exact string nomic
embedded (path | description, heading, words); mxbai gets its documented
query instruction on the question side.

    BRAIN_INDEX=/frozen/.brain python3 bench/ensemble.py
"""
import json, os, sys, time, urllib.request
import numpy as np
np.seterr(all="ignore")  # Accelerate matmul raises spurious overflow flags on 0-vectors

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from cards import bench, brain, goldset, qvecs, evaluate, file_texts, SETS, SEALED, IDX, CACHE  # noqa: E402

MODEL2 = os.environ.get("ENSEMBLE_MODEL", "mxbai-embed-large")
QPREFIX = {"mxbai-embed-large": "Represent this sentence for searching relevant passages: "}


def embed2(texts):
    out = []
    for i in range(0, len(texts), 32):
        req = urllib.request.Request(brain.OLLAMA + "/api/embed", data=json.dumps(
            {"model": MODEL2, "input": [t[:2000] for t in texts[i:i + 32]], "keep_alive": "10m"}).encode(),
            headers={"Content-Type": "application/json"})
        out.extend(json.loads(urllib.request.urlopen(req, timeout=600).read())["embeddings"])
    V = np.asarray(out, "float32")
    return V / (np.linalg.norm(V, axis=1, keepdims=True) + 1e-9)


def ranked_for(qs, db, rows, E, E2, a):
    Q1 = qvecs([q["q"] for q in qs])
    Q2 = embed2([QPREFIX.get(MODEL2, "") + q["q"] for q in qs])
    out = []
    for q, q1, q2 in zip(qs, Q1, Q2):
        lex = brain.lexical(db, q["q"])
        if a == 0:
            out.append([f for f, _ in brain.rank(rows, E @ q1, lex, 50, E=E)[0]])
        else:
            d = (1 - a) * brain.feedback(E, E @ q1) + a * brain.feedback(E2, E2 @ q2)
            out.append([f for f, _ in brain.rank(rows, d, lex, 50)[0]])
    return out


def sealed(path, db, rows, E, E2):
    """ONE sealed run of a frozen ensemble weight against the shipped ranker."""
    frozen = json.load(open(path))
    if "frozen_at" not in frozen:
        raise SystemExit("not frozen")
    log = path + ".sealed-run"
    if os.path.exists(log):
        raise SystemExit(f"already scored once: {log}")
    files = {r[1] for r in rows}
    qs = [q for q in goldset.load(SEALED) if q.get("hops") != "trap"]
    gold = [bench.resolve_gold(q["gold"], files) for q in qs]
    keep = [i for i, g in enumerate(gold) if g]
    qs, gold = [qs[i] for i in keep], [gold[i] for i in keep]
    r0, h0, m0, b = evaluate(qs, gold, ranked_for(qs, db, rows, E, E2, 0.0))
    r1, h1, m1, h = evaluate(qs, gold, ranked_for(qs, db, rows, E, E2, frozen["weight"]))
    g = sum(1 for x, y in zip(b, h) if y and not x); l = sum(1 for x, y in zip(b, h) if x and not y)
    out = (f"SEALED n={len(qs)} index={IDX} files={len(files)}\n"
           f"  shipped rrf3+feedback    r@5 {r0:5.1f}% +/-{h0:4.1f}  MRR {m0:.3f}\n"
           f"  {frozen['name']:24} r@5 {r1:5.1f}% +/-{h1:4.1f}  MRR {m1:.3f}  +{g} -{l}\n"
           f"  run_at {time.strftime('%Y-%m-%dT%H:%M:%S%z')}\n")
    open(log, "w").write(out)
    print(out)


def main():
    db, rows, E = bench.load_index()
    files = {r[1] for r in rows}
    path = os.path.join(CACHE, f"chunks-{MODEL2}.npy")
    if os.path.exists(path):
        E2 = np.load(path)
    else:
        hdr = {f: f + (f" | {d}" if d else "") for f, d, _ in file_texts(db)}
        texts = [(f"{hdr[f]}\n## {s}\n{brain.clean(t)}" if s else f"{hdr[f]}\n{brain.clean(t)}")[:brain.MAXCHARS]
                 for f, s, t in db.execute("SELECT file, section, text FROM chunk ORDER BY id")]
        t0 = time.time()
        E2 = embed2(texts)
        np.save(path, E2)
        print(f"embedded {len(texts)} with {MODEL2} in {time.time() - t0:.0f}s", flush=True)
    if len(sys.argv) > 2 and sys.argv[1] == "--sealed":
        return sealed(sys.argv[2], db, rows, E, E2)
    grid = [("shipped (nomic)", 0.0), ("ensemble 0.3", 0.3), ("ensemble 0.5", 0.5), (MODEL2 + " only", 1.0)]
    for sname, fname in SETS.items():
        if fname == SEALED:
            raise SystemExit("refusing the sealed set")
        try:
            qs = [q for q in goldset.load(fname) if q.get("hops") != "trap"]
        except SystemExit:
            continue
        gold = [bench.resolve_gold(q["gold"], files) for q in qs]
        keep = [i for i, g in enumerate(gold) if g]
        qs, gold = [qs[i] for i in keep], [gold[i] for i in keep]
        Q1 = qvecs([q["q"] for q in qs])
        Q2 = embed2([QPREFIX.get(MODEL2, "") + q["q"] for q in qs])
        print(f"\n{sname} n={len(qs)}", flush=True)
        base = None
        for name, a in grid:
            ranked = []
            for q, q1, q2 in zip(qs, Q1, Q2):
                lex = brain.lexical(db, q["q"])
                if a == 0:
                    ranked.append([f for f, _ in brain.rank(rows, E @ q1, lex, 50, E=E)[0]])
                    continue
                # Feedback runs on each model's own space, then the cosines average.
                d = (1 - a) * brain.feedback(E, E @ q1) + a * brain.feedback(E2, E2 @ q2)
                ranked.append([f for f, _ in brain.rank(rows, d, lex, 50)[0]])
            r, h, m, hits = evaluate(qs, gold, ranked)
            base = base or hits
            g = sum(1 for x, y in zip(base, hits) if y and not x); l = sum(1 for x, y in zip(base, hits) if x and not y)
            print(f"  {name:24} r@5 {r:5.1f}% +/-{h:4.1f}  MRR {m:.3f}  +{g} -{l}", flush=True)


if __name__ == "__main__":
    main()
