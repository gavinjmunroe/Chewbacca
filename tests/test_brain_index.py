#!/usr/bin/env python3
"""brain index is incremental, and a slow model load no longer kills recall.

Hermetic: a temp brain and a fake Ollama on a free port. The fake behaves like
the real one did in its server log on 2026-10-09: a model that is not resident
takes a while to load, and a load whose client hangs up first is abandoned, so
a caller that always gives up early never gets the model loaded at all.
"""
import hashlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAIN = os.environ.get("BRAIN_PY") or os.path.join(ROOT, "apps", "brain-retrieval", "src", "brain.py")
DIM = 768
LOAD_SECONDS = 0.4


def vector(text):
    """Deterministic and meaning-free, except that texts sharing a rare word
    land near each other, which is enough to make one file win a query."""
    v = [0.0] * DIM
    for word in text.lower().split():
        h = int(hashlib.md5(word.encode()).hexdigest(), 16)
        v[h % DIM] += 1.0
    v[0] += 0.01
    return v


class Fake:
    def __init__(self):
        self.inputs = []
        self.loaded = False
        self.aborted = 0
        self.lock = threading.Lock()


def make_handler(fake):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if not fake.loaded:
                time.sleep(LOAD_SECONDS)
                # A client that hung up mid-load leaves a readable, empty socket.
                self.connection.setblocking(False)
                try:
                    gone = self.connection.recv(1, socket.MSG_PEEK) == b""
                except BlockingIOError:
                    gone = False
                finally:
                    self.connection.setblocking(True)
                if gone:
                    fake.aborted += 1
                    return
                fake.loaded = True
            with fake.lock:
                fake.inputs.extend(body["input"])
            out = json.dumps({"embeddings": [vector(t) for t in body["input"]]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

    return H


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  pass  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}  {detail}")


def write(brain, rel, text):
    path = os.path.join(brain, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(text)


def main():
    tmp = tempfile.mkdtemp()
    brain = os.path.join(tmp, "brain")
    fake = Fake()
    port = free_port()
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(fake))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    env = dict(os.environ, BRAIN_DIR=brain, OLLAMA_HOST=f"http://127.0.0.1:{port}",
               BRAIN_EMBED_TIMEOUT="0.12", BRAIN_EXTRA_DIRS=os.path.join(tmp, "team"))

    def brain_cmd(*args):
        return subprocess.run([sys.executable, "-I", BRAIN, *args], env=env,
                              capture_output=True, text=True, timeout=60)

    write(brain, "memory/alpha.md", "# Alpha\nthe mentor said loneliness is a contentment problem\n")
    write(brain, "memory/beta.md", "# Beta\ngithub actions billing has been dead since october\n")
    write(brain, "memory/gamma.md", "# Gamma\nthe mash up is due wednesday morning\n")
    write(tmp, "team/project_omega.md", "# Omega\nkarthik ripped out firestore and pinecone\n")

    # The model starts unloaded, so the first index call pays the load. An
    # index waits for it; only the ask path gives up early.
    r = brain_cmd("index")
    check("first index embeds every chunk", r.returncode == 0 and len(fake.inputs) == 4,
          r.stdout + r.stderr + str(len(fake.inputs)))
    r = brain_cmd("index")
    check("a second index with nothing changed embeds nothing",
          "up to date" in r.stdout and len(fake.inputs) == 4, r.stdout + r.stderr)
    r = brain_cmd("ask", "karthik firestore pinecone", "--k", "1")
    check("team memory outside the brain is indexed and named by its full path",
          "/team/project_omega.md" in r.stdout and "[1] memory/" not in r.stdout,
          r.stdout + r.stderr)

    write(brain, "memory/beta.md", "# Beta\ngithub actions billing is fixed now, sagar paid\n")
    os.remove(os.path.join(brain, "memory/gamma.md"))
    write(brain, "memory/delta.md", "# Delta\nzeutara wants five companies by thanksgiving\n")
    before = len(fake.inputs)
    r = brain_cmd("index")
    new = fake.inputs[before:]
    check("only the changed and the new file are re-embedded",
          len(new) == 2 and all("beta" in t or "delta" in t for t in new),
          r.stdout + r.stderr + repr(new))
    check("status reports nothing stale", "stale files: 0" in brain_cmd("status").stdout)

    r = brain_cmd("ask", "zeutara thanksgiving companies", "--k", "2")
    check("a file added after the first build is found in hybrid mode",
          r.stdout.startswith("# brain mode=hybrid") and "[1] memory/delta.md" in r.stdout,
          r.stdout + r.stderr)
    check("a deleted file is gone from results", "gamma.md" not in brain_cmd(
        "ask", "mash up wednesday", "--k", "5").stdout)

    # 2026-10-12 09:30: every `brain ask` on the real brain died with "unable
    # to open database file". The index is WAL, and a mode=ro connection cannot
    # make the -shm file, so once the last writer closed and its -wal and -shm
    # were gone, no read-only reader could open it. brain-recall went silent
    # (14 of 89 prompts that day reached brain and got nothing) and the sealed
    # bench could not run.
    import sqlite3 as _sq
    _db = _sq.connect(os.path.join(brain, ".brain", "index.db"))
    _db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    _db.close()
    for side in ("-wal", "-shm"):
        try:
            os.remove(os.path.join(brain, ".brain", "index.db" + side))
        except FileNotFoundError:
            pass
    # Only Apple's sqlite (3.43 in /usr/bin/python3, the python3 `brain`'s
    # shebang finds on this Mac) refuses; Homebrew's newer one opens it fine,
    # so the check runs on every interpreter that can load brain.py.
    runners = [[sys.executable, "-I"]]
    for stock in ("/usr/bin/python3",):
        if os.path.exists(stock) and subprocess.run([stock, "-c", "import numpy"],
                                                    capture_output=True).returncode == 0:
            runners.append([stock])
    for runner in runners:
        for side in ("-wal", "-shm"):
            try:
                os.remove(os.path.join(brain, ".brain", "index.db" + side))
            except FileNotFoundError:
                pass
        r = subprocess.run(runner + [BRAIN, "ask", "zeutara thanksgiving companies", "--k", "2"],
                           env=env, capture_output=True, text=True, timeout=60)
        check(f"{runner[0]}: an ask with no -wal or -shm beside the index still answers",
              r.stdout.startswith("# brain mode=hybrid") and "delta.md" in r.stdout, r.stdout + r.stderr[-300:])
        for side in ("-wal", "-shm"):
            try:
                os.remove(os.path.join(brain, ".brain", "index.db" + side))
            except FileNotFoundError:
                pass
        r = subprocess.run(runner + [BRAIN, "status"], env=env, capture_output=True, text=True, timeout=60)
        check(f"{runner[0]}: status with no -wal or -shm still reads",
              r.returncode == 0 and "stale files" in r.stdout, r.stdout + r.stderr[-300:])

    # Incremental must equal a from-scratch build, vector for vector.
    import numpy as np
    import sqlite3

    def snapshot():
        db = sqlite3.connect(os.path.join(brain, ".brain", "index.db"))
        rows = db.execute("SELECT file,section,text FROM chunk ORDER BY id").fetchall()
        name = db.execute("SELECT v FROM meta WHERE k='npy'").fetchone()[0]
        E = np.load(os.path.join(brain, ".brain", name))
        db.close()
        return rows, E

    inc_rows, inc_E = snapshot()
    brain_cmd("index", "--full")
    full_rows, full_E = snapshot()
    check("incremental rows match a full rebuild", inc_rows == full_rows)
    check("incremental vectors match a full rebuild",
          inc_E.shape == full_E.shape and np.allclose(inc_E, full_E, atol=1e-6))
    npys = [f for f in os.listdir(os.path.join(brain, ".brain")) if f.endswith(".npy")]
    check("old vector files are pruned to two", len(npys) <= 2, repr(npys))

    # The recall failure: unload the model, then ask. The ask gives up at
    # 120ms and answers lexically, and must leave a warm-up behind it so the
    # next ask finds the model resident. Before the fix every ask aborted the
    # load and the model never came up.
    fake.loaded = False
    r = brain_cmd("ask", "mentor loneliness contentment")
    check("an ask during a load answers lexically and says why",
          "mode=lexical degraded=embed_timeout" in r.stdout, r.stdout + r.stderr)
    deadline = time.time() + 10
    while time.time() < deadline and not fake.loaded:
        time.sleep(0.05)
    check("the timed-out ask leaves a warm-up that finishes the load", fake.loaded,
          f"aborted={fake.aborted}")
    time.sleep(0.2)
    r = brain_cmd("ask", "mentor loneliness contentment")
    check("the next ask is hybrid again", r.stdout.startswith("# brain mode=hybrid"),
          r.stdout + r.stderr)

    # Many tabs asking at once start one warm-up, not one each.
    fake.loaded = False
    fake.aborted = 0
    procs = [subprocess.Popen([sys.executable, "-I", BRAIN, "ask", "mentor loneliness"],
                              env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
             for _ in range(5)]
    for p in procs:
        p.wait(timeout=30)
    deadline = time.time() + 10
    while time.time() < deadline and not fake.loaded:
        time.sleep(0.05)
    lock = os.path.join(brain, ".brain", "warm.lock")
    deadline = time.time() + 5
    while time.time() < deadline and os.path.exists(lock):
        time.sleep(0.05)
    check("five simultaneous asks still end with the model loaded", fake.loaded)
    check("the warm-up removes its lock", not os.path.exists(lock))

    # Ollama not running at all is a different failure and starts no warm-up.
    server.shutdown()
    server.server_close()
    r = brain_cmd("ask", "mentor loneliness")
    check("a refused connection reads as ollama_down",
          "degraded=ollama_down" in r.stdout, r.stdout + r.stderr)
    check("ollama_down starts no warm-up", not os.path.exists(lock))

    # The address prompts are sent to must stay on this machine.
    probe = ("import os,sys; sys.argv=['brain']; sys.path.insert(0, os.path.dirname(sys.argv[0] or '.'));"
             "import importlib.util as u; s=u.spec_from_file_location('b', os.environ['BRAIN_PY_PATH']);"
             "m=u.module_from_spec(s); s.loader.exec_module(m); print(m.OLLAMA)")
    for host, want in [("http://evil.example.com:11434", "http://localhost:11434"),
                       ("10.0.0.5:11434", "http://localhost:11434"),
                       ("127.0.0.1:9999", "http://127.0.0.1:9999")]:
        got = subprocess.run([sys.executable, "-I", "-c", probe], capture_output=True, text=True,
                             env=dict(env, OLLAMA_HOST=host, BRAIN_PY_PATH=BRAIN)).stdout.strip()
        check(f"OLLAMA_HOST={host} resolves to {want}", got == want, got)

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
