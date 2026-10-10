#!/usr/bin/env python3
"""brain-rerank: `brain ask`, with a model reordering the top candidates.

Same arguments and the same output as `brain ask`, so anything that parses one
parses the other. The header gains `rerank=ok`, `rerank=cached` or
`rerank=fallback(<reason>)`. On any model failure or when the budget runs out
the answer is exactly what `brain ask` would have printed.

    brain-rerank ask "what did my mentor say about loneliness"
    brain-rerank ask "..." --budget 3      # the hook's limit: fall back past 3s

Measured 2026-10-10 (findings/RESULTS.md): sealed recall@5 55.4% -> see the
rerank section. A `claude -p` call costs about 10s wall at load ~14, most of it
CLI start-up, so under a 3s budget only cached questions get the rerank.
"""
import argparse, os, sqlite3, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
import brain    # noqa: E402
import rerank   # noqa: E402

POOL = 30   # candidates the model reads. Frozen config A, findings/RESULTS.md.


def ask(args):
    if not os.path.exists(brain.DB):
        brain.die("no index. run: brain index", 2)
    db = sqlite3.connect(f"file:{brain.DB}?mode=ro", uri=True, isolation_level=None)
    db.execute("BEGIN")
    rows = db.execute("SELECT id,file,section,text,row FROM chunk ORDER BY id").fetchall()
    E = np.load(brain.npy_path(db))
    db.execute("COMMIT")
    degraded, dense = None, None
    try:
        q = np.asarray(brain._post({"model": brain.MODEL, "input": [args.query],
                                    "keep_alive": brain.KEEP_ALIVE}, brain.EMBED_TIMEOUT)[0],
                       dtype="float32")
        if np.linalg.norm(q) < 1e-6:
            raise ValueError("zero vector")
        dense = E @ (q / np.linalg.norm(q))
    except Exception as e:
        degraded = brain.classify(e)
        if degraded == "embed_timeout":
            brain.spawn_warm()
    lex = brain.lexical(db, args.query)
    pool, dv = brain.rank(rows, dense, lex, max(POOL, args.k))
    names = [f for f, _ in pool]
    score = dict(pool)
    note = "rerank=off(lexical)"
    if dense is not None and names:
        r = rerank.rerank(args.query, names, rows, dense, n=POOL, timeout=args.budget)
        names = r.files
        note = ("rerank=cached" if r.cached else "rerank=ok") if r.ok else f"rerank=fallback({r.reason})"
    top_cos = max(dv.values()) if dv else 0.0
    st = brain.stale_files(db)
    print(f"# brain mode={'hybrid' if dense is not None else 'lexical'}"
          f"{' degraded=' + degraded if degraded else ''} {note}"
          f" files={len({r[1] for r in rows})} chunks={len(rows)}"
          f"{' index=STALE(' + str(len(st)) + ')' if st else ''}")
    if dense is not None and top_cos < brain.ABSTAIN:
        print(f"# top cosine {top_cos:.3f} is below the abstain threshold {brain.ABSTAIN}.")
        print("# Nothing in the brain answers this. Say so rather than guessing.")
        return
    best = {}
    for r in rows:
        s = float(dense[r[4]]) if dense is not None else lex.get(r[0], 0.0)
        if r[1] not in best or s > best[r[1]][0]:
            best[r[1]] = (s, r[2], r[3])
    for i, f in enumerate(names[:args.k], 1):
        s, sec, txt = best.get(f, (0, "", ""))
        flag = " [stale]" if f in st else ""
        print(f"\n[{i}] {f}{('#' + sec) if sec else ''} cos={s:.2f}{flag}")
        print("    " + " ".join(txt.split())[:args.width])


def main():
    p = argparse.ArgumentParser(prog="brain-rerank")
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("ask")
    a.add_argument("query")
    a.add_argument("--k", type=int, default=5)
    a.add_argument("--width", type=int, default=300)
    a.add_argument("--budget", type=float, default=float(os.environ.get("BRAIN_RERANK_BUDGET", "60")),
                   help="seconds the model may take before the stage-one order stands")
    a.set_defaults(fn=ask)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
