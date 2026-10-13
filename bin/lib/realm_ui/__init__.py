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

The realm checkout is never edited; the copy is what gets built. Two modes
pick the bundle's entry, each importing his main.tsx unchanged
(vite.config.mjs):

    stock    the default since 10/13: stock/main.tsx, his app as he ships it,
             plus only what a web view needs to stand in for Electron (the
             folder chooser and the file describer). Caleb, 10/13 8:19am, of
             the layer below: "so far from a better version of carlton's ide"
    glass    opt-in: glass/main.tsx, our agent tiles, story and bar over his app

`realm-ui build --mode` and `--source` are remembered in settings.json, so a
later plain rebuild (the night chain's) stays on the same mode and checkout. The HUD
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
# under 0.2 s on 2026-10-11 with load near 20, but on 10/13 the stranger rig's
# first start, right after a cold page build at load 25 to 35, missed a 10 s
# wait while its log said ready; 30 s covers that, guessed from that one miss.
READY_TIMEOUT_S = 30.0
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


MODES = ("stock", "glass")


def ui_home() -> Path:
    return Path(os.environ.get("CHEWBACCA_REALM_UI_HOME") or Path.home() / ".chewbacca" / "realm-ui").expanduser()


def settings_file() -> Path:
    return ui_home() / "settings.json"


def settings() -> dict:
    """What `realm-ui build --mode/--source` last chose. Empty when never set."""
    try:
        got = json.loads(settings_file().read_text())
    except (OSError, ValueError):
        return {}
    return got if isinstance(got, dict) else {}


def save_settings(**changes: str) -> dict:
    """Remember what was picked. A value of "default" forgets that key, so
    `--source default` goes back to the engine's checkout."""
    current = settings()
    for k, v in changes.items():
        if v == "default":
            current.pop(k, None)
        elif v:
            current[k] = v
    settings_file().parent.mkdir(parents=True, exist_ok=True)
    settings_file().write_text(json.dumps(current, indent=1, sort_keys=True) + "\n")
    return current


def mode() -> str:
    """Which entry the bundle is built from: REALM_UI_MODE for one build,
    else the remembered one, else stock (his app as he ships it)."""
    # "bare" (his entry, nothing of ours but the bridge) is for the side-by-side
    # check only, so it is taken from the environment and never remembered.
    if os.environ.get("REALM_UI_MODE") == "bare":
        return "bare"
    for picked in (os.environ.get("REALM_UI_MODE", ""), str(settings().get("mode", ""))):
        if picked in MODES:
            return picked
    return "stock"


def realm_dir() -> Path:
    """Where the renderer is copied from. REALM_UI_SOURCE for one build, else
    the checkout `--source` remembered (Caleb's fork, ~/code/realm-fork,
    github.com/calebnewtonusc/realm branch chewbacca; it beats the engine's
    checkout until `--source default` forgets it), else the engine's
    checkout: CHEWBACCA_REALM_DIR, unset ~/code/vendor/realm."""
    picked = (os.environ.get("REALM_UI_SOURCE") or str(settings().get("source", ""))
              or os.environ.get("CHEWBACCA_REALM_DIR"))
    return Path(picked or Path.home() / "code" / "vendor" / "realm").expanduser()


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


def build(force: bool = False, log=print, mode_pick: str = "", source: str = "") -> dict:
    """Copy Carlton's renderer and build it. Returns the build record.

    mode_pick and source, when given, are remembered for every later build.
    Skips the work when the realm commit, the mode and this kit's build files
    are the ones the last build used, unless force is set."""
    if mode_pick and mode_pick not in MODES + ("default",):
        raise RuntimeError(f"realm-ui: mode is one of {', '.join(MODES)}, not {mode_pick!r}")
    if source and source != "default" and not (Path(source).expanduser() / "apps" / "desktop" / "src" / "renderer").is_dir():
        raise RuntimeError(f"realm-ui: {source} is not a realm checkout")
    picks = {"mode": mode_pick,
             "source": source if source in ("", "default") else str(Path(source).expanduser().resolve())}
    # This build uses the picks; they're remembered only once it has worked,
    # so a failed `--mode glass` doesn't leave every later rebuild trying it.
    before = settings()
    if mode_pick or source:
        save_settings(**picks)
    try:
        return _build(force, log)
    except BaseException:
        if before:
            settings_file().write_text(json.dumps(before, indent=1, sort_keys=True) + "\n")
        elif settings_file().exists():
            settings_file().unlink()
        raise


def _build(force: bool, log) -> dict:
    entry = mode()
    if entry == "bare" and ui_home() == Path.home() / ".chewbacca" / "realm-ui":
        # The bare reference has no folder chooser; built into the live home
        # it would replace the bundle the glass serves.
        raise RuntimeError("realm-ui: REALM_UI_MODE=bare builds only into a scratch CHEWBACCA_REALM_UI_HOME")
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
    # The source path is in the stamp, so switching checkouts rebuilds even
    # when the fork's branch and his main sit on the same commit.
    stamp = fingerprint(str(repo), commit, entry, json.dumps(pkg, sort_keys=True), config, *layer_texts())
    record_path = build_dir() / "build.json"
    try:
        record = json.loads(record_path.read_text())
    except (OSError, ValueError):
        record = {}
    if not force and record.get("stamp") == stamp and (dist_dir() / "index.html").exists():
        log(f"realm-ui: already built ({entry}) from {repo} at {commit[:8]}")
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
    # Ours sits beside his src/, never inside it: stock/main.tsx or
    # glass/main.tsx is the entry and imports his main.tsx as written
    # (vite.config.mjs). Both are copied; the stock entry borrows the folder
    # chooser and file describer from glass/.
    _copy(LAYER, b / "apps" / "desktop" / "src" / "renderer" / "glass")
    _copy(STOCK, b / "apps" / "desktop" / "src" / "renderer" / "stock")

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
    done = subprocess.run([node(), str(b / "node_modules" / "vite" / "bin" / "vite.js"), "build", "--logLevel", "warn"], cwd=b,
                          env=dict(os.environ, REALM_UI_MODE=entry))
    if done.returncode != 0 or not (dist_dir() / "index.html").exists():
        raise RuntimeError(f"vite build failed ({done.returncode})")
    prune_assets(dist_dir() / "assets", started)
    record = {"stamp": stamp, "realmCommit": commit, "source": str(repo), "mode": entry, "built": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
              "seconds": round(time.time() - started, 1)}
    record_path.write_text(json.dumps(record) + "\n")
    log(f"realm-ui: built ({entry}) {repo} at {commit[:8]} in {record['seconds']}s")
    return record


LAYER = HERE / "glass"
STOCK = HERE / "stock"
# The asset list of the build before this one, beside the assets.
ASSETS_RECORD = ".builds.json"


def prune_assets(assets: Path, started: float) -> list:
    """Keep this build's files and the last one's; remove the rest.

    vite no longer empties dist (vite.config.mjs): a page still running the
    last build fetches its lazy chunks from there until it reloads. A file
    this build wrote has an mtime at or after `started` (rollup writes every
    chunk on every build). Returns the names removed."""
    try:
        names = [p.name for p in assets.iterdir() if p.is_file() and p.name != ASSETS_RECORD]
    except OSError:
        return []
    record = assets / ASSETS_RECORD
    try:
        last = set(json.loads(record.read_text()).get("current", []))
    except (OSError, ValueError, AttributeError):
        # No record: the first build since dist stopped being emptied. What
        # is there is the build a kept page may be running, so all of it
        # stays this once (review, 10/13).
        last = set(names)
    # A second of slack: some filesystems keep mtimes to the second.
    current = sorted(n for n in names if (assets / n).stat().st_mtime >= started - 1)
    keep = set(current) | last
    removed = []
    for n in names:
        if n not in keep:
            try:
                (assets / n).unlink()
                removed.append(n)
            except OSError:
                pass
    record.write_text(json.dumps({"current": current, "previous": sorted(last)}) + "\n")
    return removed


def layer_texts() -> list:
    """Every file of both entries, so a change to either rebuilds the bundle."""
    return [f"{p.relative_to(HERE)}\n{p.read_text()}" for d in (LAYER, STOCK) for p in sorted(d.rglob("*")) if p.is_file()]


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
    """The pid is our server.mjs, not a recycled pid. Read from the kernel
    (procargs.py), so a sandboxed caller that can't exec `ps` still sees it."""
    try:
        import procargs  # noqa: PLC0415
        got = procargs.args(pid)
    except ImportError:
        got = None
    if got is not None:
        return any(a.endswith("realm_ui/server.mjs") for a in got[0])
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


def last_url() -> str:
    """The address the server last wrote, read without checking its pid: what
    the realm surface's first frame shows while the fetch confirms it. A
    stale address only means the page loads late, never a wrong page, since
    the HUD loads nothing but this Mac's loopback."""
    try:
        url = json.loads(state_file().read_text()).get("url", "")
    except (OSError, ValueError, AttributeError):
        return ""
    return url if isinstance(url, str) else ""


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


def service_record() -> dict:
    """The service chewbacca-daemon runs. Swapped overlap on a kit move: the
    new copy binds the same port beside the old one (listen_exec.py hands it
    the socket) and the old one stops once / answers, so the port is never
    dark. Stop-start, its old mode, left it dark 0.2 to 3.9 s on every land
    on 10/12 (final-report.md), and with a fresh pipe token each time."""
    return {"name": SERVICE, "argv": service_argv(), "keepalive": True, "swap": "overlap",
            "listen": port(), "health": {"http": "/"}}


def _register(force: bool = False) -> bool:
    """Write the service record when it differs from the one on disk. True
    when the daemon has it. Read before written, so every open of the glass
    doesn't rewrite a file the daemon reads."""
    try:
        import daemon_register  # noqa: PLC0415  only when registering
    except ImportError:
        return False
    want = service_record()
    path = daemon_register.DAEMON_DIR / "services" / f"{SERVICE}.json"
    try:
        if not force and json.loads(path.read_text()) == want:
            return True
    except (OSError, ValueError):
        pass
    try:
        daemon_register.register(SERVICE, want["argv"], keepalive=True, ensure_daemon=False,
                                 swap=want["swap"], listen=want["listen"], health_http=want["health"]["http"])
        return True
    except (ValueError, OSError):
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
        # A server started under the old record still gets the new one, so
        # the daemon's next swap of it is an overlap.
        if register:
            _register()
        return live
    if not built():
        raise RuntimeError("Realm's interface is not built; run realm-ui build")
    if not node():
        raise RuntimeError("node is not on PATH")
    ui_home().mkdir(parents=True, exist_ok=True)
    registered = _register() if register else False
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
    if live:
        os.kill(live["pid"], signal.SIGTERM)
    # The server leaves its state file on SIGTERM so a daemon swap keeps the
    # pipe token (server.mjs keptToken). A stop asked for by name removes it,
    # so the next start mints a new token.
    try:
        state_file().unlink()
    except FileNotFoundError:
        pass
    return bool(live)


def status() -> dict:
    live = running()
    try:
        record = json.loads((build_dir() / "build.json").read_text())
    except (OSError, ValueError):
        record = {}
    # A record from before 10/13 has no mode: every build then was the glass layer.
    return {"built": built(), "realmCommit": record.get("realmCommit", ""), "source": record.get("source", ""),
            "mode": record.get("mode", "glass" if record else ""),
            "running": bool(live),
            "url": (live or {}).get("url", ""), "pid": (live or {}).get("pid")}


# ── a normal browser tab, for a Mac with no Kyber ───────────────────────────
# How long the CLI waits on the local server to mint a launch code. It answers
# from memory in milliseconds; 5 s is a guessed ceiling, never measured.
MINT_TIMEOUT_S = 5.0


def _engine_up() -> bool:
    try:
        data = realm_client.read_engine(realm_client.realm_home())
    except realm_client.RealmUnavailable:
        return False
    return realm_client.is_realm_server(data.get("pid", 0), realm_client.realm_home())


def ensure_engine(run=subprocess.run) -> bool:
    """Start the realm engine when nothing has. Kyber starts it on Caleb's Mac;
    with no Kyber nothing did, and the page sat on "engine down"."""
    if _engine_up():
        return True
    try:
        done = run(["/usr/bin/env", "python3", str(ROOT / "bin" / "realm-engine"), "start"],
                   capture_output=True, text=True, timeout=90)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return done.returncode == 0


def ensure_built(run=subprocess.run, build_fn=None) -> None:
    """Build the engine and the page when either is missing, so one command
    takes a stranger from a checkout to the page. Both builds skip themselves
    when already current. On 10/12 the stranger run spent 23 s on the engine
    and 55 s on the page, the first time only."""
    try:
        engine = run(["/usr/bin/env", "python3", str(ROOT / "bin" / "realm-engine"), "build"], timeout=1800)
    except (OSError, subprocess.TimeoutExpired) as err:
        raise RuntimeError(f"the realm engine build did not finish: {err}") from None
    if engine.returncode != 0:
        raise RuntimeError("the realm engine did not build; see the lines above")
    if not built():
        (build_fn or build)()


def mint_launch_code(live: dict) -> str:
    """Trade the server's token (read from the 0600 state file) for a one-time
    code the browser can carry in its address bar (server.mjs launchCodes)."""
    import http.client  # noqa: PLC0415
    port_n = int(live["port"])
    conn = http.client.HTTPConnection("127.0.0.1", port_n, timeout=MINT_TIMEOUT_S)
    try:
        conn.request("POST", "/realm-launch/mint", body=b"",
                     headers={"Host": f"127.0.0.1:{port_n}", "X-Glass-Token": str(live.get("token", ""))})
        resp = conn.getresponse()
        body = resp.read().decode("utf-8", "replace").strip()
    except OSError as err:
        raise RuntimeError(f"the Realm interface server did not answer: {err}") from None
    finally:
        conn.close()
    if resp.status != 200 or not body:
        raise RuntimeError(f"the Realm interface server refused a launch code ({resp.status} {body})")
    return body


def launch_url(live: dict, code: str) -> str:
    return f"{live['url'].rstrip('/')}/#launch={code}"


def launch_dir() -> Path:
    return ui_home() / "launch"


# How long a launch file outlives its code. The code dies at 120 s
# (server.mjs LAUNCH_CODE_TTL_MS), so a file older than that is only litter.
LAUNCH_FILE_TTL_S = 120


def launch_file(url: str, now=time.time) -> Path:
    """A one-line page that sends the browser on to url, in a 0700 folder.

    The launch code would otherwise ride in `open`'s argv, which any account
    on the Mac can read in `ps` while it runs (security review, 10/13). A path
    in argv gives away nothing: only this user can read the file behind it."""
    d = launch_dir()
    d.mkdir(parents=True, exist_ok=True)
    os.chmod(d, 0o700)
    for old in d.glob("*.html"):
        try:
            if now() - old.stat().st_mtime > LAUNCH_FILE_TTL_S:
                old.unlink()
        except OSError:
            pass
    path = d / f"{os.urandom(12).hex()}.html"
    safe = json.dumps(url).replace("<", "\\u003c")
    body = ('<!doctype html><meta charset="utf-8"><title>Agents</title>'
            f'<script>location.replace({safe})</script>\n')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(body)
    return path


def opener_argv(url: str, front: bool) -> list:
    """The command that opens url in the default browser. On a Mac `open -g`
    keeps it behind whatever has focus: an agent running this must never pull
    a window forward (feedback_nothing_takes_the_screen). A person at a
    terminal asked to see it, so only then does it come to the front."""
    if sys.platform == "darwin":
        return ["/usr/bin/open"] + ([] if front else ["-g"]) + [url]
    return [shutil.which("xdg-open") or "xdg-open", url]


def open_in_browser(front: Optional[bool] = None, print_only: bool = False, run=subprocess.run,
                    start_fn=None, engine_fn=None) -> str:
    """The agents page in a normal browser tab, with the same buttons as on the
    glass. Returns the address it opened (without the code)."""
    if not built():
        raise RuntimeError("Realm's interface is not built; run realm-ui build first")
    if not (engine_fn or ensure_engine)():
        raise RuntimeError("the realm engine is not running and would not start; see realm-engine status")
    live = (start_fn or start)()
    url = launch_url(live, mint_launch_code(live))
    if print_only:
        return url
    if front is None:
        front = sys.stdin.isatty() and sys.stdout.isatty()
    done = run(opener_argv(str(launch_file(url)), front), capture_output=True, text=True, timeout=30)
    if done.returncode != 0:
        raise RuntimeError(f"could not open a browser: {(done.stderr or '').strip()[:200]}")
    return live["url"]
