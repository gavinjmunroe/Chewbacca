#!/usr/bin/env python3
"""The doc surface end to end: the real hud-listen and the real kyber-surfaces
daemon, against a Unix socket that pretends to be the display (CHW-194).

Said: "show my mash up doc", then "make the intro shorter in my mash up doc",
then the Apply edit press, then "close the doc". Checked: the File component
draws the text, the edit arrives as a Diff while the file is untouched, the one
press writes it and the read back matches, and the surface comes down.

HOME, BOB_DIR and the daemon's socket are a temp dir, and `mac`, `coursework`,
gws, genoffice and the model are fakes on PATH, so nothing reads the real
Mac, Google or a real document. Set DOCS_E2E_REAL_GENOFFICE=1 (and put a real
.docx at DOCS_E2E_DOCX) to run the same flow through the real genoffice.
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("test_hud_listen", ROOT / "tests" / "test_hud_listen.py")
thl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(thl)

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


REAL = os.environ.get("DOCS_E2E_REAL_GENOFFICE") == "1"
REAL_HOME = Path.home()
T = Path(tempfile.mkdtemp(prefix="de-"))
HOME = T / "home"
DOCS = HOME / "Documents"
DOCS.mkdir(parents=True)
STUBS = T / "stubs"
STUBS.mkdir()
INTRO = "The intro is long and it rambles on for a while about Douglas and Miyake."
SHORT = "Douglas meets Miyake."

for name in ("mac", "coursework"):
    (STUBS / name).write_text("#!/bin/sh\necho '{\"error\":{\"message\":\"off in this test\"}}'\nexit 1\n")
(STUBS / "gws").write_text("#!/bin/sh\necho '{\"files\": []}'\n")
(STUBS / "claude").write_text(
    "#!/usr/bin/env python3\nimport json\nprint(json.dumps({'edits': [{'block': 1, 'text': %r}],"
    " 'summary': 'Cut the intro to one line.'}))\n" % SHORT)
GENOFFICE = r'''#!/usr/bin/env python3
import json, re, sys, html
a = [x for x in sys.argv[1:] if x != "--json"]
if a[:2] == ["docs", "read"]:
    d = json.load(open(a[2]))
    print(json.dumps({"status": "ok", "detail": {"items": [
        {"index": i, "type": b.get("type", "paragraph"), "text": b["text"]} for i, b in enumerate(d["blocks"])]}}))
elif a[:2] == ["docs", "apply"]:
    d = json.load(open(a[2]))
    for op in json.load(open(a[a.index("--ops") + 1])):
        d["blocks"][op["startBlockIndex"]]["text"] = html.unescape(re.fullmatch(r"<p>(.*)</p>", op["html"]).group(1))
    json.dump(d, open(a[a.index("--out") + 1] if "--out" in a else a[2], "w"))
    print(json.dumps({"status": "ok", "detail": {"batch": {"applied": 1}}}))
else:
    print(json.dumps({"status": "error", "message": "unexpected"})); sys.exit(1)
'''
(STUBS / "fake-genoffice").write_text(GENOFFICE)
for f in STUBS.iterdir():
    f.chmod(0o755)

MASH = DOCS / "Mash Up.docx"
if REAL:
    source = Path(os.environ.get("DOCS_E2E_DOCX", ""))
    shutil.copy(source, MASH)
else:
    MASH.write_text(json.dumps({"blocks": [{"type": "heading", "text": "Mash Up"}, {"text": INTRO},
                                           {"type": "listitem", "text": "Read both"}]}))
before = MASH.read_bytes()

display = str(T / "hud.sock")
server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
server.bind(display)
server.listen(8)
conns: list[socket.socket] = []
lines: list[tuple[int, str]] = []
lock = threading.Lock()


def reader(i: int, conn: socket.socket) -> None:
    buffer = b""
    while True:
        try:
            chunk = conn.recv(65536)
        except OSError:
            return
        if not chunk:
            return
        buffer += chunk
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            with lock:
                lines.append((i, line.decode("utf-8", "replace")))


def accept() -> None:
    while True:
        try:
            conn, _ = server.accept()
        except OSError:
            return
        with lock:
            conns.append(conn)
            i = len(conns) - 1
        threading.Thread(target=reader, args=(i, conn), daemon=True).start()


threading.Thread(target=accept, daemon=True).start()


def wait(pred, timeout=90.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with lock:
            snapshot = list(lines)
        got = pred(snapshot)
        # A connection number can be 0, which is an answer, not a miss.
        if got is not None and got is not False:
            return got
        time.sleep(0.1)
    return None


def conn_of(snapshot, text):
    return next((i for i, line in snapshot if line == text or line.startswith(text)), None)


def say(conn: int, text: str) -> None:
    conns[conn].sendall(f'h {json.dumps(text)}\n'.encode())


env = thl.listener_env(str(T), display)
env.update(HOME=str(HOME), BOB_DIR=str(T / "bob"), HUD_SURFACES="on",
           KYBER_SURFACES_SOCK=str(T / "s.sock"), KYBER_OS_GRAPH=str(T / "graph.sqlite"),
           PATH=f"{STUBS}:{env['PATH']}", CHEWBACCA_GWS=str(STUBS / "gws"),
           CHEWBACCA_DOCS_DIRS=str(HOME), KYBER_DOCS_MODEL=str(STUBS / "claude"))
# HOME is the temp dir, so a real genoffice is named by its own path.
env["CHEWBACCA_GENOFFICE"] = (os.environ.get("DOCS_E2E_GENOFFICE") or str(
    REAL_HOME / "code" / "vendor" / "genoffice" / "packages" / "cli" / "bin" / "genoffice")) if REAL \
    else str(STUBS / "fake-genoffice")
listener = subprocess.Popen([sys.executable, env["HUD_TEST_ENTRY"], "--model-cmd", str(STUBS / "claude")],
                            env=env, stdout=subprocess.DEVNULL, stderr=open(T / "listen.log", "w"))
started = time.monotonic()
try:
    hl = wait(lambda s: conn_of(s, "p attentive"), 30)
    check("hud-listen connected to the display", hl is not None)
    say(hl, "show my mash up doc")
    drawn = wait(lambda s: any(line.startswith('d /doc/path "') for _, line in s), 120)
    with lock:
        snap = list(lines)
    daemon = conn_of(snap, "@ doc")
    path = next((json.loads(line[len("d /doc/path "):]) for _, line in snap if line.startswith("d /doc/path ")), "")
    check("the daemon drew the doc surface with a File component", daemon is not None and drawn
          and any(i == daemon and line.startswith("c doc-file File") for i, line in snap), snap[-6:])
    check("the File shows the document's text", path.endswith("Mash Up.txt") and INTRO in Path(path).read_text()
          if not REAL else path.endswith("Mash Up.txt"), path)
    check("hud-listen answered without the model", any(i == hl and line.startswith('s "Mash Up is up') for i, line in snap),
          [line for i, line in snap if i == hl][-5:])
    t_open = time.monotonic() - started

    mark = len(snap)
    say(hl, "make the intro shorter in my mash up doc")
    diff = wait(lambda s: next((line for _, line in s[mark:] if line.startswith("d /doc/diff ")), None), 180)
    with lock:
        snap = list(lines)
    check("the edit is drawn as a Diff", diff is not None and f"+{SHORT}" in json.loads(diff[len("d /doc/diff "):]),
          diff)
    check("the Diff replaced the File on the glass", any(line.startswith("c doc-diff Diff") for _, line in snap[mark:])
          and not any(line.startswith("c doc-file File") for _, line in snap[mark:]))
    check("nothing was written before the press", MASH.read_bytes() == before)

    mark = len(snap)
    if daemon is None:
        raise SystemExit("no daemon drew the doc; stopping here")
    conns[daemon].sendall(b'e ks-apply doc-apply surface="doc"\n')
    status = wait(lambda s: next((line for _, line in s[mark:] if line.startswith("d /doc/status ")
                                  and "Working" not in line), None), 120)
    check("one press applied it and the read back matches", status is not None and "matches the preview" in status,
          status)
    check("the file now holds the edit", MASH.read_bytes() != before
          and (REAL or json.loads(MASH.read_text())["blocks"][1]["text"] == SHORT))

    with lock:
        mark = len(lines)
    say(hl, "close the doc")
    gone = wait(lambda s: any(line == "- doc" for _, line in s[mark:]), 30)
    check("\"close the doc\" takes it down", gone)
    print(f"e2e wall time {time.monotonic() - started:.1f}s (open {t_open:.1f}s)")
finally:
    listener.terminate()
    try:
        listener.wait(timeout=10)
    except subprocess.TimeoutExpired:
        listener.kill()
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(5)
            s.connect(str(T / "s.sock"))
            s.sendall(b'{"cmd": "quit"}\n')
            s.recv(1024)
    except OSError:
        pass
    server.close()
    if failed:
        print((T / "listen.log").read_text()[-2000:])

print(f"\n{'all passed' if not failed else f'{failed} failed'}")
sys.exit(1 if failed else 0)
