#!/usr/bin/env python3
"""Tune fusion on the DEV set (queries.json) only. Test set stays sealed."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import goldset
import os,re,json,math,collections,urllib.request,itertools
import numpy as np
HERE=os.path.dirname(os.path.abspath(__file__))
chunks=json.load(open(f"{HERE}/chunks.json")); E=np.load(f"{HERE}/emb.npy")
dev=goldset.load("queries.json")
files=[c["file"] for c in chunks]
STOP=set("what who why how when where which the a an is are was were do does did i my me about that this it to of in on for and or but if my mine should could would can keep keeps just like so not no yes im its".split())
def terms(q): return [w for w in re.findall(r"[a-z]+",q.lower()) if w not in STOP and len(w)>2]
tok=[terms(c["embed_text"]) for c in chunks]
df=collections.Counter()
for t in tok: df.update(set(t))
N=len(tok); avgdl=sum(len(t) for t in tok)/N; tf=[collections.Counter(t) for t in tok]
def bm25(q,k1=1.5,b=0.75):
    sc=np.zeros(N)
    for w in terms(q):
        if w not in df: continue
        idf=math.log(1+(N-df[w]+.5)/(df[w]+.5))
        for i in range(N):
            f=tf[i].get(w,0)
            if f: sc[i]+=idf*f*(k1+1)/(f+k1*(1-b+b*len(tok[i])/avgdl))
    return sc
_ec={}
def emb(t,pfx=""):
    key=(t,pfx)
    if key in _ec: return _ec[key]
    r=urllib.request.Request("http://localhost:11434/api/embed",
        data=json.dumps({"model":"nomic-embed-text","input":[pfx+t]}).encode(),
        headers={"Content-Type":"application/json"})
    v=np.array(json.loads(urllib.request.urlopen(r,timeout=60).read())["embeddings"][0],dtype="float32")
    v/= (np.linalg.norm(v)+1e-9); _ec[key]=v; return v

def file_scores(chunk_scores, agg="max"):
    """chunk -> file aggregation. This is an untuned knob and may matter a lot."""
    d=collections.defaultdict(list)
    for i,s in enumerate(chunk_scores): d[files[i]].append(s)
    if agg=="max":  return {f:max(v) for f,v in d.items()}
    if agg=="mean": return {f:sum(v)/len(v) for f,v in d.items()}
    if agg=="sum2": return {f:sum(sorted(v)[-2:]) for f,v in d.items()}   # top-2 sum
    if agg=="logsum": return {f:sum(math.exp(3*x) for x in sorted(v)[-3:]) for f,v in d.items()}

def norm(d):
    if not d: return d
    vs=list(d.values()); lo,hi=min(vs),max(vs)
    return {k:(v-lo)/(hi-lo+1e-9) for k,v in d.items()}

def rank(q,w,agg,pfx):
    v=file_scores(E@emb(q,pfx),agg); b=file_scores(bm25(q),agg)
    v,b=norm(v),norm(b)
    keys=set(v)|set(b)
    sc={k: w*v.get(k,0)+(1-w)*b.get(k,0) for k in keys}
    return [k for k,_ in sorted(sc.items(),key=lambda kv:-kv[1])]

def evaluate(qs,w,agg,pfx,k=5):
    hit=mrr=0
    for q in qs:
        r=rank(q["q"],w,agg,pfx); g=q["gold"]
        if any(x in r[:k] for x in g): hit+=1
        for i,f in enumerate(r[:50]):
            if f in g: mrr+=1/(i+1); break
    return hit/len(qs)*100, mrr/len(qs)

print(f"{'agg':8} {'qprefix':16} {'w':>5} {'r@5':>6} {'MRR':>7}")
print("-"*48)
best=None
for agg in ["max","mean","sum2","logsum"]:
    for pfx in ["", "search_query: "]:
        for w in [0.0,0.3,0.5,0.7,1.0]:
            r,m=evaluate(dev,w,agg,pfx)
            tag=f"{agg:8} {(pfx or '(none)'):16} {w:5.1f} {r:5.0f}% {m:7.3f}"
            print(tag)
            if best is None or (m> best[0]): best=(m,r,agg,pfx,w)
print()
print(f"BEST on dev: MRR={best[0]:.3f} r@5={best[1]:.0f}%  agg={best[2]} pfx='{best[3]}' w={best[4]}")
json.dump({"agg":best[2],"pfx":best[3],"w":best[4]},open(f"{HERE}/best_cfg.json","w"))
