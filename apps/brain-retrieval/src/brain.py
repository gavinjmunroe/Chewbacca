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
# A second embedding model, averaged with nomic per chunk, 2026-10-13 night
# (bench/ensemble.py). nomic alone and mxbai alone each miss paraphrases the
# other finds: on dev3, mxbai alone lost 8 queries and won 5. Averaged at 0.5
# after feedback in each model's own space: dev+dev2+dev3 +10 -5, and the one
# sealed run (bench/frozen/ensemble_mxbai.json) 52.3% -> 56.9%, +3 -0, the
# first ranker over the 55.4% recall gate. Optional: with the model not pulled
# (`ollama pull mxbai-embed-large`) or BRAIN_MODEL2 empty, brain is nomic only.
MODEL2 = os.environ.get("BRAIN_MODEL2", "mxbai-embed-large")
ENS_W  = 0.5        # dev: 0.3 and 0.5 both +5 net; 0.5 had the higher MRR
                    # (dev3 0.463 vs 0.447). 1.0 (mxbai alone) lost 3 net on dev3.
Q2_PREFIX = "Represent this sentence for searching relevant passages: "
                    # mxbai's documented query instruction; documents get none.
MAXCHARS2 = 2000    # mxbai reads 512 tokens; the bench cut chunks here too.

# Tuned on the 25-query dev set, confirmed on the sealed 73. Dev said 80% r@5,
# the sealed set said 68%. That 12-point gap is why the set was sealed.
W_DENSE = 0.70      # dense/lexical fusion weight. 0.5 and 1.0 both scored lower.
AGG     = "mean"    # chunk->file aggregation. max scored 64% where mean scored 80%
                    # on dev; the single largest win found, bigger than the model.
# Hub files, 2026-10-10. Long domains/ subfolders filled the top 5 for questions
# they do not answer. Swept on dev (25) against a 717-file snapshot, sealed run
# once; bench/hubs.py reproduces it and TODO.md has the table.
FOLDER_CAP  = 1     # files per domains/<x> subfolder in the top k. Dev: tie at
                    # 68% r@5, MRR 0.536 -> 0.542. Sealed: 52.3% -> 55.4%.
CHUNK_ALPHA = 0.0   # dense mean * chunks^-alpha. Off: 0.01 cost 4 points on dev,
                    # 0.1 cost 12, 1.0 cost 52. Short one-chunk notes flood in.
LEX_LEN_B   = 0.0   # BM25-style length divisor on the lexical file score. Off:
                    # best case tied baseline r@5 and lowered MRR at every b.
# Lone hub files, 2026-10-10, bench/lone.py. rank() takes top_m, unit, hub,
# hub_beta, csls and lone_cap so the bench can sweep them; all stay off. Best
# chunks, section units, corpus k-occurrence, CSLS and a lone-file cap all tied
# or lost on dev. Query-space hubness (beta 0.1) took dev 68% -> 80% and then
# the sealed set 55.4% -> 43.1%, run once. Do not turn one on without a new
# sealed run.
# Rank fusion, 2026-10-12 night, bench/cards.py. The sealed misses are questions
# worded unlike their note (dev2 finding), and dev3 (70 blind questions, 43 of
# them with no word of the note's name or description) reproduced the sealed
# number: shipped 44.3% there against 47.7% sealed. Its misses showed two
# shapes: a long gold note whose one matching chunk ranked 1st to 6th among
# all chunks but whose file mean sank under the other chunks, and min-max
# fusion handing the lexical side a full 0..1 spread even when every match
# was a stopword. So the file score became reciprocal-rank fusion of three
# lists, chunk-mean cosine, best-chunk cosine and lexical, plus one round of
# pseudo-relevance feedback on the dense side. Picked by net queries gained
# over all three dev sets (140): +17 -2 (dev3 alone 44.3% -> 57.1%). Pieces:
# RRF over mean and lexical +9 -4, adding best chunk +11 -2, feedback (0.6, 5)
# on top +17 -2. Counts are with tied scores sharing a rank (see _ranks).
FUSION  = "rrf3"    # "minmax" is the pre-2026-10-12 fusion, kept for the old tables
RRF_K   = 10        # dev sweep 5, 10, 20 tied on dev3 r@5; 10 kept the best MRR
                    # there. 60, the textbook default, lost 7 on dev2 (2-list RRF).
PRF_B, PRF_M = 0.6, 5   # query + 0.6 * mean of its top 5 chunks. Over rrf3 alone:
                    # dev3 +4, dev +2 -1, dev2 0. b=0.3 gained 2 fewer on dev3.
PROBE_W = 0.0       # doc2query list weight; off until measured (bench/cards.py)
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

def embed(texts, timeout=300, keep_alive=KEEP_ALIVE, model=MODEL, dim=DIM, fill=True):
    """fill=False leaves None where a text failed instead of a zero vector, for
    a caller that would rather skip a build than keep a zero row forever."""
    out = []
    for i in range(0, len(texts), 64):
        batch = texts[i:i+64]
        try:
            out.extend(_post({"model": model, "input": batch, "keep_alive": keep_alive}, timeout))
        except Exception:
            for t in batch:                      # isolate the poison chunk
                try:    out.extend(_post({"model": model, "input": [t], "keep_alive": keep_alive}, timeout))
                except Exception: out.append([0.0]*dim if fill else None)
    return out

# A Mac without the second model would otherwise probe Ollama on every
# 10-minute index run. Guessed, never measured: six hours caps that at four
# probes a day, and `brain index --full` always probes.
MODEL2_RETRY_S = 6 * 3600

def model2_ready(timeout=60, force=False):
    """The second model's dimension, or None when it is off or not pulled.
    One real call, so a missing model never turns into a file of zero vectors."""
    if not MODEL2: return None
    miss = os.path.join(HOME, "model2.miss")
    try:
        if not force and time.time() - os.path.getmtime(miss) < MODEL2_RETRY_S: return None
    except OSError:
        pass
    try:
        v = _post({"model": MODEL2, "input": ["ready"], "keep_alive": KEEP_ALIVE}, timeout)[0]
        if v:
            try: os.remove(miss)
            except OSError: pass
            return len(v)
    except Exception:
        pass
    try: open(miss, "w").close()
    except OSError: pass
    return None

def unit_rows(vecs, dim):
    E = np.asarray(vecs, dtype="float32").reshape(len(vecs), dim)
    return E / (np.linalg.norm(E, axis=1, keepdims=True) + 1e-9)

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
    if MODEL2:
        try: _post({"model": MODEL2, "input": ["warm"], "keep_alive": KEEP_ALIVE}, WARM_TIMEOUT)
        except Exception: pass
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

def embed_text(header, section, text):
    """The string a chunk is embedded as: where it lives, what the note says it
    is, its heading, its words. Stripping the path costs 12 points (RESULTS.md)."""
    return (f"{header}\n## {section}\n{clean(text)}" if section else f"{header}\n{clean(text)}")[:MAXCHARS]

def file_header(rel, txt):
    fm, _ = frontmatter(txt)
    return rel + (f" | {fm['description']}" if fm.get("description") else "")

def chunk_file(rel, txt):
    fm, body = frontmatter(txt)
    header = file_header(rel, txt)
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
            ctx = embed_text(header, h, text)
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

def npy2_path(db):
    """The second model's vectors for this database's rows, or None when the
    build that wrote them used another model or wrote none."""
    try:
        meta = dict(db.execute("SELECT k,v FROM meta"))
    except sqlite3.OperationalError:
        return None
    if not MODEL2 or meta.get("model2") != MODEL2 or not meta.get("npy2"): return None
    # Written by the same build as the rows, or it does not count. A brain.py
    # from before 2026-10-13 rewrites rows and built_at but never these keys,
    # so a kit still running it would leave npy2 naming vectors in the old order.
    if meta.get("built2") != meta.get("built_at"): return None
    p = os.path.join(HOME, meta["npy2"])
    return p if os.path.exists(p) else None

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
    E2 = None
    p2 = npy2_path(db)
    if p2:
        try:
            E2 = np.load(p2)
            if E2.shape[0] != len(rows): E2 = None
        except Exception:
            E2 = None
    by_file = collections.defaultdict(list)
    for f, sec, text, row in rows:
        by_file[f].append(({"file": f, "section": sec, "text": text}, E[row],
                           E2[row] if E2 is not None else None))
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
    chunks, vecs, vecs2, fresh, headers = [], [], [], [], {}
    for rel, txt in docs:
        h = sha(txt)
        headers[rel] = file_header(rel, txt)
        if shas_old.get(rel) == h and rel in reuse:
            for c, v, v2 in reuse[rel]:
                chunks.append(c); vecs.append(v); vecs2.append(v2)
        else:
            for c in chunk_file(rel, txt):
                fresh.append(len(chunks)); chunks.append(c); vecs.append(None); vecs2.append(None)
    gone = sorted(set(shas_old) - {r for r, _ in docs})
    changed = sorted({chunks[i]["file"] for i in fresh})
    # Ask Ollama for the second model only when there is something for it to
    # embed: with its vectors current, an unchanged index makes no call; without
    # the model, at most one probe per MODEL2_RETRY_S.
    need2 = [i for i, v in enumerate(vecs2) if v is None] if MODEL2 else []
    have2 = [v for v in vecs2 if v is not None]
    dim2 = model2_ready(force=args.full) if need2 else (
        len(have2[0]) if have2 and len(have2) == len(vecs2) else None)
    if not dim2: need2 = []
    if prev and not changed and not gone and not need2:
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
    name2 = None
    if dim2:
        # A reused chunk keeps no embed string, so rebuild it the way chunk_file did.
        new2 = embed([embed_text(headers[chunks[i]["file"]], chunks[i]["section"],
                                 chunks[i]["text"])[:MAXCHARS2] for i in need2],
                     model=MODEL2, dim=dim2, fill=False)
        for i, v in zip(need2, new2):
            vecs2[i] = None if v is None else np.asarray(v, dtype="float32")
        # One failed text and this build writes no second file: asks run on
        # nomic until the next build embeds them all. A zero row would have
        # sunk its chunk under the average for as long as its file stayed put.
        if all(v is not None and len(v) == dim2 for v in vecs2):
            name2 = f"emb2-{int(time.time()*1000)}.npy"
            np.save(os.path.join(HOME, name2), unit_rows(vecs2, dim2))
    with db:
        db.execute("DELETE FROM chunk"); db.execute("DELETE FROM fts"); db.execute("DELETE FROM file")
        db.executemany("INSERT INTO chunk(file,ord,section,text,row) VALUES(?,?,?,?,?)",
                       [(c["file"], i, c["section"], c["text"], i) for i, c in enumerate(chunks)])
        db.execute("INSERT INTO fts(rowid,text) SELECT id,text FROM chunk")
        db.executemany("INSERT INTO file(path,sha) VALUES(?,?)", [(r, sha(t)) for r, t in docs])
        built = str(time.time())
        for k, v in [("model", MODEL), ("dim", str(DIM)), ("built_at", built),
                     ("n", str(len(chunks))), ("npy", name)]:
            db.execute("INSERT OR REPLACE INTO meta VALUES(?,?)", (k, v))
        # Rows changed, so second-model vectors from an older build no longer line up.
        db.execute("DELETE FROM meta WHERE k IN ('model2','npy2','built2')")
        if name2:
            db.executemany("INSERT OR REPLACE INTO meta VALUES(?,?)",
                           [("model2", MODEL2), ("npy2", name2), ("built2", built)])
    db.close()
    # Keep the newest two vector files: an ask that read the old meta a moment
    # ago may still be about to open the previous one.
    olds = sorted(glob.glob(os.path.join(HOME, "emb-*.npy")), key=os.path.getmtime)
    olds2 = sorted(glob.glob(os.path.join(HOME, "emb2-*.npy")), key=os.path.getmtime)
    for f in olds[:-2] + olds2[:-2] + ([NPY] if os.path.exists(NPY) else []):
        try: os.remove(f)
        except OSError: pass
    if not args.quiet:
        print(f"indexed in {time.time()-t0:.1f}s  {E.nbytes/1e6:.1f}MB"
              f"  {MODEL2 + ' ' + str(len(need2)) if name2 else 'one model'}", flush=True)

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

def lexical(db, query):
    """BM25 score per chunk id from the FTS index. Empty when nothing matches."""
    lex = {}
    try:
        fq = " OR ".join(re.findall(r"[A-Za-z]{3,}", query))
        if fq:
            for cid, sc in db.execute(
                "SELECT rowid,-bm25(fts) FROM fts WHERE fts MATCH ? LIMIT 400", (fq,)):
                lex[cid] = sc
    except sqlite3.OperationalError: pass
    return lex

def folder(f):
    """The subfolder a brain file sits in, like domains/<topic>, or None.

    Top-level stores (memory/, core/, the team memory root) are flat lists of
    unrelated notes, so sharing one is not a sign two files say the same
    thing. A subfolder is: on 2026-10-09 most sealed misses lost to files from
    two domains/ subfolders that filled the top 5 together."""
    if f.startswith(("~", "/")): return None
    parts = f.split("/")
    return "/".join(parts[:2]) if len(parts) >= 3 else None

def topm_mean(v, m):
    """Mean of the m largest values; m=None is the plain mean."""
    if not m or m >= len(v): return sum(v) / len(v)
    return sum(sorted(v, reverse=True)[:m]) / m

def feedback(E, dense, b=None, m=None):
    """Cosines against the query moved toward its own top m chunks:
    E @ q' with q' = (q + b * mean(E[top m])) / |...|, computed from dense = E @ q
    alone, since q . mean = mean(dense[top]). Normalised so the result stays a
    cosine: csls subtracts on that scale, and doc2query compares against it.
    Used for ranking only: abstention and shown cosines stay raw."""
    b = PRF_B if b is None else b
    m = PRF_M if m is None else m
    if dense is None or E is None or not b or not m or len(dense) == 0:
        return dense
    top = np.argpartition(-dense, min(m, len(dense)) - 1)[:m]
    mean = E[top].mean(axis=0)
    size = math.sqrt(max(1.0 + 2*b*float(dense[top].mean()) + b*b*float(mean @ mean), 1e-12))
    return (dense + b * (E @ mean)) / size

def _ranks(d):
    """Competition rank: ties share the rank of the first of them. Ranking ties
    by name instead put every file with no lexical match in alphabetical
    order, so a 0.20-cosine note beat a 0.50 one on its name and team memory
    (~/ sorts last) always came last (review of 2026-10-12)."""
    out, prev, at = {}, None, 0
    for i, (u, v) in enumerate(sorted(d.items(), key=lambda kv: -kv[1])):
        if v != prev:
            prev, at = v, i
        out[u] = at
    return out

def rank(rows, dense, lex, k, alpha=None, folder_cap=None, len_b=None,
         top_m=None, unit="file", hub=None, hub_beta=0.0, csls=0.0, lone_cap=0,
         E=None, fusion=None, rrf_k=None, prf_b=None, probes=None, probe_w=None,
         probe_merge=False, dense2=None, E2=None):
    """Fuse dense and lexical scores per file and return the top k as
    [(file, score)], plus the per-file mean cosine used for abstention.

    rows are (id, file, section, text, row); dense is a cosine per vector row
    or None; lex maps chunk id to BM25. The knobs default to the tuned
    constants and are arguments only so the bench can sweep them: top_m
    aggregates over a unit's best m chunks, unit="section" ranks (file,
    heading) sections and scores a file by its best one, hub is hub_prior()'s
    output for hub_beta (k-occurrence discount) and csls (density penalty).
    E, the chunk vectors, turns on pseudo-relevance feedback (feedback());
    fusion picks rrf3 or the old minmax. dense2 and E2, the second model's
    cosines and vectors, average in at ENS_W after feedback in their own space.
    probes maps a file to its best
    doc2query question cosine (brain_d2q); under rrf3 it is a fourth list at
    weight probe_w, or with probe_merge it joins the best-chunk list."""
    fusion = FUSION if fusion is None else fusion
    rrf_k = RRF_K if rrf_k is None else rrf_k
    raw = dense
    if dense is not None and E is not None:
        dense = feedback(E, dense, prf_b)
        if dense2 is not None and E2 is not None:
            dense = (1 - ENS_W) * dense + ENS_W * feedback(E2, dense2, prf_b)
    alpha = CHUNK_ALPHA if alpha is None else alpha
    folder_cap = FOLDER_CAP if folder_cap is None else folder_cap
    len_b = LEX_LEN_B if len_b is None else len_b
    nchunks = collections.Counter(r[1] for r in rows)
    dv = agg_by_file([(r[1], float(raw[r[4]])) for r in rows]) if raw is not None else {}
    key = (lambda r: (r[1], r[2])) if unit == "section" else (lambda r: r[1])
    agg = (lambda pairs: agg_by_file(pairs)) if not top_m else (
        lambda pairs: {u: topm_mean(v, top_m) for u, v in _group(pairs).items()})
    if dense is not None:
        cs = (lambda r: float(dense[r[4]]) - csls * float(hub["r"][r[4]])) if csls else (
              lambda r: float(dense[r[4]]))
        du = agg([(key(r), cs(r)) for r in rows])
    else:
        du = {}
    lu = agg([(key(r), lex.get(r[0], 0.0)) for r in rows])
    ufile = (lambda u: u[0]) if unit == "section" else (lambda u: u)
    if alpha:
        du = {u: s * nchunks[ufile(u)] ** -alpha for u, s in du.items()}
    if len_b and nchunks:
        avg = sum(nchunks.values()) / len(nchunks)
        lu = {u: s / (1 - len_b + len_b * nchunks[ufile(u)] / avg) for u, s in lu.items()}
    score = {}
    if fusion == "rrf3" and du:
        mx = {}
        for r in rows:
            v = cs(r)
            if v > mx.get(key(r), -9.0): mx[key(r)] = v
        pw = PROBE_W if probe_w is None else probe_w
        if probes and probe_merge:
            mx = {u: max(v, probes.get(ufile(u), -9.0)) for u, v in mx.items()}
        a, b, l = _ranks(du), _ranks(mx), _ranks(lu)
        p = _ranks({u: probes.get(ufile(u), -9.0) for u in du}) if probes and pw and not probe_merge else None
        for u in du:
            s = (W_DENSE * (0.5/(rrf_k + a[u]) + 0.5/(rrf_k + b[u]))
                 + (1-W_DENSE) / (rrf_k + l[u]))
            if p is not None:
                s += pw / (rrf_k + p[u])
            f = ufile(u)
            if f not in score or s > score[f]: score[f] = s
    else:
        dvn, lvn = norm(du), norm(lu)
        w = W_DENSE if dense is not None else 0.0
        for u in set(dvn) | set(lvn):
            s = w*dvn.get(u, 0) + (1-w)*lvn.get(u, 0)
            f = ufile(u)
            if f not in score or s > score[f]: score[f] = s
    if hub_beta and hub:
        score = {f: s * (1 + hub["kocc"].get(f, 1.0)) ** -hub_beta for f, s in score.items()}
    ordered = sorted(score.items(), key=lambda kv: (-kv[1], kv[0]))
    if not folder_cap:
        return ordered[:k], dv
    out, per = [], collections.Counter()
    for f, s in ordered:
        g = folder(f)
        if g is None and lone_cap and f.startswith("domains/"):
            g, cap = "domains/", lone_cap
        else:
            cap = folder_cap
        if g is not None and per[g] >= cap: continue
        if g is not None: per[g] += 1
        out.append((f, s))
        if len(out) == k: break
    return out, dv

def _group(pairs):
    d = collections.defaultdict(list)
    for u, s in pairs: d[u].append(s)
    return d

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

def open_read(path=None, **kw):
    """A connection that only reads the index, whatever WAL files are present.

    mode=ro first. It cannot create the -shm a WAL database needs, so once the
    last writer has closed and its -wal and -shm are gone it fails with "unable
    to open database file" (every ask on 2026-10-12 09:30). Then a normal
    connection (mode=rw, never create), which can make the -shm, with query_only so it still cannot
    write.
    """
    path = path or DB
    try:
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True, **kw)
        db.execute("SELECT 1 FROM meta LIMIT 1").fetchall()
        return db
    except sqlite3.OperationalError:
        # mode=rw never creates a missing file, so a missing index stays missing.
        db = sqlite3.connect(f"file:{path}?mode=rw", uri=True, **kw)
        db.execute("PRAGMA query_only=ON")
        return db


def load_vectors(db):
    """rows, nomic vectors, and the second model's (or None), one snapshot."""
    db.execute("BEGIN")     # rows and the vector file names from one snapshot
    rows = db.execute("SELECT id,file,section,text,row FROM chunk ORDER BY id").fetchall()
    E = np.load(npy_path(db))
    p2 = npy2_path(db)
    db.execute("COMMIT")
    E2 = None
    if p2:
        try:
            E2 = np.load(p2)
            if E2.shape[0] != len(rows): E2 = None
        except Exception:   # an index rotated it away: answer on one model
            E2 = None
    return rows, E, E2

def query_dense(query, E, E2=None):
    """(dense, dense2, degraded): the question's cosines under each model.
    Both models are asked at once, so the second costs no wall time: warm p50
    17 ms nomic and 20 ms mxbai on 2026-10-13 at load 13. dense2 is None when
    the index has no second vectors, that model fails, or nomic failed."""
    import threading
    got = {}
    def ask_model(key, model, text):
        try:
            # _post, not embed(): embed() swallows a failure, retries it once and
            # returns a zero vector, so every outage used to read as a timeout and
            # every timeout sent two requests that each aborted a model load.
            v = np.asarray(_post({"model": model, "input": [text],
                                  "keep_alive": KEEP_ALIVE}, EMBED_TIMEOUT)[0], dtype="float32")
            if np.linalg.norm(v) < 1e-6: raise ValueError("zero vector")
            got[key] = v / np.linalg.norm(v)
        except Exception as e:
            got[key] = e
    threads = [threading.Thread(target=ask_model, args=("q", MODEL, query))]
    if E2 is not None:
        threads.append(threading.Thread(target=ask_model, args=("q2", MODEL2, Q2_PREFIX + query)))
    for t in threads: t.start()
    for t in threads: t.join()
    dense = dense2 = degraded = None
    if isinstance(got.get("q"), np.ndarray):
        dense = E @ got["q"]
    else:
        degraded = classify(got.get("q"))
    q2 = got.get("q2")
    if E2 is not None and dense is not None and isinstance(q2, np.ndarray) and q2.shape[0] == E2.shape[1]:
        dense2 = E2 @ q2
    timeouts = [k for k in ("q", "q2") if k in got and not isinstance(got[k], np.ndarray)
                and classify(got[k]) == "embed_timeout"]
    if timeouts:
        spawn_warm()
    return dense, dense2, degraded

def cmd_ask(args):
    if not os.path.exists(DB): die("no index. run: brain index", 2)
    db = open_read(isolation_level=None)
    rows, E, E2 = load_vectors(db)
    dense, dense2, degraded = query_dense(args.query, E, E2)

    lex = lexical(db, args.query)
    ranked, dv = rank(rows, dense, lex, args.k, E=E, dense2=dense2, E2=E2)

    top_cos = max(dv.values()) if dv else 0.0
    st = stale_files(db)
    print(f"# brain mode={'hybrid' if dense is not None else 'lexical'}"
          f"{' models=2' if dense2 is not None else ''}"
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
    db = open_read()
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
