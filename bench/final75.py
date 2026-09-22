"""75-word chunks on the SEALED set. Sweeps aggregation because mean-agg was
tuned at 300w and may dilute over many small chunks. Dev is reported too, so
the dev-to-test gap is visible rather than hidden."""
import os,re,json,math,collections,urllib.request
import numpy as np
HERE=os.path.dirname(os.path.abspath(__file__))
dev=json.load(open(f"{HERE}/queries.json"))
test=[q for q in json.load(open(f"{HERE}/queries_independent.json")) if q.get("hops")!="trap"]
traps=[q for q in json.load(open(f"{HERE}/queries_independent.json")) if q.get("hops")=="trap"]
STOP=set("what who why how when where which the a an is are was were do does did i my me about that this it to of in on for and or but if my mine should could would can keep keeps just like so not no yes im its".split())
def terms(q): return [w for w in re.findall(r"[a-z]+",q.lower()) if w not in STOP and len(w)>2]

def load(ck,ev):
    C=json.load(open(f"{HERE}/{ck}")); E=np.load(f"{HERE}/{ev}")
    return C,[c["file"] for c in C],E

def build_bm25(C):
    tok=[terms(c["embed_text"]) for c in C]
    df=collections.Counter()
    for t in tok: df.update(set(t))
    N=len(tok); avgdl=sum(len(t) for t in tok)/N; tf=[collections.Counter(t) for t in tok]
    def f(q,k1=1.5,b=0.75):
        sc=np.zeros(N)
        for w in terms(q):
            if w not in df: continue
            idf=math.log(1+(N-df[w]+.5)/(df[w]+.5))
            for i in range(N):
                x=tf[i].get(w,0)
                if x: sc[i]+=idf*x*(k1+1)/(x+k1*(1-b+b*len(tok[i])/avgdl))
        return sc
    return f

_c={}
def emb(t):
    if t in _c: return _c[t]
    r=urllib.request.Request("http://localhost:11434/api/embed",
        data=json.dumps({"model":"nomic-embed-text","input":[t],"keep_alive":"30m"}).encode(),
        headers={"Content-Type":"application/json"})
    v=np.array(json.loads(urllib.request.urlopen(r,timeout=120).read())["embeddings"][0],dtype="float32")
    v/=(np.linalg.norm(v)+1e-9); _c[t]=v; return v

def norm(d):
    if not d: return d
    v=list(d.values()); lo,hi=min(v),max(v)
    return {k:(x-lo)/(hi-lo+1e-9) for k,x in d.items()}

def run(tag,ck,ev,agg,w,qs,label):
    C,files,E=load(ck,ev); bm=build_bm25(C)
    def agg_f(scores):
        d=collections.defaultdict(list)
        for i,s in enumerate(scores): d[files[i]].append(float(s))
        if agg=="mean": return {f:sum(v)/len(v) for f,v in d.items()}
        if agg=="max":  return {f:max(v) for f,v in d.items()}
        if agg=="top3": return {f:sum(sorted(v)[-3:])/min(3,len(v)) for f,v in d.items()}
    hit=mrr=allk=0
    for q in qs:
        dv=norm(agg_f(E@emb(q["q"]))); lv=norm(agg_f(bm(q["q"])))
        sc={k:w*dv.get(k,0)+(1-w)*lv.get(k,0) for k in set(dv)|set(lv)}
        r=[k for k,_ in sorted(sc.items(),key=lambda kv:-kv[1])]
        g=q["gold"]
        if any(x in r[:5] for x in g): hit+=1
        if all(x in r[:5] for x in g): allk+=1
        for i,f in enumerate(r[:50]):
            if f in g: mrr+=1/(i+1); break
    n=len(qs)
    print(f"{tag:28} {label:6} {agg:5} w={w:.1f}  r@5={hit/n*100:5.0f}%  MRR={mrr/n:.3f}  all@5={allk/n*100:4.0f}%")
    return hit/n*100, mrr/n

print("DEV (25) then SEALED (65). 300w is the shipped config.\n")
for label,qs in [("dev",dev),("SEALED",test)]:
    run("300w baseline","chunks.json","emb.npy","mean",0.7,qs,label)
    for agg in ["mean","max","top3"]:
        run("75w","chunks75.json","emb75.npy",agg,0.7,qs,label)
    print()
