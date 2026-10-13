#!/usr/bin/env python3
"""brain indexes and asks with a second embedding model, and works without it.

2026-10-13: averaging mxbai-embed-large with nomic took the sealed set from
52.3% to 56.9% recall@5 (bench/frozen/ensemble_mxbai.json). The second model
is optional, so these check both halves: with it, the index writes a second
vector file whose rows line up with the chunks, an unchanged index asks it for
nothing, and an ask uses both; without it (not pulled, or BRAIN_MODEL2 empty)
indexing and asking behave exactly as one model.

Hermetic: a fake Ollama on loopback, a temp brain, brain.py imported in-process
(a `python3 -I` child cannot see user-site numpy on some Macs).
"""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import threading
from argparse import Namespace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAIN = os.environ.get("BRAIN_PY") or os.path.join(ROOT, "apps", "brain-retrieval", "src", "brain.py")
DIMS = {"nomic-embed-text": 768, "mxbai-embed-large": 1024}

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"  ok  {name}")
    else:
        failed += 1
        print(f"  FAIL {name}  {detail}")


def vector(text, dim):
    v = [0.0] * dim
    for w in text.lower().split():
        v[int(hashlib.md5(w.encode()).hexdigest(), 16) % dim] += 1.0
    v[0] += 0.01
    return v


def serve(calls, models, flaky=None):
    """flaky: a model that answers the "ready" probe and fails everything else,
    the shape of Ollama evicting or restarting it mid-build."""
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            calls.append((body["model"], len(body["input"])))
            if body["model"] not in models or (body["model"] == flaky and body["input"] != ["ready"]):
                self.send_response(404); self.end_headers()
                self.wfile.write(b'{"error":"model not found"}')
                return
            out = json.dumps({"embeddings": [vector(t, DIMS[body["model"]]) for t in body["input"]]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def load(brain_dir, port, model2):
    os.environ.update(BRAIN_DIR=brain_dir, OLLAMA_HOST=f"http://127.0.0.1:{port}",
                      BRAIN_EMBED_TIMEOUT="5", BRAIN_EXTRA_DIRS="", BRAIN_MODEL2=model2)
    spec = importlib.util.spec_from_file_location(f"brain_{len(model2)}_{port}", BRAIN)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run(fn, **kw):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        fn(Namespace(**kw))
    return buf.getvalue()


TEMPS = []


def make_brain():
    d = tempfile.mkdtemp()
    TEMPS.append(d)
    for rel, text in [("memory/alpha.md", "# Alpha\nthe mentor said loneliness is a contentment problem\n"),
                      ("memory/beta.md", "# Beta\ngithub actions billing has been dead since october\n"),
                      ("memory/gamma.md", "---\ndescription: mash up due date\n---\nthe mash up is due wednesday\n")]:
        os.makedirs(os.path.join(d, os.path.dirname(rel)), exist_ok=True)
        open(os.path.join(d, rel), "w").write(text)
    return d


def meta(brain_dir):
    db = sqlite3.connect(os.path.join(brain_dir, ".brain", "index.db"))
    m = dict(db.execute("SELECT k,v FROM meta"))
    n = db.execute("SELECT count(*) FROM chunk").fetchone()[0]
    db.close()
    return m, n


def glob_zero_rows(d):
    """Second-model files holding any all-zero row."""
    import glob
    bad = []
    for f in glob.glob(os.path.join(d, ".brain", "emb2-*.npy")):
        if (np.abs(np.load(f)).sum(axis=1) == 0).any():
            bad.append(f)
    return bad


def main():
    # With the second model pulled.
    calls = []
    srv = serve(calls, set(DIMS))
    d = make_brain()
    b = load(d, srv.server_address[1], "mxbai-embed-large")
    run(b.cmd_index, full=False, quiet=True)
    m, n = meta(d)
    check("index writes a second vector file", m.get("model2") == "mxbai-embed-large" and m.get("npy2"), m)
    E2 = np.load(os.path.join(d, ".brain", m["npy2"])) if m.get("npy2") else None
    check("its rows line up with the chunks", E2 is not None and E2.shape == (n, 1024), getattr(E2, "shape", None))
    del calls[:]
    run(b.cmd_index, full=False, quiet=True)
    check("an unchanged index asks neither model for anything", calls == [], calls)
    open(os.path.join(d, "memory/beta.md"), "a").write("and nobody paid the invoice\n")
    del calls[:]
    run(b.cmd_index, full=False, quiet=True)
    texts2 = sum(k for model, k in calls if model == "mxbai-embed-large")
    check("one changed file re-embeds only its chunk with the second model (plus one probe)",
          texts2 == 2, calls)
    m2, _ = meta(d)
    check("the new build names a new second vector file", m2.get("npy2") and m2["npy2"] != m["npy2"], (m, m2))
    del calls[:]
    out = run(b.cmd_ask, query="the mentor said loneliness is a contentment problem", k=3, width=80)
    check("an ask embeds the question with both models",
          {model for model, _ in calls} == set(DIMS), calls)
    check("an ask with both says so", out.startswith("# brain mode=hybrid models=2"), out[:120])
    check("and still finds the note", "[1] memory/alpha.md" in out, out)
    srv.shutdown()

    # Without it: same answers, one model, and the index never writes a second file.
    calls = []
    srv = serve(calls, {"nomic-embed-text"})
    d = make_brain()
    b = load(d, srv.server_address[1], "mxbai-embed-large")
    run(b.cmd_index, full=False, quiet=True)
    m, _ = meta(d)
    check("with the model not pulled, no second vector file", "npy2" not in m, m)
    del calls[:]
    run(b.cmd_index, full=False, quiet=True)
    check("and the next unchanged index makes no call (the miss is remembered)", calls == [], calls)
    out = run(b.cmd_ask, query="the mentor said loneliness is a contentment problem", k=3, width=80)
    check("an ask is one-model hybrid", out.startswith("# brain mode=hybrid files="), out[:120])
    check("and still finds the note", "[1] memory/alpha.md" in out, out)
    srv.shutdown()

    # The probe passes, then every batch fails: no zero rows get written.
    calls = []
    srv = serve(calls, set(DIMS), flaky="mxbai-embed-large")
    d = make_brain()
    b = load(d, srv.server_address[1], "mxbai-embed-large")
    run(b.cmd_index, full=False, quiet=True)
    m, _ = meta(d)
    zeros = glob_zero_rows(d)
    check("a second model that fails after its probe leaves no second file", "npy2" not in m and not zeros, (m, zeros))
    srv.shutdown()
    calls = []
    srv = serve(calls, set(DIMS))
    b = load(d, srv.server_address[1], "mxbai-embed-large")
    run(b.cmd_index, full=True, quiet=True)
    m, n = meta(d)
    E2 = np.load(os.path.join(d, ".brain", m["npy2"])) if m.get("npy2") else None
    check("and once it is healthy a build writes every row, none zero",
          E2 is not None and E2.shape[0] == n and bool((np.abs(E2).sum(axis=1) > 0).all()), m)
    srv.shutdown()

    # The second model fails at ask time: the answer comes from nomic alone.
    calls = []
    srv = serve(calls, {"nomic-embed-text"})
    b = load(d, srv.server_address[1], "mxbai-embed-large")
    out = run(b.cmd_ask, query="the mentor said loneliness is a contentment problem", k=3, width=80)
    check("an ask whose second model fails answers on one model",
          out.startswith("# brain mode=hybrid files=") and "[1] memory/alpha.md" in out, out[:200])
    srv.shutdown()

    calls = []
    srv = serve(calls, set(DIMS))
    d = make_brain()
    b = load(d, srv.server_address[1], "")
    run(b.cmd_index, full=False, quiet=True)
    check("BRAIN_MODEL2 empty never calls a second model",
          {model for model, _ in calls} == {"nomic-embed-text"}, calls)
    srv.shutdown()

    for t in TEMPS:
        shutil.rmtree(t, ignore_errors=True)
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
