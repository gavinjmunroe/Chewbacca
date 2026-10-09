import json,os,collections
import numpy as np
exec(open('tune.py').read().split('print(f"{\'agg\'')[0])
cfg=json.load(open('best_cfg.json'))
G=json.load(open('graph0.json'))
test=json.load(open('queries_independent.json'))
real=[q for q in test if q.get("hops")!="trap"]

# directed transition matrix over FILES
nodes=sorted({e["src"] for e in G["edges"]}|{e["dst"] for e in G["edges"]}|set(files))
idx={f:i for i,f in enumerate(nodes)}; n=len(nodes)
A=np.zeros((n,n),dtype="float32")
for e in G["edges"]:
    A[idx[e["src"]],idx[e["dst"]]]+=1.0
rs=A.sum(1,keepdims=True); rs[rs==0]=1; T=A/rs

def ppr(seed_scores,alpha=0.85,iters=20):
    p=np.zeros(n,dtype="float32")
    for f,s in seed_scores.items():
        if f in idx: p[idx[f]]=s
    if p.sum()==0: return {}
    p/=p.sum(); r=p.copy()
    for _ in range(iters): r=alpha*(r@T)+(1-alpha)*p
    return {nodes[i]:float(r[i]) for i in np.nonzero(r)[0]}

def tuned_scores(q):
    v=file_scores(E@emb(q,cfg["pfx"]),cfg["agg"]); b=file_scores(bm25(q),cfg["agg"])
    v,b=norm(v),norm(b)
    return {k: cfg["w"]*v.get(k,0)+(1-cfg["w"])*b.get(k,0) for k in set(v)|set(b)}

def rank_stack(q,beta,seed_k=20):
    base=tuned_scores(q)
    top=dict(sorted(base.items(),key=lambda kv:-kv[1])[:seed_k])
    pr=norm(ppr(top))
    sc={k: base.get(k,0)+beta*pr.get(k,0) for k in set(base)|set(pr)}
    return [k for k,_ in sorted(sc.items(),key=lambda kv:-kv[1])]

def ev(qs,beta,k=5):
    hit=mrr=allk=0; multi=[q for q in qs if len(q["gold"])>1]; joins=0
    for q in qs:
        r=rank_stack(q["q"],beta); g=q["gold"]
        if any(x in r[:k] for x in g): hit+=1
        if all(x in r[:k] for x in g): allk+=1
        if len(g)>1 and all(x in r[:k] for x in g): joins+=1
        for i,f in enumerate(r[:50]):
            if f in g: mrr+=1/(i+1); break
    return hit/len(qs)*100, mrr/len(qs), allk/len(qs)*100, joins/max(len(multi),1)*100

print("SEALED TEST, n=65 (tuned retrieval + PPR over free wikilink graph)\n")
print(f"{'beta':>6} {'r@5':>6} {'MRR':>7} {'all@5':>7} {'join@5':>8}")
print("-"*40)
for beta in [0.0,0.05,0.1,0.2,0.4]:
    r,m,a,j=ev(real,beta)
    star=" <- no graph" if beta==0 else ""
    print(f"{beta:6.2f} {r:5.0f}% {m:7.3f} {a:6.0f}% {j:7.0f}%{star}")
