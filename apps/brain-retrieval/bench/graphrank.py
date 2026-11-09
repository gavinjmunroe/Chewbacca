#!/usr/bin/env python3
"""Graph retrieval over the second-brain corpus.

Scoring is copied verbatim from eval.py (recall@5 = any gold in top 5,
MRR = 1/rank of first gold within top 50) so the numbers are comparable.

Adds two metrics eval.py does not have:
  all@5  every gold file in the top 5, the only metric that can see a JOIN
  n_join the subset of queries with 2+ gold files

Run:  python3 graphrank.py
"""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import goldset
import os, re, json, math, collections, time, urllib.request, itertools
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = "nomic-embed-text"
K = 5

chunks = json.load(open(f"{HERE}/chunks.json"))
E = np.load(f"{HERE}/emb.npy")
queries = goldset.load("queries.json")
files = [c["file"] for c in chunks]
ALL_FILES = sorted(set(files))

# ---------------------------------------------------------------- eval.py verbatim
STOP = set("what who why how when where which the a an is are was were do does did i my me "
           "about that this it to of in on for and or but if my mine should could would can "
           "keep keeps just like so not no yes im its".split())


def terms(q):
    return [w for w in re.findall(r"[a-z]+", q.lower()) if w not in STOP and len(w) > 2]


def dedupe(seq):
    seen = []
    for f in seq:
        if f not in seen:
            seen.append(f)
    return seen


tok = [terms(c["embed_text"]) for c in chunks]
df = collections.Counter()
for t in tok:
    df.update(set(t))
N = len(tok)
avgdl = sum(len(t) for t in tok) / N
tf = [collections.Counter(t) for t in tok]


def bm25_rank(q, k1=1.5, b=0.75):
    qs = terms(q)
    sc = np.zeros(N)
    for w in qs:
        if w not in df:
            continue
        idf = math.log(1 + (N - df[w] + .5) / (df[w] + .5))
        for i in range(N):
            f = tf[i].get(w, 0)
            if f:
                sc[i] += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * len(tok[i]) / avgdl))
    return dedupe([files[i] for i in np.argsort(-sc)[:200]]), sc


def rrf(lists, k=60):
    sc = collections.Counter()
    for L in lists:
        for r, f in enumerate(L):
            sc[f] += 1 / (k + r + 1)
    return [f for f, _ in sc.most_common(50)]


def score(ranked, gold, k=K):
    top = ranked[:k]
    hit = any(g in top for g in gold)
    mrr = 0.0
    for r, f in enumerate(ranked[:50]):
        if f in gold:
            mrr = 1 / (r + 1)
            break
    allg = all(g in top for g in gold)
    return hit, mrr, allg


# ---------------------------------------------------------------- embeddings (cached)
def embed(t):
    req = urllib.request.Request("http://localhost:11434/api/embeddings",
                                 data=json.dumps({"model": MODEL, "prompt": t}).encode(),
                                 headers={"Content-Type": "application/json"})
    v = np.array(json.loads(urllib.request.urlopen(req, timeout=60).read())["embedding"], dtype="float32")
    return v / (np.linalg.norm(v) + 1e-9)


QCACHE = f"{HERE}/qemb.npy"
if os.path.exists(QCACHE):
    QE = np.load(QCACHE)
else:
    QE = np.stack([embed(q["q"]) for q in queries])
    np.save(QCACHE, QE)


def vec_chunk_scores(qi):
    return E @ QE[qi]


def file_scores_from_chunks(sc):
    """max-pool chunk scores to file level. Same ordering eval.py's dedupe produces."""
    best = {}
    for i, f in enumerate(files):
        if f not in best or sc[i] > best[f]:
            best[f] = float(sc[i])
    return best


def vec_rank(qi):
    sc = vec_chunk_scores(qi)
    return dedupe([files[i] for i in np.argsort(-sc)[:200]]), sc


# ---------------------------------------------------------------- graphs
g0 = json.load(open(f"{HERE}/graph0.json"))["edges"]
pilot = json.load(open(f"{HERE}/pilot_edges.json"))
FILESET = set(ALL_FILES)


def build_adj(edges, undirected=True, weight_fn=None, restrict=None):
    """node -> {nbr: weight}. Nodes may be files or free-text concept nodes."""
    adj = collections.defaultdict(dict)
    for e in edges:
        s, d = e["src"], e["dst"]
        if restrict is not None and (s not in restrict or d not in restrict):
            continue
        w = 1.0 if weight_fn is None else weight_fn(e)
        if w <= 0:
            continue
        adj[s][d] = adj[s].get(d, 0.0) + w
        if undirected:
            adj[d][s] = adj[d].get(s, 0.0) + w
        else:
            adj.setdefault(d, {})
    return adj


def ppr(adj, seeds, damping=0.85, iters=50, tol=1e-9):
    """Personalized PageRank. seeds: {node: mass}, already summing to 1."""
    nodes = set(adj) | set(seeds)
    for n in list(adj):
        nodes |= set(adj[n])
    nodes = sorted(nodes)
    idx = {n: i for i, n in enumerate(nodes)}
    n = len(nodes)
    s = np.zeros(n)
    for k, v in seeds.items():
        if k in idx:
            s[idx[k]] = v
    if s.sum() == 0:
        return {}
    s /= s.sum()
    # column-stochastic transition, dangling mass returns to the seed vector
    out = [[] for _ in range(n)]
    for src, nbrs in adj.items():
        tot = sum(nbrs.values())
        if tot <= 0:
            continue
        i = idx[src]
        for dst, w in nbrs.items():
            out[i].append((idx[dst], w / tot))
    p = s.copy()
    for _ in range(iters):
        nxt = np.zeros(n)
        dangling = 0.0
        for i in range(n):
            if not out[i]:
                dangling += p[i]
                continue
            pi = p[i]
            if pi == 0:
                continue
            for j, w in out[i]:
                nxt[j] += pi * w
        nxt = damping * (nxt + dangling * s) + (1 - damping) * s
        if np.abs(nxt - p).sum() < tol:
            p = nxt
            break
        p = nxt
    return {nodes[i]: float(p[i]) for i in range(n) if p[i] > 0}


def minmax(d):
    if not d:
        return {}
    vs = list(d.values())
    lo, hi = min(vs), max(vs)
    if hi - lo < 1e-12:
        return {k: 0.0 for k in d}
    return {k: (v - lo) / (hi - lo) for k, v in d.items()}


# ---------------------------------------------------------------- retrievers
def rank_from(scores, pool=None):
    items = [(f, s) for f, s in scores.items() if pool is None or f in pool]
    items.sort(key=lambda x: -x[1])
    return [f for f, _ in items[:50]]


def ppr_rank(qi, adj, seed_k=10, damping=0.85, alpha=0.7, pool=None):
    """alpha = weight on the vector score, 1-alpha on PPR."""
    fs = file_scores_from_chunks(vec_chunk_scores(qi))
    top = sorted(fs.items(), key=lambda x: -x[1])[:seed_k]
    lo = min(s for _, s in top)
    mass = {f: max(s - lo, 1e-6) for f, s in top}
    tot = sum(mass.values())
    seeds = {f: m / tot for f, m in mass.items()}
    pr = ppr(adj, seeds, damping=damping)
    pr = {f: v for f, v in pr.items() if f in FILESET}  # concept nodes are bridges, not answers
    vn, pn = minmax(fs), minmax(pr)
    fused = {}
    for f in set(vn) | set(pn):
        fused[f] = alpha * vn.get(f, 0.0) + (1 - alpha) * pn.get(f, 0.0)
    return rank_from(fused, pool)


def onehop_rank(qi, adj, seed_k=5, boost=0.0, pool=None):
    """vector top-k files, add their graph neighbours, rerank the expanded set.

    boost=0.0 is the literal spec: rerank strictly by vector score, which by
    construction cannot change the top-5. boost>0 gives neighbours an additive
    bonus so the expansion can actually promote something.
    """
    fs = file_scores_from_chunks(vec_chunk_scores(qi))
    base = sorted(fs.items(), key=lambda x: -x[1])
    seeds = [f for f, _ in base[:seed_k]]
    nbrs = set()
    for s in seeds:
        for n in adj.get(s, {}):
            if n in FILESET:
                nbrs.add(n)
    expanded = set(seeds) | nbrs
    vn = minmax({f: fs.get(f, 0.0) for f in expanded})
    out = {f: vn.get(f, 0.0) + (boost if (f in nbrs and f not in seeds) else 0.0) for f in expanded}
    ranked = rank_from(out, pool)
    # anything not reached keeps the plain vector order behind the expanded set
    tail = [f for f, _ in base if f not in expanded and (pool is None or f in pool)]
    return (ranked + tail)[:50]


# ---------------------------------------------------------------- runner
def run(name, fn, qset=None, store=None, quiet=False):
    qs = qset if qset is not None else list(range(len(queries)))
    h = m = a = 0
    njoin = ajoin = 0
    per = []
    for qi in qs:
        gold = queries[qi]["gold"]
        ranked = fn(qi)
        hit, mrr, allg = score(ranked, gold)
        h += hit
        m += mrr
        a += allg
        if len(gold) > 1:
            njoin += 1
            ajoin += allg
        per.append((qi, int(hit), round(mrr, 3), int(allg), ranked[:5]))
    n = len(qs)
    row = {"method": name, "n": n, "recall@5": h / n * 100, "MRR": m / n,
           "all@5": a / n * 100, "n_join": njoin,
           "join_all@5": (ajoin / njoin * 100) if njoin else float("nan"), "per": per}
    if store is not None:
        store.append(row)
    if not quiet:
        jv = f"{row['join_all@5']:5.0f}%" if njoin else "    -"
        print(f"{name:44} {row['recall@5']:7.0f}% {row['MRR']:7.3f} {row['all@5']:7.0f}% {jv}  n={n}")
    return row


def header(title):
    print(f"\n{title}")
    print(f"{'method':44} {'rec@5':>8} {'MRR':>7} {'all@5':>8} {'join':>6}")
    print("-" * 80)


RESULTS = []
t0 = time.time()

# ---------------------------------------------------------------- 1. baseline
header("1. BASELINE  (confirm the harness matches eval.py)")
BM = {}
for qi, q in enumerate(queries):
    BM[qi], _ = bm25_rank(q["q"])
VR = {qi: vec_rank(qi)[0] for qi in range(len(queries))}
run("bm25", lambda qi: BM[qi], store=RESULTS)
run("vector", lambda qi: VR[qi], store=RESULTS)
run("hybrid (RRF bm25+vector)", lambda qi: rrf([BM[qi], VR[qi]]), store=RESULTS)

# ---------------------------------------------------------------- 2. PPR over graph0
A0 = build_adj(g0, undirected=True)
A0_dir = build_adj(g0, undirected=False)
g0_files = set(A0)
print(f"\ngraph0: {len(g0)} edges, {len(g0_files)} nodes, "
      f"{len(g0_files & FILESET)} of {len(ALL_FILES)} corpus files touched, "
      f"mean degree {2*len(g0)/max(len(g0_files),1):.1f}")

header("2. PERSONALIZED PAGERANK over graph0, damping 0.85")
for alpha in (1.0, 0.9, 0.8, 0.7, 0.5, 0.3, 0.0):
    run(f"ppr undirected  alpha={alpha:.1f} (vec weight)",
        lambda qi, a=alpha: ppr_rank(qi, A0, alpha=a), store=RESULTS)
run("ppr directed    alpha=0.7",
    lambda qi: ppr_rank(qi, A0_dir, alpha=0.7), store=RESULTS)
for sk in (3, 20):
    run(f"ppr undirected  alpha=0.7 seed_k={sk}",
        lambda qi, s=sk: ppr_rank(qi, A0, seed_k=s, alpha=0.7), store=RESULTS)
for d in (0.5, 0.95):
    run(f"ppr undirected  alpha=0.7 damping={d}",
        lambda qi, dd=d: ppr_rank(qi, A0, damping=dd, alpha=0.7), store=RESULTS)

# ---------------------------------------------------------------- 3. 1-hop expansion
header("3. ONE-HOP EXPANSION of vector top-5 over graph0")
run("1hop boost=0.00 (literal spec, vector rerank)",
    lambda qi: onehop_rank(qi, A0, boost=0.0), store=RESULTS)
for b in (0.10, 0.25, 0.50, 1.00):
    run(f"1hop boost={b:.2f}", lambda qi, bb=b: onehop_rank(qi, A0, boost=bb), store=RESULTS)

# ---------------------------------------------------------------- 4. typed vs untyped, pilot subgraph
pilot_files = sorted({e["src"] for e in pilot} | ({e["dst"] for e in pilot} & FILESET))
PILOT_POOL = set(pilot_files)
pilot_qs = [i for i, q in enumerate(queries) if any(g in PILOT_POOL for g in q["gold"])]
pilot_gold_cov = sum(1 for i in pilot_qs for g in queries[i]["gold"] if g in PILOT_POOL)

print(f"\npilot coverage: {len(pilot_files)} files, {len(pilot)} typed edges "
      f"({sum(1 for e in pilot if e['dst'] in FILESET)} file->file, "
      f"{sum(1 for e in pilot if e['dst'] not in FILESET)} file->concept)")
print(f"queries with at least one gold inside the pilot set: n={len(pilot_qs)}  "
      f"({pilot_gold_cov} gold files covered)")
print("  " + "\n  ".join(f"[{i}] {queries[i]['q']}" for i in pilot_qs))

# untyped comparator A: the graph0 wikilink edges among exactly these files
g0_pilot = [e for e in g0 if e["src"] in PILOT_POOL and e["dst"] in PILOT_POOL]
A_g0p = build_adj(g0_pilot, undirected=True)

# untyped comparator B: the SAME pilot edges with every relation label erased.
# concept nodes retained, so connectivity is identical and only labels differ.
A_pu = build_adj(pilot, undirected=True)

# typed: same edges, weight by relation. Join-bearing relations upweighted,
# weak ones downweighted. Weights are a design choice, stated not tuned.
W_TYPED = {
    "SUPERSEDES": 3.0, "CONTRADICTS": 3.0, "DECIDED_AGAINST": 3.0, "CHOSE": 3.0,
    "INSTANCE_OF": 2.0, "EVIDENCE_FOR": 2.0, "DERIVED_FROM": 2.0, "CAUSED": 2.0,
    "CONSTRAINS": 1.0, "SAID_BY": 1.0, "VIOLATED_BY": 1.0,
    "ABOUT": 0.5, "MENTIONS": 0.25, "UNTYPED": 0.25,
}
A_pt = build_adj(pilot, undirected=True, weight_fn=lambda e: W_TYPED.get(e["relation"], 1.0))

# typed, confidence-weighted as well
A_ptc = build_adj(pilot, undirected=True,
                  weight_fn=lambda e: W_TYPED.get(e["relation"], 1.0) * e.get("confidence", 1.0))

# typed, join-relations ONLY (hard filter rather than soft weight)
JOIN_RELS = {"SUPERSEDES", "CONTRADICTS", "DECIDED_AGAINST", "CHOSE", "INSTANCE_OF",
             "EVIDENCE_FOR", "DERIVED_FROM", "CAUSED"}
A_pj = build_adj([e for e in pilot if e["relation"] in JOIN_RELS], undirected=True)

header(f"4. TYPED vs UNTYPED, restricted to the {len(pilot_files)} pilot files  (n={len(pilot_qs)})")
run("vector          (pilot queries, full corpus rank)",
    lambda qi: VR[qi], qset=pilot_qs, store=RESULTS)
run("hybrid          (pilot queries, full corpus rank)",
    lambda qi: rrf([BM[qi], VR[qi]]), qset=pilot_qs, store=RESULTS)
print()
print("  -- 4a. edge SOURCE: wikilinks vs hand-extracted, both label-blind --")
run("ppr  graph0 wikilinks only, untyped  a=0.7",
    lambda qi: ppr_rank(qi, A_g0p, alpha=0.7), qset=pilot_qs, store=RESULTS)
run("ppr  pilot edges, labels ERASED      a=0.7",
    lambda qi: ppr_rank(qi, A_pu, alpha=0.7), qset=pilot_qs, store=RESULTS)
print()
print("  -- 4b. the isolation: SAME edges, labels erased vs labels used --")
for a in (0.9, 0.7, 0.5):
    run(f"ppr  UNTYPED (all weights 1.0)       a={a}",
        lambda qi, aa=a: ppr_rank(qi, A_pu, alpha=aa), qset=pilot_qs, store=RESULTS)
    run(f"ppr  TYPED   (relation weights)      a={a}",
        lambda qi, aa=a: ppr_rank(qi, A_pt, alpha=aa), qset=pilot_qs, store=RESULTS)
    run(f"ppr  TYPED + confidence              a={a}",
        lambda qi, aa=a: ppr_rank(qi, A_ptc, alpha=aa), qset=pilot_qs, store=RESULTS)
    run(f"ppr  TYPED join-relations only       a={a}",
        lambda qi, aa=a: ppr_rank(qi, A_pj, alpha=aa), qset=pilot_qs, store=RESULTS)
print()
print("  -- 4c. one-hop, same isolation --")
run("1hop untyped boost=0.00", lambda qi: onehop_rank(qi, A_pu, boost=0.0), qset=pilot_qs, store=RESULTS)
for b in (0.25, 0.50):
    run(f"1hop UNTYPED boost={b:.2f}", lambda qi, bb=b: onehop_rank(qi, A_pu, boost=bb),
        qset=pilot_qs, store=RESULTS)
    run(f"1hop TYPED   boost={b:.2f} (weighted adj)",
        lambda qi, bb=b: onehop_rank(qi, A_pt, boost=bb), qset=pilot_qs, store=RESULTS)
    run(f"1hop TYPED join-rels only boost={b:.2f}",
        lambda qi, bb=b: onehop_rank(qi, A_pj, boost=bb), qset=pilot_qs, store=RESULTS)

# ---------------------------------------------------------------- per-query diagnosis
print("\n\n5. PER-QUERY, the join metric. gold count >1 means the answer needs a JOIN.")
print(f"{'#':>3} {'query':45} {'g':>2} {'vec':>4} {'hyb':>4} {'ppr':>4} {'1hop':>5}  gold found")
print("-" * 112)
bl = {r["method"]: r for r in RESULTS}
pv = {qi: r for qi, *r in bl["vector"]["per"]}
ph = {qi: r for qi, *r in bl["hybrid (RRF bm25+vector)"]["per"]}
pp = {qi: r for qi, *r in bl["ppr undirected  alpha=0.7 (vec weight)"]["per"]}
p1 = {qi: r for qi, *r in bl["1hop boost=0.25"]["per"]}
fail_all = []
for qi, q in enumerate(queries):
    g = q["gold"]
    top = pv[qi][3]
    found = sum(1 for x in g if x in top)
    mark = lambda d: ("Y" if d[qi][0] else ".") + ("A" if d[qi][2] else " ")
    print(f"{qi:>3} {q['q'][:44]:45} {len(g):>2} {mark(pv):>4} {mark(ph):>4} {mark(pp):>4} {mark(p1):>5}"
          f"  {found}/{len(g)}")
    if not pv[qi][0] and not ph[qi][0]:
        fail_all.append(qi)
print("\nfailed vector AND hybrid at recall@5:", fail_all)
print("joins never completed by any method (gold>1, all@5 false everywhere):")
for qi, q in enumerate(queries):
    if len(q["gold"]) > 1 and not (pv[qi][2] or ph[qi][2] or pp[qi][2] or p1[qi][2]):
        print(f"  [{qi}] {q['q']}  gold={q['gold']}")

json.dump([{k: v for k, v in r.items() if k != "per"} for r in RESULTS],
          open(f"{HERE}/graphrank_results.json", "w"), indent=1)
print(f"\ntotal {time.time()-t0:.0f}s")


# ================================================================ 6. join diagnostics
print("\n\n6. WHY THE JOINS FAIL. Vector rank of every gold file, and the graph")
print("   distance between the gold files that have to be joined.")


def file_rank_list(qi):
    fs = file_scores_from_chunks(vec_chunk_scores(qi))
    return [f for f, _ in sorted(fs.items(), key=lambda x: -x[1])]


def hops(adj, a, b, cap=4):
    if a == b:
        return 0
    seen = {a}
    frontier = [a]
    for d in range(1, cap + 1):
        nxt = []
        for n in frontier:
            for m in adj.get(n, {}):
                if m in seen:
                    continue
                if m == b:
                    return d
                seen.add(m)
                nxt.append(m)
        frontier = nxt
        if not frontier:
            break
    return None


print(f"{'#':>3} {'gold file':58} {'vecrank':>8}   pairwise hops in graph0 / pilot")
print("-" * 112)
join_stats = []
for qi, q in enumerate(queries):
    g = q["gold"]
    if len(g) < 2:
        continue
    rl = file_rank_list(qi)
    ranks = {f: (rl.index(f) + 1 if f in rl else None) for f in g}
    for f in g:
        print(f"{qi:>3} {f[:57]:58} {str(ranks[f]):>8}")
    for a, b in itertools.combinations(g, 2):
        h0 = hops(A0, a, b)
        hp = hops(A_pu, a, b)
        join_stats.append((qi, a, b, h0, hp))
        print(f"{'':3} {'  join ' + os.path.basename(a)[:22] + ' <-> ' + os.path.basename(b)[:22]:58} "
              f"{'':>8}   graph0={h0}  pilot={hp}")

n_pairs = len(join_stats)
reach0 = sum(1 for *_, h0, hp in join_stats if h0 is not None)
close0 = sum(1 for *_, h0, hp in join_stats if h0 is not None and h0 <= 2)
print(f"\ngold pairs that must be joined: {n_pairs}")
print(f"  connected in graph0 within 4 hops : {reach0}/{n_pairs}")
print(f"  within 2 hops (reachable by PPR)  : {close0}/{n_pairs}")

# ================================================================ 7. oracle-anchored join
print("\n\n7. ORACLE-ANCHORED JOIN. This is the ceiling. Hand the graph the ONE gold")
print("   file vector already found, give it 100% of the seed mass, and ask whether")
print("   the partner gold file comes back in the graph-only top 5. If this fails,")
print("   the edges do not encode the join and no ranking algorithm can fix it.")


def oracle_join(adj, qset, label, damping=0.85):
    tried = won = 0
    detail = []
    for qi in qset:
        g = queries[qi]["gold"]
        if len(g) < 2:
            continue
        rl = file_rank_list(qi)
        present = [f for f in g if f in rl[:5]]
        if not present:
            anchor = min(g, key=lambda f: rl.index(f) if f in rl else 10 ** 6)
        else:
            anchor = present[0]
        targets = [f for f in g if f != anchor]
        pr = ppr(adj, {anchor: 1.0}, damping=damping)
        pr = {f: v for f, v in pr.items() if f in FILESET and f != anchor}
        top5 = [f for f, _ in sorted(pr.items(), key=lambda x: -x[1])[:5]]
        got = [t for t in targets if t in top5]
        tried += len(targets)
        won += len(got)
        detail.append((qi, anchor, targets, got, len(pr)))
    print(f"  {label:38} partner recovered in graph-only top5: {won}/{tried}")
    return won, tried, detail


print()
allq = list(range(len(queries)))
oracle_join(A0, allq, "graph0 wikilinks, all 25 queries")
oracle_join(A0_dir, allq, "graph0 directed, all 25 queries")
w_u, t_u, d_u = oracle_join(A_pu, pilot_qs, f"pilot UNTYPED, n={len(pilot_qs)} pilot queries")
w_t, t_t, d_t = oracle_join(A_pt, pilot_qs, f"pilot TYPED weights, n={len(pilot_qs)}")
w_j, t_j, d_j = oracle_join(A_pj, pilot_qs, f"pilot TYPED join-rels only, n={len(pilot_qs)}")

print("\n  per-pair detail, pilot untyped:")
for qi, anchor, targets, got, npr in d_u:
    print(f"    [{qi}] anchor={os.path.basename(anchor)[:34]:36} want={[os.path.basename(t)[:30] for t in targets]}"
          f" got={[os.path.basename(t)[:30] for t in got]} reachable_files={npr}")


# ================================================================ 8. better fusion
# Section 2 fused PPR and vector as normalized SCORES. Min-max on a PPR
# distribution is dominated by the seeds, so a rank-82 file that is one hop
# from a seed still lands near zero. Rank-level fusion (RRF) is scale-free and
# is what the graph-RAG literature actually uses, so test it.
print("\n\n8. RANK-LEVEL FUSION. Same PPR, fused by reciprocal rank instead of score.")


def ppr_only_rank(qi, adj, seed_k=10, damping=0.85):
    fs = file_scores_from_chunks(vec_chunk_scores(qi))
    top = sorted(fs.items(), key=lambda x: -x[1])[:seed_k]
    lo = min(s for _, s in top)
    mass = {f: max(s - lo, 1e-6) for f, s in top}
    tot = sum(mass.values())
    pr = ppr(adj, {f: m / tot for f, m in mass.items()}, damping=damping)
    pr = {f: v for f, v in pr.items() if f in FILESET}
    return [f for f, _ in sorted(pr.items(), key=lambda x: -x[1])[:50]]


def rrf_graph(qi, adj, seed_k=10, kk=60, w_vec=1.0, w_ppr=1.0):
    vl = VR[qi]
    pl = ppr_only_rank(qi, adj, seed_k=seed_k)
    sc = collections.Counter()
    for r, f in enumerate(vl):
        sc[f] += w_vec / (kk + r + 1)
    for r, f in enumerate(pl):
        sc[f] += w_ppr / (kk + r + 1)
    return [f for f, _ in sc.most_common(50)]


header("8a. RRF(vector, PPR) over graph0")
for sk in (5, 10, 20):
    for kk in (10, 60):
        run(f"rrf(vec,ppr) undirected seed_k={sk} k={kk}",
            lambda qi, s=sk, k=kk: rrf_graph(qi, A0, seed_k=s, kk=k), store=RESULTS)
run("rrf(vec,ppr) directed seed_k=10 k=60",
    lambda qi: rrf_graph(qi, A0_dir, seed_k=10), store=RESULTS)
run("rrf(vec,ppr,bm25) undirected seed_k=10",
    lambda qi: rrf([VR[qi], ppr_only_rank(qi, A0), BM[qi]]), store=RESULTS)
run("ppr only (no vector in the ranking) seed_k=10",
    lambda qi: ppr_only_rank(qi, A0), store=RESULTS)

header("8b. RRF(vector, PPR), pilot queries only, TYPED vs UNTYPED  (n=7)")
run("rrf(vec,ppr) graph0 full", lambda qi: rrf_graph(qi, A0), qset=pilot_qs, store=RESULTS)
run("rrf(vec,ppr) pilot UNTYPED", lambda qi: rrf_graph(qi, A_pu), qset=pilot_qs, store=RESULTS)
run("rrf(vec,ppr) pilot TYPED", lambda qi: rrf_graph(qi, A_pt), qset=pilot_qs, store=RESULTS)
run("rrf(vec,ppr) pilot TYPED+conf", lambda qi: rrf_graph(qi, A_ptc), qset=pilot_qs, store=RESULTS)
run("rrf(vec,ppr) pilot TYPED join-rels", lambda qi: rrf_graph(qi, A_pj), qset=pilot_qs, store=RESULTS)

# graph0 restricted to the pilot files, so edge SOURCE is isolated from edge COUNT
header("8c. same but on the whole 25, pilot edges MERGED into graph0")
merged_u = g0 + [{"src": e["src"], "dst": e["dst"], "relation": "UNTYPED"} for e in pilot]
A_mu = build_adj(merged_u, undirected=True)
A_mt = build_adj(g0 + pilot, undirected=True,
                 weight_fn=lambda e: W_TYPED.get(e.get("relation", "UNTYPED"), 1.0))
run("rrf(vec,ppr) graph0 + pilot, UNTYPED", lambda qi: rrf_graph(qi, A_mu), store=RESULTS)
run("rrf(vec,ppr) graph0 + pilot, TYPED", lambda qi: rrf_graph(qi, A_mt), store=RESULTS)

# ================================================================ 9. best-config recheck
print("\n\n9. THE WINNER vs THE BASELINE, per query.")
best = max([r for r in RESULTS if r["n"] == 25], key=lambda r: (r["all@5"], r["recall@5"], r["MRR"]))
print(f"best on all@5 over 25 queries: {best['method']}  "
      f"rec@5={best['recall@5']:.0f}% MRR={best['MRR']:.3f} all@5={best['all@5']:.0f}% "
      f"join={best['join_all@5']:.0f}%")
pb = {qi: r for qi, *r in best["per"]}
print(f"\n{'#':>3} {'query':46} {'vec':>5} {'best':>6}  delta")
print("-" * 76)
for qi, q in enumerate(queries):
    a = f"{'Y' if pv[qi][0] else '.'}{'A' if pv[qi][2] else ' '}"
    b = f"{'Y' if pb[qi][0] else '.'}{'A' if pb[qi][2] else ' '}"
    d = "" if a == b else ("  BETTER" if b > a else "  WORSE")
    print(f"{qi:>3} {q['q'][:45]:46} {a:>5} {b:>6}{d}")

print("\n\nSUMMARY TABLE (25 queries unless noted)")
print(f"{'method':46} {'rec@5':>7} {'MRR':>7} {'all@5':>7} {'join@5':>7} {'n':>4}")
print("-" * 84)
for r in RESULTS:
    jv = f"{r['join_all@5']:6.0f}%" if r["n_join"] else "     -"
    print(f"{r['method'][:45]:46} {r['recall@5']:6.0f}% {r['MRR']:7.3f} {r['all@5']:6.0f}% {jv} {r['n']:>4}")
json.dump([{k: v for k, v in r.items() if k != "per"} for r in RESULTS],
          open(f"{HERE}/graphrank_results.json", "w"), indent=1)


# ================================================================ 10. controls
# 8c compared "graph0 + pilot untyped" against "graph0 + pilot typed", but the
# typed arm also reweighted graph0's OWN positional relations. That confounds
# pilot labels with graph0 reweighting. Separate them.
print("\n\n10. CONTROLS for the typed result in 8c.")
A_g0_tw = build_adj(g0, undirected=True, weight_fn=lambda e: W_TYPED.get(e["relation"], 1.0))
A_g0_plus_pu = build_adj(g0 + [{"src": e["src"], "dst": e["dst"], "relation": "UNTYPED"} for e in pilot],
                         undirected=True, weight_fn=lambda e: W_TYPED.get(e["relation"], 1.0))
header("10a. is the 8c gain from pilot LABELS or from reweighting graph0?")
run("A graph0 only, flat weights", lambda qi: rrf_graph(qi, A0), store=RESULTS)
run("B graph0 only, W_TYPED reweighted (NO pilot)", lambda qi: rrf_graph(qi, A_g0_tw), store=RESULTS)
run("C graph0 W_TYPED + pilot edges UNLABELLED", lambda qi: rrf_graph(qi, A_g0_plus_pu), store=RESULTS)
run("D graph0 W_TYPED + pilot edges LABELLED", lambda qi: rrf_graph(qi, A_mt), store=RESULTS)

# random-label control: shuffle the relation labels, keep the topology.
import random
for seed in (1, 2, 3):
    rnd = random.Random(seed)
    labs = [e["relation"] for e in pilot]
    rnd.shuffle(labs)
    shuf = [dict(e, relation=l) for e, l in zip(pilot, labs)]
    A_sh = build_adj(g0 + shuf, undirected=True, weight_fn=lambda e: W_TYPED.get(e.get("relation", "UNTYPED"), 1.0))
    run(f"E graph0 W_TYPED + pilot labels SHUFFLED s={seed}",
        lambda qi, a=A_sh: rrf_graph(qi, a), store=RESULTS)

print("\n  If B already matches D, the pilot relation TYPES bought nothing.")
print("  If E matches D, the labels carry no information beyond their weight distribution.")

# ---------------------------------------------------------------- effect size
print("\n\n11. HOW BIG IS 4 PERCENTAGE POINTS ON 25 QUERIES?")
base = next(r for r in RESULTS if r["method"] == "vector")
win = next(r for r in RESULTS if r["method"] == "ppr directed    alpha=0.7")
bh = {qi: h for qi, h, *_ in base["per"]}
wh = {qi: h for qi, h, *_ in win["per"]}
ba = {qi: a for qi, _, _, a, _ in base["per"]}
wa = {qi: a for qi, _, _, a, _ in win["per"]}
flip_up = [qi for qi in bh if wh[qi] > bh[qi]]
flip_dn = [qi for qi in bh if wh[qi] < bh[qi]]
aup = [qi for qi in ba if wa[qi] > ba[qi]]
adn = [qi for qi in ba if wa[qi] < ba[qi]]
print(f"  recall@5: {len(flip_up)} queries gained, {len(flip_dn)} lost. gained={flip_up} lost={flip_dn}")
print(f"  all@5   : {len(aup)} queries gained, {len(adn)} lost. gained={aup} lost={adn}")
b = len(flip_up) + len(aup)
c = len(flip_dn) + len(adn)
# exact two-sided sign test on the discordant pairs
if b + c:
    p = sum(math.comb(b + c, i) for i in range(0, min(b, c) + 1)) / 2 ** (b + c) * 2
    p = min(p, 1.0)
    print(f"  sign test over {b+c} discordant query-metric pairs ({b} up, {c} down): p = {p:.3f}")
print("  25 queries means one query is 4 percentage points. Treat any single-query")
print("  difference as noise. The join metric moved 18 points, which is 3 queries.")

json.dump([{k: v for k, v in r.items() if k != "per"} for r in RESULTS],
          open(f"{HERE}/graphrank_results.json", "w"), indent=1)


# ---------------------------------------------------------------- 12. prune vs semantics
# B beat A. But W_TYPED does two things at once: it downweights the noisy
# UNTYPED/MENTIONS edges, and it ranks the remaining relations against each
# other. Only the second is "relation types carry meaning". Separate them.
print("\n\n12. Is the graph0 typed gain SEMANTICS or just PRUNING noisy edges?")
W_PRUNE = lambda e: 0.25 if e["relation"] in ("UNTYPED", "MENTIONS") else 1.0
A_prune = build_adj(g0, undirected=True, weight_fn=W_PRUNE)
A_drop = build_adj([e for e in g0 if e["relation"] not in ("UNTYPED", "MENTIONS")], undirected=True)
header("12a. pruning-only weights vs full semantic weights, graph0")
run("A flat (every edge 1.0)", lambda qi: rrf_graph(qi, A0), store=RESULTS)
run("P prune-only (UNTYPED/MENTIONS -> 0.25, rest 1.0)", lambda qi: rrf_graph(qi, A_prune), store=RESULTS)
run("H hard-drop UNTYPED/MENTIONS entirely", lambda qi: rrf_graph(qi, A_drop), store=RESULTS)
run("B full semantic W_TYPED", lambda qi: rrf_graph(qi, A_g0_tw), store=RESULTS)
ntyped = sum(1 for e in g0 if e["relation"] not in ("UNTYPED", "MENTIONS"))
print(f"\n  graph0 is {ntyped}/{len(g0)} positionally-typed edges "
      f"({ntyped/len(g0)*100:.0f}%), the rest are bare wikilinks.")
print("  If P matches B, the relation NAMES did nothing and the weight on the")
print("  noisy-edge class did all the work.")


# ---------------------------------------------------------------- 13. anchor recall
# PPR can only reach what its seeds can reach. So the ceiling of ANY
# seed-and-spread method is whether a gold file lands in the seed set at all.
print("\n\n13. ANCHOR RECALL. The real ceiling on every seed-and-spread method.")
for sk in (5, 10, 20, 50):
    any_in = sum(1 for qi, q in enumerate(queries)
                 if any(g in file_rank_list(qi)[:sk] for g in q["gold"]))
    print(f"  at least one gold file inside vector top-{sk:<3}: {any_in}/25  ({any_in/25*100:.0f}%)")
print()
print("  the 7 queries vector+hybrid both miss at rank 5, and where their gold actually sits:")
for qi in [7, 11, 12, 18, 19, 20, 22, 24]:
    rl = file_rank_list(qi)
    rs = [(os.path.basename(g)[:40], (rl.index(g) + 1 if g in rl else None)) for g in queries[qi]["gold"]]
    seeded = any(r is not None and r <= 10 for _, r in rs)
    print(f"   [{qi:>2}] {queries[qi]['q'][:42]:44} {rs}  seedable={seeded}")


# ---------------------------------------------------------------- 14. deep seeding
# Anchor recall is 92% at top-50. If the graph is worth anything, seeding deep
# and letting PPR amplify the well-connected gold should convert some of that.
print("\n\n14. DEEP SEEDING. Anchor recall says 92% of golds are somewhere in top-50.")
header("14a. seed_k sweep, RRF fusion, graph0 W_TYPED")
for sk in (10, 20, 30, 50, 100):
    run(f"rrf(vec,ppr) seed_k={sk}", lambda qi, s=sk: rrf_graph(qi, A_g0_tw, seed_k=s), store=RESULTS)
header("14b. seed_k sweep, score fusion alpha=0.5")
for sk in (10, 20, 30, 50, 100):
    run(f"ppr a=0.5 seed_k={sk}", lambda qi, s=sk: ppr_rank(qi, A_g0_tw, seed_k=s, alpha=0.5), store=RESULTS)
header("14c. best-of, directed graph, deep seed")
A0_dir_tw = build_adj(g0, undirected=False, weight_fn=lambda e: W_TYPED.get(e["relation"], 1.0))
for sk in (10, 20, 50):
    for a in (0.7, 0.5):
        run(f"ppr DIRECTED W_TYPED seed_k={sk} a={a}",
            lambda qi, s=sk, aa=a: ppr_rank(qi, A0_dir_tw, seed_k=s, alpha=aa), store=RESULTS)

print("\n\nFINAL: top 12 configurations over all 25 queries, ranked by all@5 then MRR")
top = sorted([r for r in RESULTS if r["n"] == 25],
             key=lambda r: (-r["all@5"], -r["recall@5"], -r["MRR"]))
seen = set()
print(f"{'method':50} {'rec@5':>7} {'MRR':>7} {'all@5':>7} {'join':>6}")
print("-" * 82)
for r in top:
    if r["method"] in seen:
        continue
    seen.add(r["method"])
    if len(seen) > 12:
        break
    print(f"{r['method'][:49]:50} {r['recall@5']:6.0f}% {r['MRR']:7.3f} {r['all@5']:6.0f}% {r['join_all@5']:5.0f}%")
json.dump([{k: v for k, v in r.items() if k != "per"} for r in RESULTS],
          open(f"{HERE}/graphrank_results.json", "w"), indent=1)
