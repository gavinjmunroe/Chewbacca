#!/usr/bin/env python3
"""Stage 0+1 from the ontology: resolve every [[link]] and assign a relation
by POSITION, with zero LLM calls. Whatever position cannot decide is what the
LLM pass has to handle, and that count is the real cost of the migration."""
import os, re, glob, json, collections

BRAIN = __import__("os").environ.get("CHEWBACCA_BRAIN", __import__("os").path.expanduser("~/second-brain"))
DIRS=["core","domains","memory","projects","systems","wiki","log"]

# filename -> path, for resolution
index=collections.defaultdict(list)
paths=[]
for d in DIRS:
    for p in glob.glob(os.path.join(BRAIN,d,"**","*.md"),recursive=True):
        rel=os.path.relpath(p,BRAIN); paths.append(rel)
        base=os.path.basename(p)
        index[base].append(rel)
        index[base[:-3]].append(rel)            # without .md
        index[base[:-3].lower()].append(rel)

def resolve(target,src):
    t=target.split("|")[0].split("#")[0].strip()
    t=t.replace("\\","/")
    cands=[t, os.path.basename(t), os.path.basename(t)+".md",
           os.path.basename(t).lower(), os.path.basename(t).lower()+".md"]
    # relative to source dir first
    guess=os.path.normpath(os.path.join(os.path.dirname(src),t))
    if not guess.endswith(".md"): guess+=".md"
    if guess in paths: return guess
    for c in cands:
        if c in index and index[c]: return index[c][0]
    return None

# positional priors from the ontology spec
PRIOR=[
 (r"\[!contradiction\]",                         "CONTRADICTS"),
 (r"\bsupersed|\breplaces\b|\bobsolet",           "SUPERSEDES"),
 (r"\bconfirmed by\b|\bevidence\b|\bproof\b|\bverified (?:by|in)\b|\bper\b\s*$","EVIDENCE_FOR"),
 (r"\bcaused\b|\bbecause of\b|\bled to\b|\bafter\b.*\bso\b","CAUSED"),
 (r"^\s*(?:related|see also|links?)\s*:",         "MENTIONS"),
 (r"\bread\b.*\bfirst\b|\bbefore\b.*\b(writing|advising|building)\b","CONSTRAINS"),
 (r"\bwrote\b|\bsaid\b|\bhis phrase\b|\baccording to\b","SAID_BY"),
 (r"\bderived from\b|\bwritten after\b|\bthe incident\b|\bset by\b","DERIVED_FROM"),
]

edges=[]; unresolved=[]
for rel in paths:
    try: txt=open(os.path.join(BRAIN,rel),encoding="utf-8",errors="replace").read()
    except Exception: continue
    for ln,line in enumerate(txt.splitlines(),1):
        for m in re.finditer(r"\[\[([^\]]+)\]\]",line):
            tgt=resolve(m.group(1),rel)
            ctx=line.strip()
            relation=None
            for pat,r_ in PRIOR:
                if re.search(pat,ctx,re.I): relation=r_; break
            if tgt is None:
                unresolved.append({"src":rel,"raw":m.group(1),"line":ln}); continue
            edges.append({"src":rel,"dst":tgt,"line":ln,
                          "relation":relation or "UNTYPED","ctx":ctx[:200]})

typed=[e for e in edges if e["relation"]!="UNTYPED"]
untyped=[e for e in edges if e["relation"]=="UNTYPED"]
print(f"files scanned      : {len(paths)}")
print(f"links found        : {len(edges)+len(unresolved)}")
print(f"  resolved         : {len(edges)}")
print(f"  BROKEN           : {len(unresolved)}")
print()
print(f"typed by position  : {len(typed)}  ({len(typed)/max(len(edges),1)*100:.0f}%)  cost: 0 LLM calls")
print(f"need an LLM pass   : {len(untyped)}")
print()
print("relation distribution (positional pass):")
for r,c in collections.Counter(e["relation"] for e in typed).most_common():
    print(f"  {r:14} {c:5}")
print()
# how many SOURCE FILES would the LLM pass touch? that is the real call count
srcs=len({e['src'] for e in untyped})
print(f"LLM calls needed   : {srcs} (one per source note, not one per link)")
print()
print("top broken link targets:")
for t,c in collections.Counter(u["raw"] for u in unresolved).most_common(10):
    print(f"  {c:3}x  {t[:70]}")
print()
# degree, to find the hubs the human must review
deg=collections.Counter()
for e in edges: deg[e["dst"]]+=1
print("highest inbound degree (review these by hand):")
for f,c in deg.most_common(8): print(f"  {c:3}  {f}")
json.dump({"edges":edges,"unresolved":unresolved},open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"graph0.json"),"w"))
