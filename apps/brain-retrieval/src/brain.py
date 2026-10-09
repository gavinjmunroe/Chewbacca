#!/usr/bin/env python3
"""
brain: local retrieval over a markdown second brain.

The configuration here is not a guess. Every constant was measured on a sealed
73-question test set that was built by a different process than the one that
tuned these values. See findings/RESULTS.md. Numbers that could plausibly be
different carry the measurement that set them.

No network calls leave localhost. No vector database. No API keys.
"""
import os, re, sys, json, math, time, glob, sqlite3, hashlib, argparse
import urllib.request, urllib.error, collections
import numpy as np

BRAIN = os.environ.get("BRAIN_DIR", os.path.expanduser("~/second-brain"))
HOME  = os.path.join(BRAIN, ".brain")
DB    = os.path.join(HOME, "index.db")
NPY   = os.path.join(HOME, "emb.npy")
DIRS  = ["core", "domains", "memory", "projects", "systems", "wiki"]
MODEL = "nomic-embed-text"
DIM   = 768

# Tuned on the 25-query dev set, confirmed on the sealed 73. Dev said 80% r@5,
# the sealed set said 68%. That 12-point gap is why the set was sealed.
W_DENSE = 0.70      # dense/lexical fusion weight. 0.5 and 1.0 both scored lower.
AGG     = "mean"    # chunk->file aggregation. max scored 64% where mean scored 80%
                    # on dev; the single largest win found, bigger than the model.
TARGET_WORDS, OVERLAP = 300, 60
MAXTOK   = 40       # a token longer than this is a base64 blob, not language. One
                    # 234KB token in a club-application file crashed the first
                    # indexing run at chunk ~1300 with an opaque HTTP 500.
MAXCHARS = 6000     # nomic-embed-text ctx is 8192 tokens; stay well under.
ABSTAIN  = 0.55     # top cosine below this means say nothing. At 0.55 the sealed
                    # set abstained on 8/8 questions whose answers do not exist,
                    # and wrongly abstained on only 2 of 65 real ones.
EMBED_TIMEOUT = 0.120   # seconds. Past this, serve lexical and SAY it degraded.
                        # Measured: warm p50 12ms, cold-process median ~90ms,
                        # model-not-resident 460ms.

def die(m, code=2):
    print(f"brain: {m}", file=sys.stderr); sys.exit(code)

# ---------------------------------------------------------------- embedding
def _post(payload, timeout):
    req = urllib.request.Request("http://localhost:11434/api/embed",
        data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())["embeddings"]

def embed(texts, timeout=300, keep_alive="30m"):
    out = []
    for i in range(0, len(texts), 64):
        batch = texts[i:i+64]
        try:
            out.extend(_post({"model": MODEL, "input": batch, "keep_alive": keep_alive}, timeout))
        except Exception:
            for t in batch:                      # isolate the poison chunk
                try:    out.extend(_post({"model": MODEL, "input": [t], "keep_alive": keep_alive}, timeout))
                except Exception: out.append([0.0]*DIM)
    return out

# ---------------------------------------------------------------- chunking
def frontmatter(txt):
    m = re.match(r"^---\n(.*?)\n---\n", txt, re.S)
    if not m: return {}, txt
    fm = {}
    for line in m.group(1).splitlines():
        if ":" in line and not line.startswith(" "):
            k, v = line.split(":", 1); fm[k.strip()] = v.strip()
    return fm, txt[m.end():]

def clean(t):
    return " ".join(w for w in t.split() if len(w) <= MAXTOK)

def chunk_file(rel, txt):
    fm, body = frontmatter(txt)
    header = rel + (f" | {fm['description']}" if fm.get("description") else "")
    parts, cur, head = [], [], ""
    lineno, starts = 1, []
    for line in body.splitlines():
        if re.match(r"^#{1,3} ", line):
            if cur: parts.append((head, "\n".join(cur))); cur = []
            head = line.lstrip("# ").strip()
        else: cur.append(line)
    if cur: parts.append((head, "\n".join(cur)))
    if not parts: parts = [("", body)]
    out = []
    for h, seg in parts:
        words = seg.split()
        i = 0
        while i < len(words):
            text = " ".join(words[i:i+TARGET_WORDS])
            ctx = (f"{header}\n## {h}\n{clean(text)}" if h else f"{header}\n{clean(text)}")[:MAXCHARS]
            if len(ctx.split()) >= 5:
                out.append({"file": rel, "section": h, "text": text, "embed": ctx})
            if i + TARGET_WORDS >= len(words): break
            i += TARGET_WORDS - OVERLAP
    return out

def walk():
    docs = []
    for d in DIRS:
        for p in glob.glob(os.path.join(BRAIN, d, "**", "*.md"), recursive=True):
            rel = os.path.relpath(p, BRAIN)
            if os.path.basename(rel) in ("MEMORY.md", "ARCHIVE.md"): continue
            try: t = open(p, encoding="utf-8", errors="replace").read()
            except Exception: continue
            if t.strip(): docs.append((rel, t))
    return docs

# ---------------------------------------------------------------- index
SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS chunk (
  id INTEGER PRIMARY KEY, file TEXT NOT NULL, ord INTEGER NOT NULL,
  section TEXT NOT NULL DEFAULT '', text TEXT NOT NULL, row INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS chunk_file_idx ON chunk(file);
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
  text, content='chunk', content_rowid='id',
  tokenize='porter unicode61 remove_diacritics 2');
CREATE TABLE IF NOT EXISTS file (path TEXT PRIMARY KEY, sha TEXT NOT NULL);
"""

def cmd_index(args):
    os.makedirs(HOME, exist_ok=True)
    t0 = time.time()
    docs = walk()
    chunks = []
    for rel, txt in docs: chunks.extend(chunk_file(rel, txt))
    print(f"files {len(docs)}  chunks {len(chunks)}", flush=True)
    vecs = embed([c["embed"] for c in chunks])
    E = np.asarray(vecs, dtype="float32")
    E /= (np.linalg.norm(E, axis=1, keepdims=True) + 1e-9)
    np.save(NPY, E)
    db = sqlite3.connect(DB); db.executescript(SCHEMA)
    db.execute("DELETE FROM chunk"); db.execute("DELETE FROM fts"); db.execute("DELETE FROM file")
    db.executemany("INSERT INTO chunk(file,ord,section,text,row) VALUES(?,?,?,?,?)",
                   [(c["file"], i, c["section"], c["text"], i) for i, c in enumerate(chunks)])
    db.execute("INSERT INTO fts(rowid,text) SELECT id,text FROM chunk")
    db.executemany("INSERT INTO file(path,sha) VALUES(?,?)",
                   [(r, hashlib.blake2b(t.encode(), digest_size=16).hexdigest()) for r, t in docs])
    for k, v in [("model", MODEL), ("dim", str(DIM)), ("built_at", str(time.time())),
                 ("n", str(len(chunks)))]:
        db.execute("INSERT OR REPLACE INTO meta VALUES(?,?)", (k, v))
    db.commit(); db.close()
    print(f"indexed in {time.time()-t0:.0f}s  {E.nbytes/1e6:.1f}MB", flush=True)

def stale_files(db):
    have = dict(db.execute("SELECT path,sha FROM file"))
    out = []
    for rel, txt in walk():
        sha = hashlib.blake2b(txt.encode(), digest_size=16).hexdigest()
        if have.get(rel) != sha: out.append(rel)
    return out

# ---------------------------------------------------------------- query
def norm(d):
    if not d: return d
    v = list(d.values()); lo, hi = min(v), max(v)
    return {k: (x-lo)/(hi-lo+1e-9) for k, x in d.items()}

def agg_by_file(pairs):
    d = collections.defaultdict(list)
    for f, s in pairs: d[f].append(s)
    return {f: (sum(v)/len(v) if AGG == "mean" else max(v)) for f, v in d.items()}

def cmd_ask(args):
    if not os.path.exists(DB): die("no index. run: brain index", 2)
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = db.execute("SELECT id,file,section,text,row FROM chunk ORDER BY id").fetchall()
    E = np.load(NPY)
    degraded, dense = None, None
    try:
        q = np.asarray(embed([args.query], timeout=EMBED_TIMEOUT)[0], dtype="float32")
        if np.linalg.norm(q) < 1e-6: raise ValueError("zero vector")
        q /= np.linalg.norm(q)
        dense = E @ q
    except urllib.error.URLError: degraded = "ollama_down"
    except Exception:             degraded = "embed_timeout"

    lex = {}
    try:
        fq = " OR ".join(re.findall(r"[A-Za-z]{3,}", args.query))
        if fq:
            for cid, sc in db.execute(
                "SELECT rowid,-bm25(fts) FROM fts WHERE fts MATCH ? LIMIT 400", (fq,)):
                lex[cid] = sc
    except sqlite3.OperationalError: pass

    dv = agg_by_file([(r[1], float(dense[r[4]])) for r in rows]) if dense is not None else {}
    lv = agg_by_file([(r[1], lex.get(r[0], 0.0)) for r in rows])
    dvn, lvn = norm(dv), norm(lv)
    w = W_DENSE if dense is not None else 0.0
    score = {k: w*dvn.get(k, 0) + (1-w)*lvn.get(k, 0) for k in set(dvn) | set(lvn)}
    ranked = sorted(score.items(), key=lambda kv: -kv[1])[:args.k]

    top_cos = max(dv.values()) if dv else 0.0
    st = stale_files(db)
    print(f"# brain mode={'hybrid' if dense is not None else 'lexical'}"
          f"{' degraded='+degraded if degraded else ''}"
          f" files={len({r[1] for r in rows})} chunks={len(rows)}"
          f"{' index=STALE('+str(len(st))+')' if st else ''}")
    if dense is not None and top_cos < ABSTAIN:
        print(f"# top cosine {top_cos:.3f} is below the abstain threshold {ABSTAIN}.")
        print("# Nothing in the brain answers this. Say so rather than guessing.")
        return
    best = {}
    for r in rows:
        s = float(dense[r[4]]) if dense is not None else lex.get(r[0], 0.0)
        if r[1] not in best or s > best[r[1]][0]: best[r[1]] = (s, r[2], r[3])
    for i, (f, sc) in enumerate(ranked, 1):
        s, sec, txt = best.get(f, (0, "", ""))
        flag = " [stale]" if f in st else ""
        print(f"\n[{i}] {f}{('#'+sec) if sec else ''} cos={s:.2f}{flag}")
        print("    " + " ".join(txt.split())[:args.width])

def cmd_status(args):
    if not os.path.exists(DB): print("no index"); return
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    m = dict(db.execute("SELECT k,v FROM meta"))
    st = stale_files(db)
    print(f"model {m.get('model')}  chunks {m.get('n')}  "
          f"built {time.strftime('%Y-%m-%d %H:%M', time.localtime(float(m.get('built_at',0))))}")
    print(f"stale files: {len(st)}")
    for f in st[:10]: print("  ", f)

def main():
    p = argparse.ArgumentParser(prog="brain")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("index").set_defaults(fn=cmd_index)
    a = sub.add_parser("ask"); a.add_argument("query"); a.add_argument("--k", type=int, default=5)
    a.add_argument("--width", type=int, default=300); a.set_defaults(fn=cmd_ask)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    args = p.parse_args(); args.fn(args)

if __name__ == "__main__":
    main()
