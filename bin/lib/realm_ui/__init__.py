"""Realm's own desktop interface on the Chewbacca glass.

Realm is Carlton Aikins' agent workspace (github.com/31Carlton7/realm). Its
desktop app is Electron, but everything it draws lives in one React renderer
(apps/desktop/src/renderer) whose only tie to Electron is the preload bridge,
`window.realm`. Carlton told Caleb to copy his code (2026-10-11), so this
copies that renderer as written, builds it as a static bundle, and serves it
on 127.0.0.1 next to the realm engine Kyber already runs:

    build    copy the renderer, @realm/contracts and @realm/ui out of the realm
             checkout into ~/.chewbacca/realm-ui/build, npm install, vite build
    serve    server.mjs: the bundle, bridge.js as window.realm, and a WebSocket
             pipe to the engine holding realm's own origin and token locks

The realm checkout is never edited; the copy is what gets built. The HUD
draws the page with AppPane.swift, and bin/lib/surfaces/realm_app.py opens it.
Stock /usr/bin/python3 is 3.9 on this Mac, so no `X | None` at runtime here.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import realm_client  # noqa: E402

SERVICE = "realm-ui"
# One fixed loopback port. The page keeps Realm's layout and theme in
# localStorage, which is scoped to the origin, port included: on a random port
# every restart forgot them. A fixed port also makes a second start fail on
# EADDRINUSE instead of running two servers. Picked 2026-10-11 as unused on
# Caleb's Mac (lsof showed nothing on it); not reserved by anything.
DEFAULT_PORT = 47317
# How long start waits for server.mjs to write its state file. It wrote it in
# under 0.2 s on 2026-10-11 with load near 20; 10 s is a guessed ceiling.
READY_TIMEOUT_S = 10.0
# Renderer devDependencies that only Electron, packaging or the tests use.
# Dropping them keeps the install to what the bundle imports (344 packages,
# 20 s on 2026-10-11) and away from Electron's 200 MB download.
NOT_FOR_THE_BUNDLE = {
    "electron", "electron-builder", "electron-updater", "electron-vite", "@electron/notarize",
    "@realm/contracts", "@realm/test-utils", "@realm/ui",
    "@testing-library/jest-dom", "@testing-library/react", "jsdom",
}
# What the copied packages need that the desktop package.json does not list,
# because pnpm's workspace hoisted it. @hugeicons/core-free-icons replaces the
# paid pack (see vite.config.mjs).
EXTRA_DEPS = {"zod": "^3.24.0", "ulid": "^2.3.0", "@hugeicons/react": "^1.0.0",
              "@hugeicons/core-free-icons": "^1.2.1"}


def realm_dir() -> Path:
    return Path(os.environ.get("CHEWBACCA_REALM_DIR") or Path.home() / "code" / "vendor" / "realm").expanduser()


def ui_home() -> Path:
    return Path(os.environ.get("CHEWBACCA_REALM_UI_HOME") or Path.home() / ".chewbacca" / "realm-ui").expanduser()


def build_dir() -> Path:
    return ui_home() / "build"


def dist_dir() -> Path:
    return build_dir() / "dist"


def state_file() -> Path:
    return ui_home() / "server.json"


def port() -> int:
    raw = os.environ.get("CHEWBACCA_REALM_UI_PORT", "")
    return int(raw) if raw.isdigit() else DEFAULT_PORT


def node() -> Optional[str]:
    return os.environ.get("CHEWBACCA_NODE") or shutil.which("node")


def npm() -> Optional[str]:
    return os.environ.get("CHEWBACCA_NPM") or shutil.which("npm")


def realm_commit(repo: Path) -> str:
    try:
        out = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return out.stdout.strip() if out.returncode == 0 else ""


def package_json(desktop: dict) -> dict:
    """The build's package.json: the renderer's own dependencies, as Carlton
    pinned them, minus Electron and the tests, plus what the workspace hoisted."""
    deps = {**desktop.get("dependencies", {}), **desktop.get("devDependencies", {})}
    deps = {k: v for k, v in deps.items() if k not in NOT_FOR_THE_BUNDLE}
    deps.update(EXTRA_DEPS)
    return {"name": "chewbacca-realm-ui", "private": True, "type": "module", "dependencies": dict(sorted(deps.items()))}


def fingerprint(*parts: str) -> str:
    h = hashlib.sha256()
    for part in parts:
        h.update(part.encode("utf-8"))
        h.update(b"\0")
    return h.hexdigest()[:16]


def _copy(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst, symlinks=False,
                    ignore=shutil.ignore_patterns("node_modules", "*.test.ts", "*.test.tsx", "dist", "out"))


def build(force: bool = False, log=print) -> dict:
    """Copy Carlton's renderer and build it. Returns the build record.

    Skips the work when the realm commit and this kit's build files are the
    ones the last build used, unless force is set."""
    repo = realm_dir()
    renderer = repo / "apps" / "desktop" / "src" / "renderer"
    if not renderer.is_dir():
        raise RuntimeError(f"no realm renderer at {renderer}; run realm-engine build first")
    if not node() or not npm():
        raise RuntimeError("node and npm are needed to build Realm's interface")
    commit = realm_commit(repo)
    desktop = json.loads((repo / "apps" / "desktop" / "package.json").read_text())
    pkg = package_json(desktop)
    config = (HERE / "vite.config.mjs").read_text()
    stamp = fingerprint(commit, json.dumps(pkg, sort_keys=True), config)
    record_path = build_dir() / "build.json"
    try:
        record = json.loads(record_path.read_text())
    except (OSError, ValueError):
        record = {}
    if not force and record.get("stamp") == stamp and (dist_dir() / "index.html").exists():
        log(f"realm-ui: already built from realm {commit[:8]}")
        return record

    b = build_dir()
    b.mkdir(parents=True, exist_ok=True)
    # Laid out like realm's workspace, so the copied tsconfig "extends" paths
    # and the renderer's relative imports resolve unchanged.
    _copy(renderer, b / "apps" / "desktop" / "src" / "renderer")
    for name in ("tsconfig.json", "tsconfig.web.json", "tsconfig.node.json"):
        if (repo / "apps" / "desktop" / name).exists():
            shutil.copy2(repo / "apps" / "desktop" / name, b / "apps" / "desktop" / name)
    shutil.copy2(repo / "tsconfig.base.json", b / "tsconfig.base.json")
    for pkg_name in ("contracts", "ui"):
        _copy(repo / "packages" / pkg_name, b / "packages" / pkg_name)
    shutil.copy2(HERE / "vite.config.mjs", b / "vite.config.mjs")

    pkg_text = json.dumps(pkg, indent=1) + "\n"
    pkg_path = b / "package.json"
    if not pkg_path.exists() or pkg_path.read_text() != pkg_text or not (b / "node_modules" / "vite").exists():
        pkg_path.write_text(pkg_text)
        log("realm-ui: npm install")
        done = subprocess.run([npm(), "install", "--no-audit", "--no-fund", "--loglevel=error"], cwd=b)
        if done.returncode != 0:
            raise RuntimeError(f"npm install failed ({done.returncode})")
    # The workspace packages resolve by name, as pnpm's workspace links did.
    scope = b / "node_modules" / "@realm"
    scope.mkdir(parents=True, exist_ok=True)
    for pkg_name in ("contracts", "ui"):
        link = scope / pkg_name
        if link.is_symlink() or link.exists():
            link.unlink() if link.is_symlink() else shutil.rmtree(link)
        link.symlink_to(Path("..") / ".." / "packages" / pkg_name)

    log("realm-ui: vite build")
    started = time.time()
    done = subprocess.run([node(), str(b / "node_modules" / "vite" / "bin" / "vite.js"), "build", "--logLevel", "warn"], cwd=b)
    if done.returncode != 0 or not (dist_dir() / "index.html").exists():
        raise RuntimeError(f"vite build failed ({done.returncode})")
    record = {"stamp": stamp, "realmCommit": commit, "built": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
              "seconds": round(time.time() - started, 1)}
    record_path.write_text(json.dumps(record) + "\n")
    log(f"realm-ui: built realm {commit[:8]} in {record['seconds']}s")
    return record


def built() -> bool:
    return (dist_dir() / "index.html").exists()


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _is_ours(pid: int) -> bool:
    """The pid is our server.mjs, not a recycled pid."""
    try:
        out = subprocess.run(["ps", "-o", "command=", "-p", str(pid)], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return "realm_ui/server.mjs" in out.stdout


def running() -> Optional[dict]:
    """The live server's state, or None."""
    try:
        data = json.loads(state_file().read_text())
    except (OSError, ValueError):
        return None
    pid = data.get("pid")
    if not isinstance(pid, int) or not _alive(pid) or not _is_ours(pid):
        return None
    return data


def serve_argv() -> list:
    return [node() or "node", str(HERE / "server.mjs"), "--dist", str(dist_dir()),
            "--realm-home", str(realm_client.realm_home()), "--state", str(state_file()), "--port", str(port())]


def service_argv() -> list:
    """What chewbacca-daemon runs: `realm-ui serve` through its PATH link, as
    the other services do (~/.local/bin/kyber-sessions), so a kit update moves
    the server to the new code instead of pinning a snapshot that gets pruned."""
    cli = shutil.which("realm-ui") or str(ROOT / "bin" / "realm-ui")
    return ["/usr/bin/python3", cli, "serve"]


def _daemon_owns_it() -> bool:
    """Whether chewbacca-daemon is loaded to run the service it was just handed."""
    try:
        import daemon_register  # noqa: PLC0415
        return daemon_register._loaded()  # noqa: SLF001
    except (ImportError, OSError):
        return False


def start(register: bool = True, spawn=subprocess.Popen, daemon_owns=None) -> dict:
    """Make sure the server is up and return its state.

    Registers it with chewbacca-daemon as a keepalive service and lets the
    daemon start it, so there is exactly one owner. When the daemon is loaded
    nothing is spawned here: on 2026-10-11 this function also spawned its own
    detached copy, that copy held the port, the daemon's service died on
    EADDRINUSE every five minutes, and the orphan kept serving code from a
    kit snapshot hours old because nothing that restarts on a kit update
    owned it. Only without a loaded daemon (a test, a fresh machine) does it
    spawn the server itself."""
    live = running()
    if live:
        return live
    if not built():
        raise RuntimeError("Realm's interface is not built; run realm-ui build")
    if not node():
        raise RuntimeError("node is not on PATH")
    ui_home().mkdir(parents=True, exist_ok=True)
    registered = False
    if register:
        try:
            import daemon_register  # noqa: PLC0415  only when registering
            daemon_register.register(SERVICE, service_argv(), keepalive=True, ensure_daemon=False)
            registered = True
        except (ImportError, ValueError, OSError):
            pass
    log_path = ui_home() / "server.log"
    owned = registered and (daemon_owns() if daemon_owns else _daemon_owns_it())
    if not owned:
        with open(log_path, "a", encoding="utf-8") as log:
            spawn(serve_argv(), stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    deadline = time.time() + READY_TIMEOUT_S
    while time.time() < deadline:
        live = running()
        if live:
            return live
        time.sleep(0.1)
    raise RuntimeError(f"the Realm interface server did not come up; see {log_path}")


def stop(unregister: bool = True) -> bool:
    if unregister:
        try:
            import daemon_register  # noqa: PLC0415
            daemon_register.unregister(SERVICE)
        except ImportError:
            pass
    live = running()
    if not live:
        return False
    os.kill(live["pid"], signal.SIGTERM)
    return True


def status() -> dict:
    live = running()
    try:
        record = json.loads((build_dir() / "build.json").read_text())
    except (OSError, ValueError):
        record = {}
    return {"built": built(), "realmCommit": record.get("realmCommit", ""), "running": bool(live),
            "url": (live or {}).get("url", ""), "pid": (live or {}).get("pid")}
