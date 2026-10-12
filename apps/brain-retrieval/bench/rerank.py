#!/usr/bin/env python3
"""Second-stage rerank: diagnosis, dev sweep, and one sealed run per frozen config.

Stage one is the shipped retriever, brain.rank() with its shipped constants.
Stage two sends the question plus the top N candidate files (path, description,
best chunks) to a model through src/rerank.py and reorders them.

    BRAIN_INDEX=/frozen/.brain python3 bench/rerank.py diag          # dev misses, recall vs ranking
    BRAIN_INDEX=/frozen/.brain python3 bench/rerank.py audit         # gold labels that no longer resolve
    BRAIN_INDEX=/frozen/.brain python3 bench/rerank.py dev  '{"n":30}'
    BRAIN_INDEX=/frozen/.brain python3 bench/rerank.py dev-api '{"timeout":3}'   # HTTPS path, dev only
    BRAIN_INDEX=/frozen/.brain python3 bench/rerank.py sealed FROZEN.json   # ONCE per frozen file
    BRAIN_INDEX=/frozen/.brain python3 bench/rerank.py replay FROZEN.json   # reproduce it from the cache

The sealed command refuses a config file that is not frozen (no "frozen_at"),
and refuses to run one twice: it appends to a run log beside the frozen file.
"""
import collections, json, math, os, sqlite3, sys, time, urllib.request
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "src"))
import goldset   # noqa: E402
import brain     # noqa: E402
import rerank    # noqa: E402

IDX = os.environ.get("BRAIN_INDEX", os.path.expanduser("~/second-brain/.brain"))
POOL = 50


def load_index():
    db = brain.open_read(os.path.join(IDX, "index.db"))
    rows = db.execute("SELECT id,file,section,text,row FROM chunk ORDER BY id").fetchall()
    npy = dict(db.execute("SELECT k,v FROM meta")).get("npy", "emb.npy")
    return db, rows, np.load(os.path.join(IDX, npy))


_qv = {}
def qvec(q):
    if q not in _qv:
        req = urllib.request.Request(brain.OLLAMA + "/api/embed",
            data=json.dumps({"model": brain.MODEL, "input": [q], "keep_alive": "30m"}).encode(),
            headers={"Content-Type": "application/json"})
        v = np.asarray(json.loads(urllib.request.urlopen(req, timeout=120).read())["embeddings"][0], "float32")
        _qv[q] = v / (np.linalg.norm(v) + 1e-9)
    return _qv[q]


def resolve_gold(gold, files):
    """Exact path, else the same basename anywhere (a moved file), else nothing."""
    by_base = collections.defaultdict(set)
    for f in files:
        by_base[os.path.basename(f)].add(f)
    out = set()
    for g in gold:
        out |= {g} if g in files else by_base.get(os.path.basename(g), set())
    return out


def stage_one(db, rows, E, q, pool=POOL):
    dense = E @ qvec(q)
    top, _ = brain.rank(rows, dense, brain.lexical(db, q), pool)
    return [f for f, _ in top], dense


def prepare(qs, db, rows, E):
    files = {r[1] for r in rows}
    out = []
    for q in qs:
        gold = resolve_gold(q["gold"], files)
        if gold:
            names, dense = stage_one(db, rows, E, q["q"])
            out.append((q, gold, names, dense))
    return out


def score(prepped, ranked, k=5):
    hit = mrr = 0.0
    for (q, gold, _, _), names in zip(prepped, ranked):
        if gold & set(names[:k]):
            hit += 1
        for i, f in enumerate(names[:POOL]):
            if f in gold:
                mrr += 1 / (i + 1)
                break
    n = len(prepped)
    p = hit / n
    return p * 100, 196 * math.sqrt(p * (1 - p) / n), mrr / n


def run_rerank(prepped, rows, dense_cfg, fn=None):
    fn = fn or rerank.rerank
    ranked, secs = [], []
    for q, gold, names, dense in prepped:
        t = time.time()
        r = fn(q["q"], names, rows, dense, **dense_cfg)
        if not r.ok:
            print(f"  fallback {r.reason} after {time.time() - t:.1f}s")
        secs.append(time.time() - t)
        ranked.append(r.files)
    return ranked, secs


def cmd_diag(db, rows, E, setname="queries.json"):
    pp = prepare(goldset.load(setname), db, rows, E)
    base = [n for _, _, n, _ in pp]
    r, h, m = score(pp, base)
    print(f"{setname} n={len(pp)}  shipped r@5 {r:.1f}% +/-{h:.1f}  MRR {m:.3f}")
    split = collections.Counter()
    for (q, gold, names, _), _n in zip(pp, base):
        pos = min((names.index(g) for g in gold if g in names), default=None)
        if pos is not None and pos < 5:
            continue
        kind = "ranking(6-50)" if pos is not None else "recall(>50)"
        split[kind] += 1
        print(f"  MISS {kind:14} gold@{'-' if pos is None else pos+1:>3}  {q['q'][:70]}")
        print(f"       gold {sorted(gold)}")
        print(f"       top3 {names[:3]}")
    print(dict(split))


def cmd_audit(db, rows):
    files = {r[1] for r in rows}
    for name in ("queries.json", "queries_independent.json"):
        for q in goldset.load(name):
            for g in q["gold"]:
                if g in files:
                    continue
                moved = resolve_gold([g], files)
                disk = os.path.exists(os.path.join(brain.BRAIN, g))
                print(f"{name:26} {'MOVED->' + ','.join(sorted(moved)) if moved else 'GONE'}"
                      f"{' (on disk, not indexed)' if disk else ''}  {g}")


def cmd_dev(db, rows, E, cfg, fn=None):
    pp = prepare(goldset.load("queries.json"), db, rows, E)
    r0, h0, m0 = score(pp, [n for _, _, n, _ in pp])
    ranked, secs = run_rerank(pp, rows, cfg, fn)
    r, h, m = score(pp, ranked)
    print(f"dev n={len(pp)}  shipped  r@5 {r0:5.1f}% +/-{h0:4.1f}  MRR {m0:.3f}")
    print(f"dev n={len(pp)}  rerank {json.dumps(cfg)}  r@5 {r:5.1f}% +/-{h:4.1f}  MRR {m:.3f}"
          f"  p50 {np.median(secs):.1f}s max {max(secs):.1f}s")
    for (q, gold, base, _), new in zip(pp, ranked):
        b, a = bool(gold & set(base[:5])), bool(gold & set(new[:5]))
        if b != a or not a:
            print(f"  {'GAIN' if a else 'LOSS' if b else 'miss'}  {q['q'][:70]}")


def cmd_sealed(db, rows, E, path):
    frozen = json.load(open(path))
    if "frozen_at" not in frozen:
        raise SystemExit("not frozen: write frozen_at before a sealed run")
    log = path + ".sealed-run"
    if os.path.exists(log):
        raise SystemExit(f"already scored once: {log}")
    qs = [q for q in goldset.load("queries_independent.json") if q.get("hops") != "trap"]
    pp = prepare(qs, db, rows, E)
    r0, h0, m0 = score(pp, [n for _, _, n, _ in pp])
    ranked, secs = run_rerank(pp, rows, frozen["cfg"])
    r, h, m = score(pp, ranked)
    out = (f"SEALED n={len(pp)} index={IDX}\n"
           f"  shipped            r@5 {r0:5.1f}% +/-{h0:4.1f}  MRR {m0:.3f}\n"
           f"  {path}  r@5 {r:5.1f}% +/-{h:4.1f}  MRR {m:.3f}  p50 {np.median(secs):.1f}s"
           f"  p90 {np.percentile(secs, 90):.1f}s\n  run_at {time.strftime('%Y-%m-%dT%H:%M:%S%z')}\n")
    open(log, "w").write(out)
    print(out)


def cmd_replay(db, rows, E, path):
    """Re-score a sealed run from the cached rankings, with no model call.

    The cache keys on the exact prompt, so the same index, gold set and
    rerank.py rebuild the same keys and the sealed number comes back. A miss
    means one of those changed: it counts as a fallback and the replay says
    it is not a reproduction, rather than quietly asking the model again.
    """
    frozen = json.load(open(path))
    want = open(path + ".sealed-run").read() if os.path.exists(path + ".sealed-run") else ""
    rerank.CLAUDE = "false"
    qs = [q for q in goldset.load("queries_independent.json") if q.get("hops") != "trap"]
    pp = prepare(qs, db, rows, E)
    r0, h0, m0 = score(pp, [n for _, _, n, _ in pp])
    misses = 0
    ranked = []
    for q, gold, names, dense in pp:
        res = rerank.rerank(q["q"], names, rows, dense, **dict(frozen["cfg"], timeout=5))
        misses += not res.cached
        ranked.append(res.files)
    r, h, m = score(pp, ranked)
    print(f"REPLAY n={len(pp)} index={IDX}\n"
          f"  shipped            r@5 {r0:5.1f}% +/-{h0:4.1f}  MRR {m0:.3f}\n"
          f"  {path}  r@5 {r:5.1f}% +/-{h:4.1f}  MRR {m:.3f}  cache misses {misses}")
    if want:
        print("sealed said:\n" + want.rstrip())
    if misses:
        raise SystemExit(f"not a reproduction: {misses} of {len(pp)} rankings were not in the cache")


def main():
    cmd = sys.argv[1]
    db, rows, E = load_index()
    print(f"index {IDX}: {len({r[1] for r in rows})} files, {len(rows)} chunks")
    if cmd == "diag":
        cmd_diag(db, rows, E, *(sys.argv[2:3]))
    elif cmd == "audit":
        cmd_audit(db, rows)
    elif cmd == "dev":
        cmd_dev(db, rows, E, json.loads(sys.argv[2]) if len(sys.argv) > 2 else {})
    elif cmd == "dev-api":   # the HTTPS path, src/rerank_api.py. Dev only.
        import rerank_api
        cmd_dev(db, rows, E, json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}, rerank_api.rerank)
    elif cmd == "sealed":
        cmd_sealed(db, rows, E, sys.argv[2])
    elif cmd == "replay":
        cmd_replay(db, rows, E, sys.argv[2])


if __name__ == "__main__":
    main()
