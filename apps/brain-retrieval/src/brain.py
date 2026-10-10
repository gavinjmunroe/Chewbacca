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
import urllib.request, urllib.error, urllib.parse, collections, subprocess
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
EMBED_TIMEOUT = float(os.environ.get("BRAIN_EMBED_TIMEOUT", "0.120"))
                        # seconds. Past this, serve lexical and SAY it degraded.
                        # Measured: warm p50 12ms, cold-process median ~90ms,
                        # model-not-resident 460ms. On 2026-10-09 at load
                        # average 25 to 32, fifteen cold-process calls to a
                        # resident model took 33 to 100ms, so the bar holds
                        # when the model is loaded. See WARM for when it is not.
KEEP_ALIVE = "2h"       # how long Ollama keeps the model resident after a call.
                        # Was 30m. Any gap longer than this unloads the model,
                        # and the next ask pays a reload (see WARM). The model
                        # is 268MB resident, so the longer hold is cheap.
WARM_TIMEOUT = 60       # seconds the detached warm-up waits for a load. A load
                        # measured 280ms on 2026-10-09 at load average 25; the
                        # minute is for a Mac at load 100, not the normal case.
def ollama_url():
    """Ollama's address, loopback only. Every prompt the recall hook sees is
    sent here to be embedded, so an OLLAMA_HOST pointing off the machine would
    ship each typed prompt to that host. Anything not loopback is ignored."""
    default = "http://localhost:11434"
    raw = os.environ.get("OLLAMA_HOST", default).strip().rstrip("/")
    if "://" not in raw:
        raw = "http://" + raw
    try:
        host = urllib.parse.urlsplit(raw).hostname or ""
    except ValueError:
        return default
    return raw if host in ("localhost", "127.0.0.1", "::1") else default

OLLAMA = ollama_url()

def die(m, code=2):
    print(f"brain: {m}", file=sys.stderr); sys.exit(code)

# ---------------------------------------------------------------- embedding
def _post(payload, timeout):
    req = urllib.request.Request(OLLAMA + "/api/embed",
        data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())["embeddings"]

def embed(texts, timeout=300, keep_alive=KEEP_ALIVE):
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

# WARM. The failure this exists for, found 2026-10-09 in Ollama's server log:
# nomic-embed-text was started 568 times that day and almost never finished.
# When the model is not resident, a load takes ~280ms, the ask gives up at
# EMBED_TIMEOUT (120ms) and closes the connection, and Ollama logs "client
# connection closed before llama-server finished loading, aborting load". So
# the model never became resident through the ask path at all, and every ask
# after it hit the same wall. The brain-recall hook's own log shows the cost:
# 1,674 of 2,140 real prompts since 10/3 came back lexical, so the hook stayed
# silent on 78% of everything typed. It only worked in the half hour after
# something else (the 4am index, a manual run) loaded the model.
#
# The ask still answers lexically on a timeout, but it now starts one detached
# process that waits out the load, so the next ask finds the model resident.
def spawn_warm():
    os.makedirs(HOME, exist_ok=True)
    lock = os.path.join(HOME, "warm.lock")
    # One warm-up at a time across every tab. A lock older than WARM_TIMEOUT
    # belongs to a warm-up that died, so it no longer counts.
    try:
        if time.time() - os.path.getmtime(lock) < WARM_TIMEOUT:
            return False
    except OSError:
        pass
    try:
        with open(lock, "w") as fh: fh.write(str(os.getpid()))
        subprocess.Popen([sys.executable, os.path.abspath(__file__), "warm"],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True,
                         env=dict(os.environ, BRAIN_DIR=BRAIN))
        return True
    except OSError:
        return False

def cmd_warm(args):
    lock = os.path.join(HOME, "warm.lock")
    try:
        _post({"model": MODEL, "input": ["warm"], "keep_alive": KEEP_ALIVE}, WARM_TIMEOUT)
        ok = True
    except Exception:
        ok = False
    try: os.remove(lock)
    except OSError: pass
    if not getattr(args, "quiet", True):
        print("warm" if ok else "warm failed")
    sys.exit(0 if ok else 1)

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

def extra_roots():
    """Folders indexed beside the brain, named by where they live.

    On 2026-10-09 the Amber, Chewbacca and Firm Foundation notes, about 180
    files, moved out of the private brain into this kit's team/memory so every
    teammate reads them. The brain was the only thing indexed, so recall went
    blind to all of them at once. The kit's own team memory is indexed by
    default; BRAIN_EXTRA_DIRS (colon-separated) replaces that list, and an
    empty value turns it off."""
    env = os.environ.get("BRAIN_EXTRA_DIRS")
    if env is not None:
        roots = [os.path.expanduser(r) for r in env.split(":") if r]
    else:
        kit = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
            os.path.realpath(__file__)))))
        roots = [os.path.join(kit, "team", "memory")]
    return [os.path.realpath(r) for r in roots if os.path.isdir(r)]

def label(path):
    """A brain file is named relative to the brain, as it always was. Anything
    else is named from ~ so a reader can open it from the name alone."""
    home = os.path.realpath(os.path.expanduser("~"))
    real = os.path.realpath(path)
    if real.startswith(home + os.sep):
        return "~/" + os.path.relpath(real, home)
    return real

def walk():
    docs = []
    found = [(os.path.relpath(p, BRAIN), p) for d in DIRS
             for p in glob.glob(os.path.join(BRAIN, d, "**", "*.md"), recursive=True)]
    for root in extra_roots():
        found += [(label(p), p) for p in glob.glob(os.path.join(root, "**", "*.md"), recursive=True)]
    for rel, p in found:
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

def sha(txt):
    return hashlib.blake2b(txt.encode(), digest_size=16).hexdigest()

def npy_path(db):
    """The vectors that match this database's rows. Each build writes a new
    file and names it in meta in the same transaction as the rows, so an ask
    never pairs new rows with old vectors. Indexes built before that carry no
    name and use emb.npy."""
    try:
        row = db.execute("SELECT v FROM meta WHERE k='npy'").fetchone()
    except sqlite3.OperationalError:
        row = None
    return os.path.join(HOME, row[0]) if row else NPY

def previous(db):
    """What the last build left: each file's sha and its chunks with vectors,
    or None when there is nothing safe to reuse."""
    try:
        meta = dict(db.execute("SELECT k,v FROM meta"))
        if meta.get("model") != MODEL or meta.get("dim") != str(DIM): return None
        E = np.load(npy_path(db))
        rows = db.execute("SELECT file,section,text,row FROM chunk ORDER BY id").fetchall()
        shas = dict(db.execute("SELECT path,sha FROM file"))
    except Exception:
        return None
    if len(rows) != E.shape[0]: return None
    by_file = collections.defaultdict(list)
    for f, sec, text, row in rows:
        by_file[f].append(({"file": f, "section": sec, "text": text}, E[row]))
    return shas, by_file

def cmd_index(args):
    """Index the brain. By default only files whose bytes changed are
    re-chunked and re-embedded; --full re-embeds everything.

    Full rebuild measured 85s on 476 files. The 4am job was the only thing
    rebuilding, so a memory written at noon was invisible to brain-recall until
    the next morning: on 2026-10-09 the 20 newest memories, the ones most
    likely to matter that day, were the 20 stale files."""
    os.makedirs(HOME, exist_ok=True)
    t0 = time.time()
    docs = walk()
    db = sqlite3.connect(DB); db.executescript(SCHEMA)
    prev = None if args.full else previous(db)
    shas_old, reuse = prev if prev else ({}, {})
    chunks, vecs, fresh = [], [], []
    for rel, txt in docs:
        h = sha(txt)
        if shas_old.get(rel) == h and rel in reuse:
            for c, v in reuse[rel]:
                chunks.append(c); vecs.append(v)
        else:
            for c in chunk_file(rel, txt):
                fresh.append(len(chunks)); chunks.append(c); vecs.append(None)
    gone = sorted(set(shas_old) - {r for r, _ in docs})
    changed = sorted({chunks[i]["file"] for i in fresh})
    if prev and not changed and not gone:
        db.close()
        if not args.quiet: print(f"files {len(docs)}  up to date")
        return
    if not args.quiet:
        print(f"files {len(docs)}  chunks {len(chunks)}  "
              f"{'re-embedding ' + str(len(fresh)) if prev else 'embedding all ' + str(len(fresh))}"
              f"  changed {len(changed)}  removed {len(gone)}", flush=True)
    new = embed([chunks[i]["embed"] for i in fresh])
    for i, v in zip(fresh, new):
        v = np.asarray(v, dtype="float32")
        vecs[i] = v / (np.linalg.norm(v) + 1e-9)
    E = np.asarray(vecs, dtype="float32").reshape(len(chunks), DIM)
    name = f"emb-{int(time.time()*1000)}.npy"
    np.save(os.path.join(HOME, name), E)
    with db:
        db.execute("DELETE FROM chunk"); db.execute("DELETE FROM fts"); db.execute("DELETE FROM file")
        db.executemany("INSERT INTO chunk(file,ord,section,text,row) VALUES(?,?,?,?,?)",
                       [(c["file"], i, c["section"], c["text"], i) for i, c in enumerate(chunks)])
        db.execute("INSERT INTO fts(rowid,text) SELECT id,text FROM chunk")
        db.executemany("INSERT INTO file(path,sha) VALUES(?,?)", [(r, sha(t)) for r, t in docs])
        for k, v in [("model", MODEL), ("dim", str(DIM)), ("built_at", str(time.time())),
                     ("n", str(len(chunks))), ("npy", name)]:
            db.execute("INSERT OR REPLACE INTO meta VALUES(?,?)", (k, v))
    db.close()
    # Keep the newest two vector files: an ask that read the old meta a moment
    # ago may still be about to open the previous one.
    olds = sorted(glob.glob(os.path.join(HOME, "emb-*.npy")), key=os.path.getmtime)
    for f in olds[:-2] + ([NPY] if os.path.exists(NPY) else []):
        try: os.remove(f)
        except OSError: pass
    if not args.quiet:
        print(f"indexed in {time.time()-t0:.1f}s  {E.nbytes/1e6:.1f}MB", flush=True)

def stale_files(db):
    have = dict(db.execute("SELECT path,sha FROM file"))
    out = []
    for rel, txt in walk():
        if have.get(rel) != sha(txt): out.append(rel)
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

def classify(e):
    """Name why the query embedding failed. Only a timeout means a model load
    is in flight (or about to be), so only a timeout is worth a warm-up."""
    reason = getattr(e, "reason", e)
    text = str(reason).lower()
    if isinstance(reason, TimeoutError) or "timed out" in text:
        return "embed_timeout"
    if isinstance(reason, ConnectionError) or "refused" in text:
        return "ollama_down"
    return "embed_error"

def cmd_ask(args):
    if not os.path.exists(DB): die("no index. run: brain index", 2)
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, isolation_level=None)
    db.execute("BEGIN")     # rows and the vector file name from one snapshot
    rows = db.execute("SELECT id,file,section,text,row FROM chunk ORDER BY id").fetchall()
    E = np.load(npy_path(db))
    db.execute("COMMIT")
    degraded, dense = None, None
    try:
        # _post, not embed(): embed() swallows a failure, retries it once and
        # returns a zero vector, so every outage used to read as a timeout and
        # every timeout sent two requests that each aborted a model load.
        q = np.asarray(_post({"model": MODEL, "input": [args.query],
                              "keep_alive": KEEP_ALIVE}, EMBED_TIMEOUT)[0], dtype="float32")
        if np.linalg.norm(q) < 1e-6: raise ValueError("zero vector")
        q /= np.linalg.norm(q)
        dense = E @ q
    except Exception as e:
        degraded = classify(e)
        if degraded == "embed_timeout":
            spawn_warm()

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
    ix = sub.add_parser("index"); ix.add_argument("--full", action="store_true")
    ix.add_argument("--quiet", action="store_true"); ix.set_defaults(fn=cmd_index)
    sub.add_parser("warm").set_defaults(fn=cmd_warm, quiet=False)
    a = sub.add_parser("ask"); a.add_argument("query"); a.add_argument("--k", type=int, default=5)
    a.add_argument("--width", type=int, default=300); a.set_defaults(fn=cmd_ask)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    args = p.parse_args(); args.fn(args)

if __name__ == "__main__":
    main()
