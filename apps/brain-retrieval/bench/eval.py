#!/usr/bin/env python3
import os, re, json, math, subprocess, urllib.request, collections, time
import numpy as np

HERE  = os.path.dirname(os.path.abspath(__file__))
BRAIN = __import__("os").environ.get("CHEWBACCA_BRAIN", __import__("os").path.expanduser("~/second-brain"))
MODEL = "nomic-embed-text"
K     = 5

chunks = json.load(open(f"{HERE}/chunks.json"))
E      = np.load(f"{HERE}/emb.npy")
queries= json.load(open(f"{HERE}/queries.json"))
files  = [c["file"] for c in chunks]

STOP = set("what who why how when where which the a an is are was were do does did i my me "
           "about that this it to of in on for and or but if my mine should could would can "
           "keep keeps just like so not no yes im its".split())

def terms(q):
    return [w for w in re.findall(r"[a-z]+", q.lower()) if w not in STOP and len(w) > 2]

# ---------- 1. naive grep, the current behaviour ----------
def grep_rank(q):
    hits = collections.Counter()
    for t in terms(q):
        try:
            out = subprocess.run(["grep","-ril","--include=*.md",t,
                                  "core","domains","memory","projects","systems","wiki"],
                                 cwd=BRAIN, capture_output=True, text=True, timeout=30).stdout
        except Exception:
            out = ""
        for line in out.splitlines():
            if line.strip(): hits[line.strip()] += 1
    return [f for f,_ in hits.most_common(50)]

# ---------- 2. BM25 over chunks ----------
tok = [terms(c["embed_text"]) for c in chunks]
df  = collections.Counter()
for t in tok: df.update(set(t))
N   = len(tok); avgdl = sum(len(t) for t in tok)/N
tf  = [collections.Counter(t) for t in tok]
def bm25_rank(q, k1=1.5, b=0.75):
    qs = terms(q); sc = np.zeros(N)
    for w in qs:
        if w not in df: continue
        idf = math.log(1 + (N - df[w] + .5)/(df[w] + .5))
        for i in range(N):
            f = tf[i].get(w, 0)
            if f: sc[i] += idf * f*(k1+1)/(f + k1*(1-b+b*len(tok[i])/avgdl))
    return dedupe([files[i] for i in np.argsort(-sc)[:200]]), sc

# ---------- 3. embeddings ----------
def embed(t):
    req = urllib.request.Request("http://localhost:11434/api/embeddings",
        data=json.dumps({"model":MODEL,"prompt":t}).encode(),
        headers={"Content-Type":"application/json"})
    v = np.array(json.loads(urllib.request.urlopen(req,timeout=60).read())["embedding"],dtype="float32")
    return v/(np.linalg.norm(v)+1e-9)
def vec_rank(q):
    sc = E @ embed(q)
    return dedupe([files[i] for i in np.argsort(-sc)[:200]]), sc

def dedupe(seq):
    seen=[]; 
    for f in seq:
        if f not in seen: seen.append(f)
    return seen

# ---------- 4. hybrid, reciprocal rank fusion ----------
def rrf(lists, k=60):
    sc=collections.Counter()
    for L in lists:
        for r,f in enumerate(L): sc[f]+=1/(k+r+1)
    return [f for f,_ in sc.most_common(50)]

def score(ranked, gold, k=K):
    top = ranked[:k]
    hit = any(g in top for g in gold)
    mrr = 0.0
    for r,f in enumerate(ranked[:50]):
        if f in gold: mrr = 1/(r+1); break
    return hit, mrr

res = collections.defaultdict(lambda: {"hit":0,"mrr":0.0})
rows=[]
t0=time.time()
for q in queries:
    g = q["gold"]
    gr = grep_rank(q["q"])
    bm,_ = bm25_rank(q["q"])
    vr,_ = vec_rank(q["q"])
    hy = rrf([bm, vr])
    row={"q":q["q"]}
    for name, ranked in [("grep",gr),("bm25",bm),("vector",vr),("hybrid",hy)]:
        h,m = score(ranked, g)
        res[name]["hit"] += h; res[name]["mrr"] += m
        row[name]=(1 if h else 0, round(m,3), ranked[0] if ranked else "-")
    rows.append(row)

n=len(queries)
print(f"\n{'method':8} {'recall@5':>9} {'MRR':>7}")
print("-"*27)
for name in ["grep","bm25","vector","hybrid"]:
    print(f"{name:8} {res[name]['hit']/n*100:8.0f}% {res[name]['mrr']/n:7.3f}")
print(f"\n{n} queries, eval {time.time()-t0:.0f}s\n")
print(f"{'query':46} {'grep':>5} {'bm25':>5} {'vec':>5} {'hyb':>5}")
print("-"*74)
for r in rows:
    print(f"{r['q'][:45]:46} {r['grep'][0]:>5} {r['bm25'][0]:>5} {r['vector'][0]:>5} {r['hybrid'][0]:>5}")
json.dump(rows, open(f"{HERE}/results.json","w"), indent=1)
