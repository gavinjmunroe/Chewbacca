import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import goldset
import json,os,collections
exec(open('tune.py').read().split('print(f"{\'agg\'')[0])   # reuse rank/evaluate
cfg=json.load(open('best_cfg.json'))
test=goldset.load("queries_independent.json")
real=[q for q in test if q.get("hops")!="trap"]
trap=[q for q in test if q.get("hops")=="trap"]

def ev(qs,w,agg,pfx,k=5):
    hit=mrr=0
    for q in qs:
        r=rank(q["q"],w,agg,pfx); g=q["gold"]
        if any(x in r[:k] for x in g): hit+=1
        for i,f in enumerate(r[:50]):
            if f in g: mrr+=1/(i+1); break
    return hit/len(qs)*100, mrr/len(qs)

print("SEALED TEST SET (73 queries, tuned on dev only)\n")
print(f"{'config':34} {'r@5':>6} {'MRR':>7}")
print("-"*50)
r,m=ev(real,1.0,"max","");           print(f"{'baseline  dense only, max-agg':34} {r:5.0f}% {m:7.3f}")
r,m=ev(real,0.0,"max","");           print(f"{'baseline  bm25 only, max-agg':34} {r:5.0f}% {m:7.3f}")
rb,mb=ev(real,0.7,"max","");         print(f"{'  + fusion w=0.7':34} {rb:5.0f}% {mb:7.3f}")
rf,mf=ev(real,cfg["w"],cfg["agg"],cfg["pfx"])
print(f"{'  + mean-agg  (TUNED)':34} {rf:5.0f}% {mf:7.3f}")
print()
for cls in ["single","multi"]:
    qs=[q for q in real if q.get("hops")==cls]
    r,m=ev(qs,cfg["w"],cfg["agg"],cfg["pfx"])
    print(f"  {cls:8} n={len(qs):3}  r@5={r:5.0f}%  MRR={m:.3f}")
print()
# traps: a good system should score LOW on these
import numpy as np
def topscore(q):
    v=file_scores(E@emb(q,cfg["pfx"]),cfg["agg"])
    return max(v.values()) if v else 0
ts=[topscore(q["q"]) for q in trap]
rs=[topscore(q["q"]) for q in real]
print(f"TRAPS (answer not in corpus, n={len(trap)})")
print(f"  mean top cosine, traps  : {np.mean(ts):.3f}")
print(f"  mean top cosine, real   : {np.mean(rs):.3f}")
print(f"  separation              : {np.mean(rs)-np.mean(ts):+.3f}")
thr=0.55
print(f"  at abstain threshold {thr}: traps correctly abstained {sum(1 for t in ts if t<thr)}/{len(ts)}, "
      f"real wrongly abstained {sum(1 for t in rs if t<thr)}/{len(rs)}")
