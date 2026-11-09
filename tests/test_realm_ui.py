#!/usr/bin/env python3
"""Realm's own interface on the glass: the build plan, the server's locks, the
surface and the routing.

No realm checkout, no npm, no display. server.mjs runs under node against a
temp dist and a fake engine (a raw socket that answers the WebSocket upgrade
the way realm does), so the pipe's checks are exercised end to end.
Run: python3 tests/test_realm_ui.py
"""
import base64
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin" / "lib"))

TMP = Path(tempfile.mkdtemp(prefix="realm-ui-test-"))
os.environ["CHEWBACCA_REALM_UI_HOME"] = str(TMP / "ui")
os.environ["CHEWBACCA_REALM_HOME"] = str(TMP / "realm")
os.environ["CHEWBACCA_DAEMON_DIR"] = str(TMP / "daemon")

import realm_ui  # noqa: E402
import surface_intent  # noqa: E402
import surfaces  # noqa: E402
from surfaces import realm_app  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


# ── build plan ──────────────────────────────────────────────────────────────

desktop = {"dependencies": {"emojilib": "4.0.3"},
           "devDependencies": {"electron": "^37", "react": "^19", "@realm/ui": "workspace:*",
                               "jsdom": "^25", "vite": "^6"}}
pkg = realm_ui.package_json(desktop)
deps = pkg["dependencies"]
check("the bundle keeps the renderer's own dependencies", deps.get("react") == "^19" and deps.get("emojilib") == "4.0.3", deps)
check("Electron, the workspace links and the test-only packages are not installed",
      not {"electron", "@realm/ui", "jsdom"} & set(deps), deps)
check("the free icon pack stands in for the paid one", "@hugeicons/core-free-icons" in deps
      and not any("hugeicons-pro" in k for k in deps), deps)
check("the fingerprint changes when the realm commit changes",
      realm_ui.fingerprint("a", "p", "c") != realm_ui.fingerprint("b", "p", "c"))

config = (ROOT / "bin" / "lib" / "realm_ui" / "vite.config.mjs").read_text()
check("vite aliases the paid icon pack to the free one",
      '"@hugeicons-pro/core-stroke-rounded": "@hugeicons/core-free-icons"' in config)
check("vite loads the bridge before the module entry",
      '<script src="/realm-bridge.js"></script><script type="module"' in config)

# ── which checkout the interface builds from ────────────────────────────────
# REALM_UI_SOURCE picks the renderer's checkout (Caleb's fork at
# ~/code/realm-fork) without moving the engine; unset, it stays the engine's
# ~/code/vendor/realm. Built here with a stand-in node and npm, so the copy,
# the stamp and the record are the real code and only vite is faked.


def _fake_realm(at: Path, marker: str) -> Path:
    renderer = at / "apps" / "desktop" / "src" / "renderer"
    (renderer / "src").mkdir(parents=True)
    (renderer / "index.html").write_text('<script type="module" src="/src/main.tsx"></script>')
    (renderer / "src" / "main.tsx").write_text(f"// {marker}\n")
    (at / "apps" / "desktop" / "package.json").write_text(json.dumps({"dependencies": {"react": "^19"}}))
    (at / "tsconfig.base.json").write_text("{}")
    for name in ("contracts", "ui"):
        (at / "packages" / name).mkdir(parents=True)
        (at / "packages" / name / "package.json").write_text("{}")
    return at


_saved = {k: os.environ.get(k) for k in ("REALM_UI_SOURCE", "REALM_UI_MODE", "CHEWBACCA_REALM_DIR", "HOME", "CHEWBACCA_NODE",
                                         "CHEWBACCA_NPM", "CHEWBACCA_REALM_UI_HOME")}
try:
    src_tmp = TMP / "sources"
    os.environ.pop("REALM_UI_SOURCE", None)
    os.environ.pop("CHEWBACCA_REALM_DIR", None)
    os.environ["HOME"] = str(src_tmp / "home")
    check("unset, the interface builds from ~/code/vendor/realm",
          realm_ui.realm_dir() == src_tmp / "home" / "code" / "vendor" / "realm", realm_ui.realm_dir())
    os.environ["CHEWBACCA_REALM_DIR"] = str(src_tmp / "engine")
    check("unset, it follows the engine's checkout", realm_ui.realm_dir() == src_tmp / "engine", realm_ui.realm_dir())
    os.environ["REALM_UI_SOURCE"] = "~/code/realm-fork"
    check("REALM_UI_SOURCE wins over the engine's checkout, ~ expanded",
          realm_ui.realm_dir() == src_tmp / "home" / "code" / "realm-fork", realm_ui.realm_dir())

    vendor = _fake_realm(src_tmp / "vendor", "his")
    fork = _fake_realm(src_tmp / "fork", "fork")
    bin_dir = src_tmp / "bin"
    bin_dir.mkdir()
    fake_npm = bin_dir / "npm"
    fake_npm.write_text("#!/bin/sh\nmkdir -p node_modules/vite/bin && : > node_modules/vite/bin/vite.js\n")
    fake_node = bin_dir / "node"
    # Stands in for `node vite.js build`: the "bundle" is the main.tsx it was handed.
    # And it records which entry the build asked vite for (REALM_UI_MODE).
    fake_node.write_text("#!/bin/sh\nmkdir -p dist && cp apps/desktop/src/renderer/src/main.tsx dist/index.html"
                         " && echo \"mode=$REALM_UI_MODE\" >> dist/index.html\n")
    for f in (fake_npm, fake_node):
        f.chmod(0o755)
    os.environ.update(CHEWBACCA_NODE=str(fake_node), CHEWBACCA_NPM=str(fake_npm),
                      CHEWBACCA_REALM_UI_HOME=str(src_tmp / "ui"))
    quiet = lambda *_: None  # noqa: E731

    os.environ.pop("REALM_UI_SOURCE")
    os.environ["CHEWBACCA_REALM_DIR"] = str(vendor)
    rec = realm_ui.build(log=quiet)
    check("the default build copies his checkout", "his" in (realm_ui.dist_dir() / "index.html").read_text())
    check("the record names the checkout it came from", rec.get("source") == str(vendor), rec)
    check("status says where the build came from", realm_ui.status()["source"] == str(vendor), realm_ui.status())

    os.environ["REALM_UI_SOURCE"] = str(fork)
    rec = realm_ui.build(log=quiet)
    check("REALM_UI_SOURCE builds the fork, no --force needed",
          "fork" in (realm_ui.dist_dir() / "index.html").read_text() and rec.get("source") == str(fork), rec)
    check("the fork's own tree gets no file of ours", not (fork / "apps" / "desktop" / "src" / "renderer" / "glass").exists())

    os.environ.pop("REALM_UI_SOURCE")
    rec = realm_ui.build(log=quiet)
    check("unset again, the next build is his again",
          "his" in (realm_ui.dist_dir() / "index.html").read_text() and rec.get("source") == str(vendor), rec)

    # ── which entry: his app as he ships it, or our layer over it ──────────
    # Caleb, 10/13 8:19am, of the tiles-and-story layer: "so far from a better
    # version of carlton's ide". Stock is the default; the layer is opt-in.
    built = lambda: (realm_ui.dist_dir() / "index.html").read_text()  # noqa: E731
    check("the default entry is stock, his app as he ships it", rec.get("mode") == "stock" and "mode=stock" in built(), (rec, built()))
    copied = realm_ui.build_dir() / "apps" / "desktop" / "src" / "renderer"
    check("both entries are copied beside his src/", (copied / "stock" / "main.tsx").exists() and (copied / "glass" / "main.tsx").exists())
    rec = realm_ui.build(log=quiet, mode_pick="glass")
    check("--mode glass rebuilds into the layer, no --force needed", rec.get("mode") == "glass" and "mode=glass" in built(), rec)
    check("the mode is remembered", realm_ui.settings().get("mode") == "glass", realm_ui.settings())
    rec = realm_ui.build(log=quiet)
    check("a later plain build stays on the remembered mode", rec.get("mode") == "glass" and "mode=glass" in built(), rec)
    os.environ["REALM_UI_MODE"] = "stock"
    rec = realm_ui.build(log=quiet)
    check("REALM_UI_MODE changes one build", rec.get("mode") == "stock", rec)
    check("and is never remembered", realm_ui.settings().get("mode") == "glass", realm_ui.settings())
    os.environ.pop("REALM_UI_MODE")
    rec = realm_ui.build(log=quiet, mode_pick="stock", source=str(fork))
    check("--source is remembered, so a plain rebuild stays on the fork",
          realm_ui.build(log=quiet).get("source") == str(fork.resolve()) and "fork" in built(), realm_ui.settings())
    check("status names the mode", realm_ui.status().get("mode") == "stock", realm_ui.status())
    try:
        realm_ui.build(log=quiet, mode_pick="tiles")
        check("an unknown mode is refused", False)
    except RuntimeError:
        check("an unknown mode is refused", realm_ui.settings().get("mode") == "stock", realm_ui.settings())
    try:
        realm_ui.build(log=quiet, source=str(src_tmp / "nowhere"))
        check("a source that isn't a realm checkout is refused", False)
    except RuntimeError:
        check("a source that isn't a realm checkout is refused", realm_ui.settings().get("source") == str(fork.resolve()))
    check("a remembered source beats the engine's checkout", realm_ui.realm_dir() == fork.resolve(), realm_ui.realm_dir())
    rec = realm_ui.build(log=quiet, source="default")
    check("--source default forgets it and goes back to the engine's checkout",
          "source" not in realm_ui.settings() and rec.get("source") == str(vendor) and "his" in built(), (realm_ui.settings(), rec))
    # A build that fails leaves the remembered picks as they were.
    broken = bin_dir / "node-broken"
    broken.write_text("#!/bin/sh\nexit 3\n")
    broken.chmod(0o755)
    os.environ["CHEWBACCA_NODE"] = str(broken)
    try:
        realm_ui.build(log=quiet, mode_pick="glass", force=True)
        check("a failed --mode glass build raises", False)
    except RuntimeError:
        check("a failed --mode glass build isn't remembered", realm_ui.settings().get("mode") == "stock", realm_ui.settings())
    os.environ["CHEWBACCA_NODE"] = str(fake_node)
    # The CLI parses what a person types.
    cli = [sys.executable, str(ROOT / "bin" / "realm-ui"), "build"]
    run = lambda *a: subprocess.run(cli + list(a), capture_output=True, text=True, env=dict(os.environ), timeout=60)  # noqa: E731
    got = run("--mode=glass")
    check("the CLI takes --mode=glass", got.returncode == 0 and realm_ui.settings().get("mode") == "glass" and "mode=glass" in built(), got.stderr)
    got = run("--mode", "stock", "--force")
    check("the CLI takes --mode stock --force", got.returncode == 0 and realm_ui.settings().get("mode") == "stock", got.stderr)
    got = run("--mode", "--force")
    check("a flag where the mode goes is refused", got.returncode == 2 and realm_ui.settings().get("mode") == "stock", got.stderr)
    got = run("--modes", "glass")
    check("an unknown option is refused", got.returncode == 2, got.stderr)
finally:
    for k, v in _saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v

# ── nothing built ───────────────────────────────────────────────────────────

check("not built: not available", realm_app.available() is False)
check("not built: show my agents opens the card", surface_intent.parse("show my agents").name == "agents")
check("not built: the rail's agents icon opens the card", surfaces.make("apps").opens("agents") == "agents")
try:
    realm_ui.start(register=False)
    check("not built: start refuses", False)
except RuntimeError as err:
    check("not built: start refuses and says how to build", "realm-ui build" in str(err), str(err))

# ── one owner ───────────────────────────────────────────────────────────────
# 2026-10-11: start() spawned its own server beside the daemon's service; the
# orphan held the port and pinned hours-old code. With the daemon loaded,
# start() must spawn nothing and leave the server to the daemon.
spawned = []
import daemon_register as _dr  # noqa: E402
_real_register = _dr.register
_dr.register = lambda *a, **k: "registered"
_real_built, _real_node, _real_running = realm_ui.built, realm_ui.node, realm_ui.running
realm_ui.built, realm_ui.node = (lambda: True), (lambda: "/usr/bin/true")
_calls = {"n": 0}


def _fake_running():
    _calls["n"] += 1
    return {"url": "http://127.0.0.1:1/"} if _calls["n"] > 1 else None


realm_ui.running = _fake_running
try:
    realm_ui.start(register=True, spawn=lambda *a, **k: spawned.append(a), daemon_owns=lambda: True)
    check("one owner: with the daemon loaded, start spawns no server of its own", spawned == [], spawned)
    _calls["n"] = 0
    realm_ui.start(register=True, spawn=lambda *a, **k: spawned.append(a), daemon_owns=lambda: False)
    check("one owner: with no daemon, start spawns the server itself", len(spawned) == 1, spawned)
finally:
    _dr.register = _real_register
    realm_ui.built, realm_ui.node, realm_ui.running = _real_built, _real_node, _real_running

# ── built ──────────────────────────────────────────────────────────────────

dist = realm_ui.dist_dir()
dist.mkdir(parents=True)
(dist / "index.html").write_text('<!doctype html><script src="/realm-bridge.js"></script><div id="root"></div>')
(dist / "assets").mkdir()
(dist / "assets" / "app.js").write_text("console.log(1)")
check("built: available", realm_app.available() is True)
check("built: show my agents opens Realm's own interface", surface_intent.parse("show my agents").name == "realm")
check("built: close my agents closes it", surface_intent.parse("close my agents").name == "realm")
check("built: the rail's agents icon opens it", surfaces.make("apps").opens("agents") == "realm")
from surfaces import apps as rail  # noqa: E402

check("the rail does not list realm beside agents", "realm" not in rail.kinds(), rail.kinds())
check("realm and carlton name the surface", surfaces.resolve("realm") == "realm" and surfaces.resolve("carlton") == "realm")

svc = realm_ui.service_argv()
check("the daemon runs `realm-ui serve`, never a worktree's server.mjs", svc[-1] == "serve" and svc[1].endswith("realm-ui"), svc)

# ── the surface ─────────────────────────────────────────────────────────────

# 1180 ran under the desktop icons on his 1246-point display (10/12 3:38pm).
check("the realm surface leaves the desktop icon column clear", realm_app.RealmApp.width <= 1000)
app = realm_app.RealmApp(start=lambda: {"url": "http://127.0.0.1:47317/"})
lines = app.layout()
check("it is a glance, so a click off it takes it down", lines[0] == "glance realm", lines)
check("it draws the App component bound to the url", any(l.startswith("c realm-app App url=@/realm/url") for l in lines), lines)
check("it opens centred on glass, at least Realm's 900-point minimum",
      app.region == "center" and app.chrome == "clear" and app.width >= 900)
data = app.fetch(surfaces.Context())
check("fetch hands the server's url to the page", app.model(data, None, {}, None)["/realm/url"] == "http://127.0.0.1:47317/", data)
broken = app.model(None, "the Realm interface server did not come up", {}, None)
check("an error says so and draws no page", broken["/realm/url"] == "" and "did not come up" in broken["/realm/note"], broken)
check("no error, no note", app.model(data, None, {}, None)["/realm/note"] == "")

# The first frame, before any fetch, already names the page Kyber keeps warm,
# read from the state file with no pid check (2026-10-11, "everything on the
# glass should be INSTANT").
(TMP / "ui").mkdir(parents=True, exist_ok=True)
realm_ui.state_file().write_text(json.dumps({"pid": 1, "port": 47317, "url": "http://127.0.0.1:47317/"}))
check("the opening frame carries the last address before the fetch",
      app.model(None, None, {}, None) == {"/realm/url": "http://127.0.0.1:47317/", "/realm/note": ""})
realm_ui.state_file().write_text("not json")
check("an unreadable state file gives an empty address, not a crash", app.model(None, None, {}, None)["/realm/url"] == "")
realm_ui.state_file().unlink()


def refused():
    raise RuntimeError("Realm's interface is not built; run realm-ui build")


try:
    realm_app.RealmApp(start=refused).fetch(surfaces.Context())
    check("a start failure becomes a SurfaceError", False)
except surfaces.SurfaceError as err:
    check("a start failure becomes a SurfaceError in words", "realm-ui build" in str(err), str(err))

# ── server.mjs against a fake engine ────────────────────────────────────────

NODE = shutil.which("node")
if not NODE:
    print("skip server.mjs checks: no node")
else:
    ENGINE_TOKEN = "engine-secret-token"
    seen = {}

    def fake_engine(listener):
        """Answers one upgrade the way realm does, then echoes bytes."""
        while True:
            try:
                conn, _ = listener.accept()
            except OSError:
                return
            head = b""
            while b"\r\n\r\n" not in head:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                head += chunk
            text = head.decode("latin1")
            seen["request"] = text
            key = re.search(r"Sec-WebSocket-Key: (\S+)", text).group(1)
            import hashlib  # noqa: PLC0415
            accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
            ok = (f"Sec-WebSocket-Protocol: realm.{ENGINE_TOKEN}" in text) and ("Origin:" not in text)
            if not ok:
                conn.sendall(b"HTTP/1.1 401 Unauthorized\r\n\r\n")
                conn.close()
                continue
            conn.sendall((f"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                          f"Sec-WebSocket-Accept: {accept}\r\nSec-WebSocket-Protocol: realm.{ENGINE_TOKEN}\r\n\r\n").encode())

            def echo(c=conn):
                try:
                    while True:
                        b = c.recv(4096)
                        if not b:
                            return
                        c.sendall(b)
                except OSError:
                    return
            threading.Thread(target=echo, daemon=True).start()

    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(8)
    engine_port = listener.getsockname()[1]
    threading.Thread(target=fake_engine, args=(listener,), daemon=True).start()
    realm_home = Path(os.environ["CHEWBACCA_REALM_HOME"])
    realm_home.mkdir(parents=True, exist_ok=True)
    (realm_home / "daemon.json").write_text(json.dumps({"port": engine_port, "token": ENGINE_TOKEN}))

    state = TMP / "server.json"
    proc = subprocess.Popen([NODE, str(ROOT / "bin" / "lib" / "realm_ui" / "server.mjs"), "--dist", str(dist),
                             "--realm-home", str(realm_home), "--state", str(state), "--port", "0"],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        deadline = time.time() + 10
        while not state.exists() and time.time() < deadline:
            time.sleep(0.05)
        info = json.loads(state.read_text())
        port = info["port"]
        origin = f"http://127.0.0.1:{port}"
        check("the state file is private", oct(state.stat().st_mode & 0o777) == "0o600", oct(state.stat().st_mode))

        def http(path, headers=None):
            s = socket.create_connection(("127.0.0.1", port), timeout=5)
            hdrs = {"Host": f"127.0.0.1:{port}", **(headers or {})}
            s.sendall((f"GET {path} HTTP/1.1\r\n" + "".join(f"{k}: {v}\r\n" for k, v in hdrs.items())
                       + "Connection: close\r\n\r\n").encode())
            out = b""
            while True:
                b = s.recv(65536)
                if not b:
                    break
                out += b
            s.close()
            return out.decode("utf-8", "replace")

        index = http("/")
        check("the bundle is served", index.startswith("HTTP/1.1 200") and "realm-bridge.js" in index, index[:80])
        check("an unknown path falls back to the app", "id=\"root\"" in http("/session/abc"))
        climbed = http("/../../../../etc/passwd")
        check("a path cannot climb out of the bundle", "root:" not in climbed, climbed[:80])
        bridge = http("/realm-bridge.js")
        page_token = info.get("token", "")
        check("the pipe token is in the private state file", len(page_token) >= 24, info)
        check("the bridge carries this port", f'Number("{port}")' in bridge, bridge[:200])
        check("the pipe token is never served over http, even to a plain curl",
              page_token and page_token not in bridge and page_token not in index)
        check("the engine's token never reaches the page", ENGINE_TOKEN not in bridge and ENGINE_TOKEN not in index)
        check("a malformed path is a 400, not a crash", http("/%E0%A4%A").startswith("HTTP/1.1 400"))
        check("the server is still up after it", http("/").startswith("HTTP/1.1 200"))
        check("status --json never carries the token", "token" not in json.dumps(realm_ui.status()))
        raw = socket.create_connection(("127.0.0.1", port), timeout=5)
        raw.sendall(b"GET / HTTP/1.1\r\nHost: evil.test\r\nConnection: close\r\n\r\n")
        check("a rebinding Host is refused", raw.recv(200).decode().startswith("HTTP/1.1 421"))
        raw.close()

        def upgrade(origin_hdr, proto, host=None):
            s = socket.create_connection(("127.0.0.1", port), timeout=5)
            key = base64.b64encode(os.urandom(16)).decode()
            lines = [f"GET / HTTP/1.1", f"Host: {host or f'127.0.0.1:{port}'}", "Upgrade: websocket",
                     "Connection: Upgrade", f"Sec-WebSocket-Key: {key}", "Sec-WebSocket-Version: 13",
                     f"Sec-WebSocket-Protocol: {proto}"]
            if origin_hdr is not None:
                lines.append(f"Origin: {origin_hdr}")
            s.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
            head = b""
            while b"\r\n\r\n" not in head:
                b = s.recv(4096)
                if not b:
                    break
                head += b
            return s, head.decode("latin1")

        s, head = upgrade(origin, f"realm.{page_token}")
        check("the page's own origin and token are piped to the engine", head.startswith("HTTP/1.1 101"), head)
        check("the answer names the page's protocol, never the engine's",
              f"realm.{page_token}" in head and ENGINE_TOKEN not in head, head)
        check("the engine was dialed with its token and no Origin",
              f"realm.{ENGINE_TOKEN}" in seen.get("request", "") and "Origin:" not in seen.get("request", ""))
        s.sendall(b"\x81\x05hello")
        echoed = s.recv(64)
        check("bytes pass through untouched both ways", echoed == b"\x81\x05hello", echoed)
        s.close()

        for label, args in [("another origin", ("http://evil.test", f"realm.{page_token}")),
                            ("no origin", (None, f"realm.{page_token}")),
                            ("a file:// page", ("file://", f"realm.{page_token}")),
                            ("the wrong token", (origin, "realm.nope")),
                            ("the engine's own token", (origin, f"realm.{ENGINE_TOKEN}"))]:
            s, head = upgrade(*args)
            check(f"{label} is refused before the engine is dialed", head.startswith("HTTP/1.1 403"), head[:60])
            s.close()
        s, head = upgrade(origin, f"realm.{page_token}", host="localhost.evil.test:1")
        check("a rebinding Host on the socket is refused", head.startswith("HTTP/1.1 403"), head[:60])
        s.close()

        # ── a normal browser tab: one-time launch codes (no Kyber) ──────────
        def post(path, body="", headers=None):
            import http.client  # noqa: PLC0415
            c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            c.request("POST", path, body=body.encode(), headers={"Host": f"127.0.0.1:{port}", **(headers or {})})
            r = c.getresponse()
            out = (r.status, r.read().decode("utf-8", "replace"))
            c.close()
            return out

        check("a launch code needs the server's token", post("/realm-launch/mint")[0] == 403)
        check("a GET never mints", http("/realm-launch/mint").startswith("HTTP/1.1 405"))
        st, code = post("/realm-launch/mint", headers={"X-Glass-Token": page_token})
        check("the token mints a code that is not the token", st == 200 and len(code) >= 24 and page_token not in code, (st, code))
        check("another origin cannot redeem a code", post("/realm-launch/redeem", code, {"Origin": "http://evil.test"})[0] == 403)
        st, got = post("/realm-launch/redeem", code, {"Origin": origin})
        check("this origin redeems the code for the pipe token", st == 200 and got == page_token, (st, got[:8]))
        check("a code works once", post("/realm-launch/redeem", code, {"Origin": origin})[0] == 403)
        live = {"port": port, "url": f"{origin}/", "token": page_token}
        url = realm_ui.launch_url(live, realm_ui.mint_launch_code(live))
        check("realm-ui open's address carries a code in the fragment, never the token",
              url.startswith(f"{origin}/#launch=") and page_token not in url, url)
        st, got = post("/realm-launch/redeem", url.split("#launch=", 1)[1], {"Origin": origin})
        check("and that code redeems", st == 200 and got == page_token)
        try:
            realm_ui.mint_launch_code({**live, "token": "wrong"})
            check("a wrong token is refused by the CLI too", False)
        except RuntimeError:
            check("a wrong token is refused by the CLI too", True)
    finally:
        proc.terminate()
        proc.wait(timeout=5)
        listener.close()
    # A SIGTERM is a daemon swap: the file stays so the next copy on the
    # port keeps the token and Kyber keeps its page (10/13).
    check("a SIGTERM leaves the state file for the next copy", state.exists())

# `realm-ui stop`, asked for by name, removes it and so rotates the token.
_saved_state_file = realm_ui.state_file
gone_state = TMP / "stop-state.json"
gone_state.write_text("{}")
realm_ui.state_file = lambda: gone_state
try:
    realm_ui.stop(unregister=False)
finally:
    realm_ui.state_file = _saved_state_file
check("realm-ui stop removes the state file, so the next start mints a new token", not gone_state.exists())

# ── realm-ui open: the browser path, with fakes ─────────────────────────────

check("an agent opening the page never pulls the browser forward",
      realm_ui.opener_argv("http://x/", front=False)[:2] == ["/usr/bin/open", "-g"] if sys.platform == "darwin"
      else True)
check("a person at a terminal gets it in front",
      "-g" not in realm_ui.opener_argv("http://x/", front=True))
ran = []
fake_live = {"port": 1, "url": "http://127.0.0.1:1/", "token": "t"}
real_mint, real_built = realm_ui.mint_launch_code, realm_ui.built
realm_ui.mint_launch_code = lambda live: "CODE"
realm_ui.built = lambda: True
try:
    got = realm_ui.open_in_browser(front=False, run=lambda argv, **k: ran.append(argv) or subprocess.CompletedProcess(argv, 0, "", ""),
                                   start_fn=lambda: fake_live, engine_fn=lambda: True)
    target = Path(ran[0][-1]) if ran else Path("/nonexistent")
    check("open reports the plain address", got == "http://127.0.0.1:1/", got)
    check("the launch code never rides in the opener's argv, where ps shows it to every account",
          ran and not any("CODE" in a for a in ran[0]), ran)
    check("the browser is handed a private file that sends it on to the one-time address",
          target.is_file() and oct(target.stat().st_mode & 0o777) == "0o600"
          and oct(target.parent.stat().st_mode & 0o777) == "0o700"
          and 'location.replace("http://127.0.0.1:1/#launch=CODE")' in target.read_text(),
          (target, target.read_text() if target.is_file() else ""))
    stale = realm_ui.launch_file("http://x/#launch=OLD", now=lambda: time.time())
    os.utime(stale, (time.time() - 600, time.time() - 600))
    realm_ui.launch_file("http://x/#launch=NEW")
    check("a launch file past its code's life is swept", not stale.exists())
    printed = realm_ui.open_in_browser(print_only=True, run=lambda *a, **k: ran.append("ran"),
                                       start_fn=lambda: fake_live, engine_fn=lambda: True)
    check("--print-url opens nothing", printed.endswith("#launch=CODE") and ran.count("ran") == 0, printed)
    try:
        realm_ui.open_in_browser(front=False, run=lambda *a, **k: None, start_fn=lambda: fake_live, engine_fn=lambda: False)
        check("an engine that won't start is named, not a blank page", False)
    except RuntimeError as err:
        check("an engine that won't start is named, not a blank page", "engine" in str(err), str(err))
    realm_ui.built = lambda: False
    try:
        realm_ui.open_in_browser(front=False, start_fn=lambda: fake_live, engine_fn=lambda: True)
        check("an unbuilt interface names the build step", False)
    except RuntimeError as err:
        check("an unbuilt interface names the build step", "realm-ui build" in str(err), str(err))
finally:
    realm_ui.mint_launch_code, realm_ui.built = real_mint, real_built

# ── a stranger is told where the page is ──────────────────────────────────

readme = (ROOT / "README.md").read_text()
check("the README names the no-Kyber way to the agents page",
      "chewbacca agents" in readme and "browser" in readme.split("chewbacca agents", 1)[1][:400])
sys.path.insert(0, str(ROOT / "tools"))
import io  # noqa: E402
import contextlib  # noqa: E402
import agent_runtime  # noqa: E402
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    agent_runtime.describe("setup", {"brain_dir": "/x", "created_context": False, "runtimes": [],
                                     "shared_skills": {"conflicts": []}, "missing_dependencies": [],
                                     "missing_context_sources": []})
said = buf.getvalue()
check("runtime setup says how to get to the agents page with a command that exists",
      "Agents page:" in said and ("chewbacca agents" in said) and
      (said.split("Agents page: ", 1)[1].startswith("chewbacca agents")
       or Path(said.split("Agents page: ", 1)[1].split(" agents", 1)[0].strip("'")).is_file()), said)
chew = (ROOT / "bin" / "chewbacca").read_text()
check("chewbacca agents opens the page, building it first", 'exec python3 "$ROOT/bin/realm-ui" open --build' in chew)

# ── the Swift side reads what the surface sends ─────────────────────────────

swift = (ROOT / "hud" / "Sources" / "KyberKit" / "SurfaceView.swift").read_text()
check("the HUD draws an App component", 'case "App":' in swift and "AppPaneView(" in swift)
a11y = (ROOT / "hud" / "Sources" / "KyberKit" / "A11yContract.swift").read_text()
check("App has an accessibility entry", '"App": Entry(' in a11y)
bridge_src = (ROOT / "bin" / "lib" / "realm_ui" / "bridge.js").read_text()
app_swift = (ROOT / "hud" / "Sources" / "KyberKit" / "AppPane.swift").read_text()
check("the HUD hands the token to the page before it runs, top frame only",
      "pipeToken(for: url, file: stateFile)" in app_swift and ".atDocumentStart, forMainFrameOnly: true" in app_swift)
check("the bridge takes the token off the window", "delete window.__realmUiToken" in (ROOT / "bin" / "lib" / "realm_ui" / "bridge.js").read_text())
check("Escape stays with the page in a dialog, editor or terminal",
      all(s in bridge_src for s in ('[role="dialog"]', ".cm-editor", ".xterm")))

# ── a land never leaves the port dark (10/13) ───────────────────────────────

rec = realm_ui.service_record() if hasattr(realm_ui, "service_record") else {}
check("realm-ui swaps overlap on the daemon's shared port, health-checked",
      rec.get("swap") == "overlap" and rec.get("listen") == realm_ui.port() and rec.get("health") == {"http": "/"}, rec)

# A rebuild keeps the build before it, so a kept page still finds its chunks.
assets = TMP / "assets-prune"
assets.mkdir(parents=True, exist_ok=True)
for n in ("index-OLD.js", "Lazy-OLD.js", "index-ANCIENT.js"):
    (assets / n).write_text("x")
os.utime(assets / "index-ANCIENT.js", (1, 1))
os.utime(assets / "index-OLD.js", (1000, 1000))
os.utime(assets / "Lazy-OLD.js", (1000, 1000))
(assets / ".builds.json").write_text(json.dumps({"current": ["index-OLD.js", "Lazy-OLD.js"]}))
import time as _t
started = _t.time()
(assets / "index-NEW.js").write_text("y")
gone = realm_ui.prune_assets(assets, started) if hasattr(realm_ui, "prune_assets") else None
left = sorted(p.name for p in assets.iterdir() if not p.name.startswith("."))
check("a rebuild keeps this build and the last one, and drops older", gone == ["index-ANCIENT.js"]
      and left == ["Lazy-OLD.js", "index-NEW.js", "index-OLD.js"], (gone, left))
first = TMP / "assets-first"
first.mkdir(parents=True, exist_ok=True)
(first / "Lazy-LIVE.js").write_text("x")
os.utime(first / "Lazy-LIVE.js", (1000, 1000))
gone = realm_ui.prune_assets(first, _t.time()) if hasattr(realm_ui, "prune_assets") else None
check("the first build with no record keeps what a kept page runs", gone == [] and (first / "Lazy-LIVE.js").exists(), gone)
vite = (ROOT / "bin" / "lib" / "realm_ui" / "vite.config.mjs").read_text()
check("vite keeps dist between builds", "emptyOutDir: false" in vite)

shutil.rmtree(TMP, ignore_errors=True)
print(f"\n{'all passed' if not failed else f'{failed} failed'}")
sys.exit(1 if failed else 0)
