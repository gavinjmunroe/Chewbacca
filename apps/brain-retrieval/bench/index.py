#!/usr/bin/env python3
"""Chunk + embed the personal brain locally. No service, no network beyond localhost."""
import os, re, json, glob, time, urllib.request, hashlib, sys

BRAIN = "/Users/joelnewton/second-brain"
DIRS  = ["core", "domains", "memory", "projects", "systems", "wiki"]
OUT   = os.path.dirname(os.path.abspath(__file__))
MODEL = "nomic-embed-text"
TARGET_WORDS = 300          # ~400 tokens
OVERLAP_WORDS = 60

def read_files():
    docs = []
    for d in DIRS:
        for p in glob.glob(os.path.join(BRAIN, d, "**", "*.md"), recursive=True):
            rel = os.path.relpath(p, BRAIN)
            if rel.endswith(("MEMORY.md", "ARCHIVE.md")):
                continue
            try:
                txt = open(p, encoding="utf-8", errors="replace").read()
            except Exception:
                continue
            if txt.strip():
                docs.append((rel, txt))
    return docs

def frontmatter(txt):
    m = re.match(r"^---\n(.*?)\n---\n", txt, re.S)
    if not m: return {}, txt
    fm = {}
    for line in m.group(1).splitlines():
        if ":" in line and not line.startswith(" "):
            k, v = line.split(":", 1)
            fm[k.strip()] = v.strip()
    return fm, txt[m.end():]

MAXTOK = 40          # a "word" longer than this is a blob, not language
MAXCHARS = 6000      # nomic-embed-text ctx is 8192 tokens; stay well under

def clean(t):
    return " ".join(w for w in t.split() if len(w) <= MAXTOK)

def chunk(rel, txt):
    """Split on headings first, then pack to TARGET_WORDS with overlap."""
    fm, body = frontmatter(txt)
    header = f"{rel}"
    if fm.get("description"): header += f" | {fm['description']}"
    parts, cur, curhead = [], [], ""
    for line in body.splitlines():
        if re.match(r"^#{1,3} ", line):
            if cur: parts.append((curhead, "\n".join(cur))); cur = []
            curhead = line.lstrip("# ").strip()
        else:
            cur.append(line)
    if cur: parts.append((curhead, "\n".join(cur)))
    if not parts: parts = [("", body)]

    out = []
    for head, seg in parts:
        words = seg.split()
        if not words: continue
        i = 0
        while i < len(words):
            w = words[i:i+TARGET_WORDS]
            text = " ".join(w)
            # prepend file + section context so the embedding knows where it lives
            ctx = (f"{header}\n## {head}\n{clean(text)}" if head else f"{header}\n{clean(text)}")[:MAXCHARS]
            if len(ctx.split()) < 5:
                i += TARGET_WORDS - OVERLAP_WORDS
                continue
            out.append({"file": rel, "section": head, "text": text, "embed_text": ctx})
            if i + TARGET_WORDS >= len(words): break
            i += TARGET_WORDS - OVERLAP_WORDS
    return out

def _post(payload):
    req = urllib.request.Request("http://localhost:11434/api/embed",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read())["embeddings"]

def embed(texts, batch_log=True, B=64):
    vecs, t0 = [], time.time()
    for i in range(0, len(texts), B):
        batch = texts[i:i+B]
        try:
            vecs.extend(_post({"model": MODEL, "input": batch}))
        except Exception as e:
            print(f"  batch {i} failed ({e}), falling back per-item", flush=True)
            for t in batch:
                try: vecs.extend(_post({"model": MODEL, "input": [t]}))
                except Exception as e2:
                    print(f"    SKIP len={len(t)} {e2}", flush=True)
                    vecs.append([0.0]*768)
        if batch_log and i and (i//B) % 5 == 0:
            el = time.time()-t0
            print(f"  {i}/{len(texts)}  {el:.0f}s  eta {el/max(i,1)*(len(texts)-i):.0f}s", flush=True)
    return vecs, time.time()-t0

if __name__ == "__main__":
    docs = read_files()
    chunks = []
    for rel, txt in docs:
        chunks.extend(chunk(rel, txt))
    print(f"files: {len(docs)}  chunks: {len(chunks)}", flush=True)
    json.dump(chunks, open(f"{OUT}/chunks.json", "w"))

    vecs, elapsed = embed([c["embed_text"] for c in chunks])
    import numpy as np
    E = np.array(vecs, dtype="float32")
    E /= (np.linalg.norm(E, axis=1, keepdims=True) + 1e-9)
    np.save(f"{OUT}/emb.npy", E)
    print(f"embedded {len(vecs)} chunks in {elapsed:.1f}s  dim={E.shape[1]}  "
          f"size={E.nbytes/1e6:.1f}MB", flush=True)
