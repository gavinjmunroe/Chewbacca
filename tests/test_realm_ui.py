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

# ── nothing built ───────────────────────────────────────────────────────────

check("not built: not available", realm_app.available() is False)
check("not built: show my agents opens the card", surface_intent.parse("show my agents").name == "agents")
check("not built: the rail's agents icon opens the card", surfaces.make("apps").opens("agents") == "agents")
try:
    realm_ui.start(register=False)
    check("not built: start refuses", False)
except RuntimeError as err:
    check("not built: start refuses and says how to build", "realm-ui build" in str(err), str(err))

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

app = realm_app.RealmApp(start=lambda: {"url": "http://127.0.0.1:47317/"})
lines = app.layout()
check("it is a glance, so a click off it takes it down", lines[0] == "glance realm", lines)
check("it draws the App component bound to the url", any(l.startswith("c realm-app App url=@/realm/url") for l in lines), lines)
check("it opens centred on glass, at least Realm's 900-point minimum",
      app.region == "center" and app.chrome == "glass" and app.width >= 900)
data = app.fetch(surfaces.Context())
check("fetch hands the server's url to the page", app.model(data, None, {}, None)["/realm/url"] == "http://127.0.0.1:47317/", data)
broken = app.model(None, "the Realm interface server did not come up", {}, None)
check("an error says so and draws no page", broken["/realm/url"] == "" and "did not come up" in broken["/realm/note"], broken)
check("no error, no note", app.model(data, None, {}, None)["/realm/note"] == "")


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
    finally:
        proc.terminate()
        proc.wait(timeout=5)
        listener.close()
    check("the state file goes with the server", not state.exists())

# ── the Swift side reads what the surface sends ─────────────────────────────

swift = (ROOT / "hud" / "Sources" / "KyberKit" / "SurfaceView.swift").read_text()
check("the HUD draws an App component", 'case "App":' in swift and "AppPaneView(" in swift)
a11y = (ROOT / "hud" / "Sources" / "KyberKit" / "A11yContract.swift").read_text()
check("App has an accessibility entry", '"App": Entry(' in a11y)
bridge_src = (ROOT / "bin" / "lib" / "realm_ui" / "bridge.js").read_text()
app_swift = (ROOT / "hud" / "Sources" / "KyberKit" / "AppPane.swift").read_text()
check("the HUD hands the token to the page before it runs, top frame only",
      "pipeToken(for: url)" in app_swift and ".atDocumentStart, forMainFrameOnly: true" in app_swift)
check("the bridge takes the token off the window", "delete window.__realmUiToken" in (ROOT / "bin" / "lib" / "realm_ui" / "bridge.js").read_text())
check("Escape stays with the page in a dialog, editor or terminal",
      all(s in bridge_src for s in ('[role="dialog"]', ".cm-editor", ".xterm")))

shutil.rmtree(TMP, ignore_errors=True)
print(f"\n{'all passed' if not failed else f'{failed} failed'}")
sys.exit(1 if failed else 0)
