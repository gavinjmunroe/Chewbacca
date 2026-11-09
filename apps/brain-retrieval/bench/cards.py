#!/usr/bin/env python3
"""Step 14 sweep, 2026-10-12 night: approaches that are not another hub knob.

The sealed gap, per dev2 (findings in TODO.md): questions phrased without the
note's own words. Every variant here runs on the DEV sets only (queries.json,
queries_dev2.json, queries_dev3.json); the sealed file is refused.

Variants, each on top of the shipped ranker (folder cap 1):
  card     one extra vector per file from its name, description and headings,
           blended into the file's dense score: (1-c)*mean chunk + c*card
  prefix   nomic's own task prefixes on both sides ("search_document: " on
           every chunk, "search_query: " on the question). Never tested on the
           document side before (RESULTS.md, tuning sweep)
  rrf      reciprocal-rank fusion of the dense and lexical file lists instead
           of min-max score fusion
  prf      pseudo-relevance feedback: the query vector moves toward its top
           chunks, q + b * mean(top m), and ranks again

    BRAIN_INDEX=/frozen/.brain python3 bench/cards.py              # every dev set present
    BRAIN_INDEX=/frozen/.brain python3 bench/cards.py --misses dev3
"""
import argparse, collections, json, os, sys, time
import numpy as np
np.seterr(all="ignore")  # Accelerate matmul raises spurious overflow flags on 0-vectors

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "src"))
import goldset   # noqa: E402
import brain     # noqa: E402
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location("bench_rerank", os.path.join(HERE, "rerank.py"))
bench = importlib.util.module_from_spec(_spec)   # bench/rerank.py: index loading, gold resolution.
_spec.loader.exec_module(bench)                  # By path: src/rerank.py shares its name.

SEALED = "queries_independent.json"
SETS = {"dev": "queries.json", "dev2": "queries_dev2.json", "dev3": "queries_dev3.json"}
IDX = bench.IDX
CACHE = os.path.join(IDX, "bench-cache")


def _embed_cached(name, texts):
    """Vectors for texts, cached on disk next to the frozen index by name."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name + ".npy")
    if os.path.exists(path):
        V = np.load(path)
        if V.shape[0] == len(texts):
            return V
    t = time.time()
    V = np.asarray(brain.embed(texts), "float32")
    V /= np.linalg.norm(V, axis=1, keepdims=True) + 1e-9
    np.save(path, V)
    print(f"  embedded {len(texts)} for {name} in {time.time() - t:.0f}s", flush=True)
    return V


_q = {}
def qvecs(qs, prefix=""):
    key = [prefix + q for q in qs]
    miss = [k for k in key if k not in _q]
    if miss:
        V = np.asarray(brain.embed(miss), "float32")
        V /= np.linalg.norm(V, axis=1, keepdims=True) + 1e-9
        _q.update(zip(miss, V))
    return [_q[k] for k in key]


def file_texts(db):
    """Per file: its label, frontmatter description and headings, from disk."""
    files = sorted({r[0] for r in db.execute("SELECT file FROM chunk")})
    heads = collections.defaultdict(list)
    for f, sec in db.execute("SELECT file, section FROM chunk ORDER BY id"):
        if sec and sec not in heads[f]:
            heads[f].append(sec)
    out = []
    for f in files:
        p = os.path.expanduser(f) if f.startswith("~") else os.path.join(brain.BRAIN, f)
        try:
            fm, _ = brain.frontmatter(open(p, encoding="utf-8", errors="replace").read())
        except OSError:
            fm = {}
        out.append((f, fm.get("description", ""), heads[f]))
    return out


STOP = set("""about above after again against all also and any are because been before being
below between both but can could did does doing done down during each else ever every few for from
further get got had has have having her here hers him his how into its itself just know like made
make many may more most much must myself need never not now off once only other our ours out over
own said same say says she should since some still such than that the their them then there these
they thing things this those through too under until upon very want was way we were what when where
which while who whom why will with would yet you your yours tell said told anything something""".split())


def lexical_stop(db, query):
    """brain.lexical() with English function words dropped from the OR query.
    Shipped lexical ORs every 3+ letter word, so "what did ... say about" matched
    nearly every chunk and min-max spread that noise across the whole 0..1 range."""
    import re
    words = [w for w in re.findall(r"[A-Za-z]{3,}", query) if w.lower() not in STOP]
    return brain.lexical(db, " ".join(words)) if words else {}


def card_text(f, desc, heads):
    name = os.path.splitext(os.path.basename(f))[0].replace("_", " ").replace("-", " ")
    return "\n".join(x for x in (f, name, desc, "; ".join(heads[:20])) if x)[:brain.MAXCHARS]


def fused(rows, dense, lex, k, card=None, c=0.0, rrf=0, folder_cap=1, w=None, lexmax=False,
          maxmix=0.0, rrf3=0):
    """brain.rank()'s fusion and folder cap, plus the card blend and RRF.
    With c=0 and rrf=0 it must equal brain.rank(); main() checks that."""
    du = brain.agg_by_file([(r[1], float(dense[r[4]])) for r in rows])
    if maxmix or rrf3:
        mx = {}
        for r in rows:
            v = float(dense[r[4]])
            if v > mx.get(r[1], -9):
                mx[r[1]] = v
    if maxmix:
        du = {f: (1 - maxmix) * s + maxmix * mx[f] for f, s in du.items()}
    if c and card is not None:
        du = {f: (1 - c) * s + c * card.get(f, s) for f, s in du.items()}
    if lexmax:
        lu = {}
        for r in rows:
            v = lex.get(r[0], 0.0)
            if v > lu.get(r[1], 0.0):
                lu[r[1]] = v
        lu = {r[1]: lu.get(r[1], 0.0) for r in rows}
    else:
        lu = brain.agg_by_file([(r[1], lex.get(r[0], 0.0)) for r in rows])
    if rrf3:
        ranks = brain._ranks
        a, b, l = ranks(du), ranks(mx), ranks(lu)
        w = brain.W_DENSE if w is None else w
        score = {f: w * (0.5 / (rrf3 + a[f]) + 0.5 / (rrf3 + b[f])) + (1 - w) / (rrf3 + l.get(f, len(l))) for f in du}
    elif rrf:
        dr, lr = brain._ranks(du), brain._ranks(lu)
        w = brain.W_DENSE if w is None else w
        score = {f: w / (rrf + dr[f]) + (1 - w) / (rrf + lr.get(f, len(lr))) for f in du}
    else:
        dvn, lvn = brain.norm(du), brain.norm(lu)
        w = brain.W_DENSE if w is None else w
        score = {f: w * dvn.get(f, 0) + (1 - w) * lvn.get(f, 0) for f in set(dvn) | set(lvn)}
    ordered = sorted(score.items(), key=lambda kv: (-kv[1], kv[0]))
    out, per = [], collections.Counter()
    for f, s in ordered:
        g = brain.folder(f) if folder_cap else None
        if g is not None and per[g] >= folder_cap:
            continue
        if g is not None:
            per[g] += 1
        out.append(f)
        if len(out) == k:
            break
    return out


def evaluate(qs, gold, ranked, k=5):
    hit = mrr = 0.0
    for g, names in zip(gold, ranked):
        if g & set(names[:k]):
            hit += 1
        mrr += next((1 / (i + 1) for i, f in enumerate(names) if f in g), 0)
    n = len(gold)
    p = hit / n
    return 100 * p, 196 * (p * (1 - p) / n) ** 0.5, mrr / n, [bool(g & set(r[:k])) for g, r in zip(gold, ranked)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--misses", help="print misses of the best variant on this set")
    ap.add_argument("--only", help="variant names to run, separated by |")
    ap.add_argument("--sealed", help="a frozen config (bench/frozen/*.json): score the shipped "
                    "brain.rank() against the old minmax fusion on the sealed set, ONCE")
    a = ap.parse_args()
    if a.sealed:
        return sealed(a.sealed)
    db, rows, E = bench.load_index()
    files = {r[1] for r in rows}
    print(f"index {IDX}: {len(files)} files, {len(rows)} chunks", flush=True)

    ft = file_texts(db)
    C = _embed_cached("cards", [card_text(*x) for x in ft])
    cidx = {f: i for i, (f, _, _) in enumerate(ft)}
    have_prefix = os.environ.get("CARDS_PREFIX", "1") == "1"
    if have_prefix:
        chunks = db.execute("SELECT file, section, text FROM chunk ORDER BY id").fetchall()
        hdr = {}
        for f, d, _ in ft:
            hdr[f] = f + (f" | {d}" if d else "")
        texts = [("search_document: " + (f"{hdr[f]}\n## {s}\n{brain.clean(t)}" if s else f"{hdr[f]}\n{brain.clean(t)}"))[:brain.MAXCHARS]
                 for f, s, t in chunks]
        EP = _embed_cached("chunks-docprefix", texts)
        CP = _embed_cached("cards-docprefix", ["search_document: " + card_text(*x) for x in ft])

    variants = [("shipped", {})]
    variants += [(f"card c={c}", {"c": c}) for c in (0.15, 0.3, 0.45, 0.6)]
    variants += [(f"rrf k={k}", {"rrf": k}) for k in (10, 30, 60)]
    variants += [(f"maxmix a={a}", {"maxmix": a}) for a in (0.15, 0.3, 0.5)]
    variants += [(f"maxmix a={a} rrf k=10", {"maxmix": a, "rrf": 10}) for a in (0.15, 0.3, 0.5)]
    variants += [(f"rrf3 k={k}", {"rrf3": k}) for k in (5, 10, 20)]
    for k in (10, 20):
        for c in (0, 0.15, 0.3):
            for pr in (None, (0.3, 5), (0.6, 5)):
                if c or pr:
                    kn = {"rrf3": k}
                    if c: kn["c"] = c
                    if pr: kn["prf"] = pr
                    variants.append((f"rrf3 k={k} c={c} prf={pr}", kn))
    variants += [("dense only", {"w": 1.0}), ("lexmax", {"lexmax": True}), ("lexmax+stop", {"lexmax": True, "stop": True})]
    variants += [(f"lexmax+stop w={w}", {"lexmax": True, "stop": True, "w": w}) for w in (0.5, 0.8)]
    variants += [(f"lexmax+stop+rrf k={k}", {"lexmax": True, "stop": True, "rrf": k}) for k in (5, 10, 20)]
    variants += [("stop", {"stop": True}), ("stop+rrf k=10", {"stop": True, "rrf": 10})]
    variants += [(f"stop w={w}", {"stop": True, "w": w}) for w in (0.5, 0.6, 0.8)]
    variants += [(f"rrf k={k} w={w}", {"rrf": k, "w": w}) for k in (3, 5, 10, 20) for w in (0.5, 0.6, 0.8)]
    variants += [(f"prf b={b} m={m}", {"prf": (b, m)}) for b in (0.3, 0.6) for m in (5, 10)]
    if have_prefix:
        variants += [("prefix", {"prefix": True})]
        variants += [(f"prefix+card c={c}", {"prefix": True, "c": c}) for c in (0.15, 0.3, 0.45)]
    if a.only:
        keep = set(a.only.split("|"))
        variants = [v for v in variants if v[0] in keep or v[0] == "shipped"]

    results = collections.defaultdict(dict)
    for sname, fname in SETS.items():
        if fname == SEALED:
            raise SystemExit("refusing the sealed set")
        try:
            qs = goldset.load(fname)
        except SystemExit:
            continue
        qs = [q for q in qs if q.get("hops") != "trap"]
        gold = [bench.resolve_gold(q["gold"], files) for q in qs]
        keep = [i for i, g in enumerate(gold) if g]
        qs, gold = [qs[i] for i in keep], [gold[i] for i in keep]
        Q = qvecs([q["q"] for q in qs])
        QP = qvecs([q["q"] for q in qs], "search_query: ") if have_prefix else None
        lexes = [brain.lexical(db, q["q"]) for q in qs]
        lexes_s = [lexical_stop(db, q["q"]) for q in qs]
        print(f"\n{sname} n={len(qs)}", flush=True)
        base = None
        for vname, kn in variants:
            ranked = []
            for i, q in enumerate(qs):
                M, Cm, qv = (EP, CP, QP[i]) if kn.get("prefix") else (E, C, Q[i])
                if kn.get("prf"):
                    b, m = kn["prf"]
                    d0 = M @ qv
                    top = np.argsort(-d0)[:m]
                    qv = qv + b * M[top].mean(axis=0)
                    qv = qv / (np.linalg.norm(qv) + 1e-9)
                dense = M @ qv
                card = None
                if kn.get("c"):
                    cs = Cm @ qv
                    card = {f: float(cs[cidx[f]]) for f in cidx}
                ranked.append(fused(rows, dense, (lexes_s if kn.get("stop") else lexes)[i], 50, card, kn.get("c", 0), kn.get("rrf", 0), w=kn.get("w"), lexmax=kn.get("lexmax", False),
                                      maxmix=kn.get("maxmix", 0.0), rrf3=kn.get("rrf3", 0)))
            if vname == "shipped":
                ship = [[f for f, _ in brain.rank(rows, E @ Q[i], lexes[i], 50, fusion="minmax")[0]]
                        for i in range(len(qs))]
                assert ship == ranked, "fused() drifted from brain.rank()"
            r, h, m, hits = evaluate(qs, gold, ranked)
            if base is None:
                base = hits
            gain = sum(1 for x, y in zip(base, hits) if y and not x)
            loss = sum(1 for x, y in zip(base, hits) if x and not y)
            results[sname][vname] = (r, m)
            print(f"  {vname:22} r@5 {r:5.1f}% +/-{h:4.1f}  MRR {m:.3f}  +{gain} -{loss}", flush=True)
            if a.misses == sname and vname == (a.only or "shipped").split("|")[-1]:
                for q, g, rk, ok in zip(qs, gold, ranked, hits):
                    if not ok:
                        pos = next((i + 1 for i, f in enumerate(rk) if f in g), None)
                        print(f"    MISS gold@{pos}  {q['q'][:90]}\n      gold {sorted(g)}\n      top3 {rk[:3]}")
    json.dump(results, open(os.path.join(CACHE, "results.json"), "w"), indent=1)


def sealed(path):
    """One sealed run of brain.rank() as shipped (rrf3 + feedback) against the
    fusion it replaced, same index. Prints aggregates only, appends nothing but
    aggregates to PATH.sealed-run, and refuses a second run."""
    frozen = json.load(open(path))
    if "frozen_at" not in frozen:
        raise SystemExit("not frozen: write frozen_at before a sealed run")
    log = path + ".sealed-run"
    if os.path.exists(log):
        raise SystemExit(f"already scored once: {log}")
    db, rows, E = bench.load_index()
    files = {r[1] for r in rows}
    qs = [q for q in goldset.load(SEALED) if q.get("hops") != "trap"]
    gold = [bench.resolve_gold(q["gold"], files) for q in qs]
    keep = [i for i, g in enumerate(gold) if g]
    qs, gold = [qs[i] for i in keep], [gold[i] for i in keep]
    Q = qvecs([q["q"] for q in qs])
    old, new = [], []
    for q, qv in zip(qs, Q):
        lex, dense = brain.lexical(db, q["q"]), E @ qv
        old.append([f for f, _ in brain.rank(rows, dense, lex, 50, fusion="minmax")[0]])
        new.append([f for f, _ in brain.rank(rows, dense, lex, 50, E=E)[0]])
    r0, h0, m0, b = evaluate(qs, gold, old)
    r1, h1, m1, h = evaluate(qs, gold, new)
    gain = sum(1 for x, y in zip(b, h) if y and not x)
    loss = sum(1 for x, y in zip(b, h) if x and not y)
    out = (f"SEALED n={len(qs)} index={IDX} files={len(files)} chunks={len(rows)}\n"
           f"  minmax (shipped before)  r@5 {r0:5.1f}% +/-{h0:4.1f}  MRR {m0:.3f}\n"
           f"  {frozen['name']:24} r@5 {r1:5.1f}% +/-{h1:4.1f}  MRR {m1:.3f}  +{gain} -{loss}\n"
           f"  run_at {time.strftime('%Y-%m-%dT%H:%M:%S%z')}\n")
    open(log, "w").write(out)
    print(out)


if __name__ == "__main__":
    main()
