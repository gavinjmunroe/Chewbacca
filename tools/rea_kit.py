#!/usr/bin/env python3
"""chewbacca rea: the kit's front door to REA (Reverse Engineer Anything).

REA (npm `rea-agents`, github.com/morluto/rea) is optional. Nothing here
installs it, and every command works, or says plainly why not, on a Mac
without it.

What this adds over calling REA directly, each from a failure measured on
2026-10-12 (report: ~/.chewbacca/overnight/rea-across-kit-report.md):

- `native` thins a universal Mach-O first. Every app and system binary on a
  Mac is universal, and Ghidra refuses all of them ("cannot enforce the
  selected architecture when importing a universal Mach-O"), so native
  analysis failed on 100% of real targets. Thinned, /usr/bin/uuidgen took 12 s.
- `native` passes GHIDRA_INSTALL_DIR and JAVA_HOME, which the MCP entry lacks.
- `scope` cuts an Electron app down to the files holding one seed string,
  because the whole 44 MB Claude.app asar died at file 8 of 427.
- every run sits under a deadline and its whole process group is killed,
  because the CLI can stay alive after a failure (upstream #2290) and its
  analysis worker outlives the CLI.
- `mcp` gives agents the same two things: open_binary gets a thinned slice,
  and every call has a deadline that kills REA's group. It boots the pinned
  local copy `install` puts down, not npx.

Commands:
  status [--json]                     what's installed and wired, offline, no REA call
  native <binary|App.app> [--deadline S]
  scope <App.app|app.asar|dir> <seed> [--max-files N] [--deadline S]
  wire [--apply]                      point the rea MCP entries at `chewbacca rea mcp`
  install                             pinned local copy of rea-agents, then wire
  mcp                                 the stdio MCP server agents launch: the pinned
                                      local REA behind a proxy that thins universal
                                      binaries and kills a call's whole group at its deadline
"""
import argparse
import hashlib
import json
import os
import platform
import plistlib
import re
import shutil
import signal
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional

PIN = os.environ.get("REA_PIN", "6.4.0")
HOME = Path(os.environ.get("HOME", "~")).expanduser()
CACHE = Path(os.environ.get("REA_KIT_CACHE", str(HOME / ".chewbacca" / "rea")))
CLAUDE_JSON = Path(os.environ.get("REA_KIT_CLAUDE_JSON", str(HOME / ".claude.json")))
CODEX_TOML = Path(os.environ.get("REA_KIT_CODEX_TOML", str(HOME / ".codex" / "config.toml")))
NPX_CACHE = Path(os.environ.get("REA_KIT_NPX_CACHE", str(HOME / ".npm" / "_npx")))
GHIDRA_GUESSES = (
    "/opt/homebrew/opt/ghidra/libexec",
    "/usr/local/opt/ghidra/libexec",
    "/opt/ghidra",
)
HOPPER = "/Applications/Hopper Disassembler.app/Contents/MacOS/hopper"
# The pinned copy agents boot. Through npx the MCP took 1.3 to 1.7 s to answer
# initialize with a warm cache and 4.0 s with a cold one, and needs the npm
# registry on a cold cache; this copy answered in 0.9 to 1.1 s (2026-10-13).
LOCAL = CACHE / "pkg" / PIN
LOCAL_SCRIPT = LOCAL / "node_modules" / "rea-agents" / "scripts" / "rea.mjs"
# REA's own floor (package.json engines): Node 22.19+, 24.11+ or 26+.
NODE_FLOOR = (22, 19)

# The Next.js chunks of one marketing site (1.6 MB, 39 files) ran 6 min 40 s
# under the 300 s per-source default and parsed 4 files before the deadline,
# so a scoped run caps each source at 60 s and returns partial Evidence instead.
SOURCE_TIMEOUT_MS = 60000
# A scoped Claude.app run is a handful of files; 8 caps it below the size at
# which the whole-app run stalled, and a seed matching more is too vague.
MAX_SCOPE_FILES = 8
# Bigger single files go to plain reading instead: Claude.app's 6.9 MB main
# chunk is where the whole-app run stalled, and one 1.6 MB set of web chunks
# timed out at file 4. Files above this are listed, never analyzed.
MAX_FILE_BYTES = 1_000_000


# ── detection ───────────────────────────────────────────────────────────────

def _run(cmd: List[str], timeout: float = 5) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def node_version() -> Optional[tuple]:
    out = _run(["node", "--version"])
    m = re.match(r"v(\d+)\.(\d+)", out)
    return (int(m.group(1)), int(m.group(2))) if m else None


def cached_versions() -> List[str]:
    found = set()
    for pj in NPX_CACHE.glob("*/node_modules/rea-agents/package.json"):
        try:
            found.add(str(json.loads(pj.read_text()).get("version")))
        except (OSError, ValueError):
            continue
    return sorted(found)


def claude_entry() -> Optional[dict]:
    try:
        entry = json.loads(CLAUDE_JSON.read_text()).get("mcpServers", {}).get("rea")
    except (OSError, ValueError):
        return None
    return entry if isinstance(entry, dict) else None


# The [mcp_servers.rea] table and its .env table the way people write them:
# bare or quoted name, trailing spaces or a comment, LF or CRLF.
CODEX_REA = re.compile(r'^\[mcp_servers\.(?:rea|"rea")\][ \t]*(?:#[^\n]*)?\r?\n(.*?)(?=^\[|\Z)', re.S | re.M)
CODEX_REA_ENV = re.compile(r'^\[mcp_servers\.(?:rea|"rea")\.env\][ \t]*(?:#[^\n]*)?\r?\n(.*?)(?=^\[|\Z)',
                           re.S | re.M)
# Any other spelling of a rea server (an inline table, a dotted key). wire
# leaves those alone rather than append a second table Codex refuses to load.
CODEX_REA_ANY = re.compile(r'''^\s*(?:\[mcp_servers\.["']?rea["']?[\].]|rea\s*=\s*\{|mcp_servers\.["']?rea["']?\.)''', re.M)


def codex_block() -> Optional[str]:
    try:
        text = CODEX_TOML.read_text()
    except OSError:
        return None
    m = CODEX_REA.search(text)
    if not m:
        return None
    env = CODEX_REA_ENV.search(text)
    return m.group(1) + (env.group(1) if env else "")

def ghidra_dir() -> Optional[str]:
    env = os.environ.get("GHIDRA_INSTALL_DIR")
    cands = [env] if env else []
    cands += list(GHIDRA_GUESSES)
    run = shutil.which("ghidraRun")
    if run:
        try:
            # Homebrew's ghidraRun is a two-line wrapper naming the real tree.
            m = re.search(r'exec "([^"]+)/ghidraRun"', Path(run).read_text(errors="ignore"))
            if m:
                cands.append(m.group(1))
        except OSError:
            pass
    for c in cands:
        if c and (Path(c) / "ghidraRun").exists() and (Path(c) / "support").is_dir():
            # Unresolved, so /opt/homebrew/opt survives a brew upgrade.
            return str(Path(c))
    return None


def java21_home() -> Optional[str]:
    env = os.environ.get("JAVA_HOME")
    if env and "21" in env and Path(env).is_dir():
        return env
    if platform.system() == "Darwin":
        out = _run(["/usr/libexec/java_home", "-v", "21"])
        if out and Path(out).is_dir():
            return out
    return None


def status() -> Dict:
    nv = node_version()
    entry = claude_entry()
    codex = codex_block()
    gdir = ghidra_dir()
    claude_env = (entry or {}).get("env") or {}
    pins = re.findall(r"rea-agents@([\w.\-]+)", json.dumps(entry or {}) + (codex or ""))
    s = {
        "node": ".".join(map(str, nv)) if nv else None,
        "node_ok": bool(nv and nv >= NODE_FLOOR),
        "cached": cached_versions(),
        "on_path": bool(shutil.which("rea")),
        "pin": PIN,
        "registered_pins": sorted(set(pins)),
        "claude_mcp": entry is not None,
        "codex_mcp": codex is not None,
        "ghidra": gdir,
        "java21": java21_home(),
        "hopper": Path(os.environ.get("HOPPER_LAUNCHER_PATH", HOPPER)).exists(),
        "ghidra_wired_claude": bool(claude_env.get("GHIDRA_INSTALL_DIR")),
        "ghidra_wired_codex": bool(codex and "GHIDRA_INSTALL_DIR" in codex),
        "local": local_version(),
        "proxied_claude": "rea_kit.py" in json.dumps(entry or {}),
        "proxied_codex": bool(codex and "rea_kit.py" in codex),
    }
    s["installed"] = bool(s["cached"] or s["on_path"] or s["local"] or s["claude_mcp"] or s["codex_mcp"])
    s["native_cli"] = bool(gdir and s["java21"]) or s["hopper"]
    # The proxy finds Ghidra itself at launch, so a proxied entry needs no env.
    wired = s["proxied_claude"] or s["ghidra_wired_claude"] or not s["claude_mcp"]
    s["native_mcp"] = s["hopper"] or bool(gdir and s["java21"] and wired)
    return s


def status_line(s: Dict) -> str:
    """One line for doctor. Information, never a failure: REA is optional."""
    if not s["installed"]:
        if not s["node_ok"]:
            return "REA: not installed (optional; needs Node 22.19+, this Mac has %s)" % (s["node"] or "no node")
        return "REA: not installed (optional; `chewbacca rea install` adds it for how-does-this-app-work questions)"
    where = [n for n, on in (("Claude Code", s["claude_mcp"]), ("Codex", s["codex_mcp"])) if on]
    ver = s["local"] or ",".join(s["registered_pins"] or s["cached"]) or "?"
    if s["hopper"]:
        native = "native via Hopper"
    elif s["ghidra"] and s["java21"]:
        if s["claude_mcp"] and not s["native_mcp"]:
            native = "native via Ghidra in `chewbacca rea native`; MCP needs `chewbacca rea wire --apply`"
        else:
            native = "native via Ghidra"
    else:
        native = "no native engine (brew install --cask ghidra temurin@21 to add one)"
    proxied = [on for on, there in ((s["proxied_claude"], s["claude_mcp"]), (s["proxied_codex"], s["codex_mcp"])) if there]
    boot = ("pinned, thinned, deadlined" if proxied and all(proxied)
            else "via npx; `chewbacca rea install` pins it" if proxied else "")
    return "REA %s: MCP in %s%s; JS/Electron static; %s" % (
        ver, ", ".join(where) or "no agent", " (%s)" % boot if boot else "", native)


# ── running REA with a deadline ─────────────────────────────────────────────

def local_version() -> Optional[str]:
    try:
        return str(json.loads((LOCAL_SCRIPT.parent.parent / "package.json").read_text()).get("version"))
    except (OSError, ValueError):
        return None


NODE_GUESSES = ("/opt/homebrew/bin/node", "/usr/local/bin/node")


def node_bin() -> str:
    """Absolute, because an agent launches the MCP with its own thin PATH: a
    Codex or Claude Desktop opened from the Dock usually lacks /opt/homebrew/bin.
    wire records the node it saw in the entry, which arrives as REA_KIT_NODE."""
    for c in (os.environ.get("REA_KIT_NODE"), shutil.which("node")) + NODE_GUESSES:
        if c and os.access(c, os.X_OK):
            return c
    return "node"

def rea_cmd() -> List[str]:
    if os.environ.get("REA_KIT_BIN"):
        return [os.environ["REA_KIT_BIN"]]
    if local_version() == PIN:
        return [node_bin(), str(LOCAL_SCRIPT)]
    return ["npx", "-y", "rea-agents@%s" % PIN]


def native_env() -> Dict[str, str]:
    env = {}
    g, j = ghidra_dir(), java21_home()
    if g:
        env["GHIDRA_INSTALL_DIR"] = g
    if j:
        env["JAVA_HOME"] = j
    return env


# How often REA's process tree is written down while it runs, so a JVM it
# orphans by exiting first is still known when the cleanup comes. Chosen, not
# measured; one ps of every process takes about 20 ms here.
SNAPSHOT_EVERY = float(os.environ.get("REA_KIT_SNAPSHOT", "2"))


def processes() -> List[tuple]:
    rows = []
    for line in _run(["ps", "-axww", "-o", "pid=,ppid=,pgid=,args="]).splitlines():
        parts = line.split(None, 3)
        if len(parts) >= 3 and all(x.isdigit() for x in parts[:3]):
            rows.append((int(parts[0]), int(parts[1]), int(parts[2]), parts[3] if len(parts) > 3 else ""))
    return rows


def descendants(group: int, rows: Optional[List[tuple]] = None) -> Dict[int, str]:
    """pid to command line for REA's group and everything descended from it."""
    rows = processes() if rows is None else rows
    kids: Dict[int, List[int]] = {}
    for pid, ppid, _, _ in rows:
        kids.setdefault(ppid, []).append(pid)
    seen = {pid for pid, _, pgid, _ in rows if pgid == group}
    todo = list(seen)
    while todo:
        for k in kids.get(todo.pop(), []):
            if k not in seen:
                seen.add(k)
                todo.append(k)
    return {pid: args for pid, _, _, args in rows if pid in seen}


def kill_tree(group: int, known: Optional[Dict[int, str]] = None) -> int:
    """SIGKILL REA's group, everything descended from it now, and every process
    in `known` still running the command line it was recorded with.

    The group alone is not enough: REA starts Ghidra's JVM as the leader of a
    group of its own, and after a group kill at a deadline that JVM kept
    analyzing Cardhop at full CPU, parented to init (2026-10-13). Descendants
    are read before anything dies. `known` covers a JVM that REA orphaned by
    exiting first, and the command-line match keeps a recycled pid out of it."""
    rows = processes()
    live = descendants(group, rows)
    now = {pid: args for pid, _, _, args in rows}
    for pid, args in (known or {}).items():
        if now.get(pid) == args:
            live[pid] = args
    pgid = {pid: g for pid, _, g, _ in rows}
    for g in {group} | {pid for pid in live if pgid.get(pid) == pid}:
        try:
            os.killpg(g, signal.SIGKILL)
        except OSError:
            pass
    for pid in set(live) - {os.getpid()}:
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
    return len(live)


def run_rea(args: List[str], out: Path, deadline: float, env: Optional[Dict] = None) -> Dict:
    """Run one REA command into `out`, in its own process group, and kill its
    whole tree at the deadline or after exit. The analysis worker outlives the
    CLI otherwise (two were still parented to init after a timed-out run)."""
    out.parent.mkdir(parents=True, exist_ok=True)
    full_env = dict(os.environ, **(env or {}))
    t0 = time.time()
    with open(out, "wb") as fo, open(str(out) + ".log", "wb") as fe:
        try:
            p = subprocess.Popen(rea_cmd() + args + ["--format", "json"], stdout=fo, stderr=fe,
                                 env=full_env, start_new_session=True)
        except OSError as e:
            return {"ok": False, "code": "rea_unavailable", "message": str(e), "seconds": 0.0}
        known: Dict[int, str] = {}
        timed_out, snap = False, 0.0
        while True:
            now = time.time()
            if now >= snap:
                known.update(descendants(p.pid))
                snap = now + SNAPSHOT_EVERY
            try:
                p.wait(timeout=min(0.5, max(0.01, t0 + deadline - now)))
                break
            except subprocess.TimeoutExpired:
                if time.time() >= t0 + deadline:
                    timed_out = True
                    break
        kill_tree(p.pid, known)
        p.wait()
    secs = round(time.time() - t0, 1)
    try:
        data = json.loads(out.read_text())
    except (OSError, ValueError):
        data = None
    if timed_out:
        return {"ok": False, "code": "deadline", "message": "no answer in %ss; scope it smaller" % int(deadline),
                "seconds": secs, "out": str(out)}
    if not isinstance(data, dict):
        return {"ok": False, "code": "no_output", "message": "REA printed no JSON; see %s.log" % out,
                "seconds": secs, "out": str(out)}
    if data.get("error"):
        return {"ok": False, "code": data.get("code"), "message": data.get("message"),
                "details": data.get("details"), "seconds": secs, "out": str(out)}
    return {"ok": True, "seconds": secs, "out": str(out), "evidence": data}

# ── native ──────────────────────────────────────────────────────────────────

def app_executable(path: Path) -> Path:
    if path.suffix == ".app" and path.is_dir():
        info = plistlib.loads((path / "Contents" / "Info.plist").read_bytes())
        return path / "Contents" / "MacOS" / str(info.get("CFBundleExecutable"))
    return path


# <mach/machine.h>. Read here instead of through lipo, which is a stub that
# pops the Command Line Tools installer on a Mac without them.
FAT_MAGIC, FAT_MAGIC_64 = 0xCAFEBABE, 0xCAFEBABF
CPU_NAMES = {(0x0100000C, 0): "arm64", (0x0100000C, 1): "arm64", (0x0100000C, 2): "arm64e",
             (0x01000007, 3): "x86_64", (0x01000007, 8): "x86_64h", (7, 3): "i386"}


def fat_slices(binary: Path) -> List[tuple]:
    """(arch, offset, size) per slice of a universal Mach-O, [] for anything
    else. Java class files share 0xCAFEBABE; their minor/major version reads
    as a count far above the handful of slices any real binary carries."""
    try:
        with open(binary, "rb") as f:
            head = f.read(8)
            if len(head) < 8:
                return []
            magic, n = struct.unpack(">II", head)
            if magic not in (FAT_MAGIC, FAT_MAGIC_64) or not 0 < n <= 16:
                return []
            wide = magic == FAT_MAGIC_64
            rec = 32 if wide else 20
            raw = f.read(rec * n)
    except OSError:
        return []
    out = []
    for i in range(n):
        chunk = raw[i * rec:(i + 1) * rec]
        if len(chunk) < rec:
            return []
        if wide:
            cpu, sub, off, size, _ = struct.unpack(">iiQQI", chunk[:28])
        else:
            cpu, sub, off, size, _ = struct.unpack(">iiIII", chunk)
        name = CPU_NAMES.get((cpu & 0xFFFFFFFF, sub & 0x00FFFFFF), "cpu%d-%d" % (cpu, sub & 0x00FFFFFF))
        out.append((name, off, size))
    return out


def archs(binary: Path) -> List[str]:
    return [a for a, _, _ in fat_slices(binary)]


def pick_arch(available: List[str], machine: Optional[str] = None) -> Optional[str]:
    """The slice Ghidra should read: the host's own, arm64e before arm64 since
    Apple's system binaries ship only arm64e for Apple Silicon."""
    machine = machine or platform.machine()
    order = ["arm64e", "arm64", "x86_64", "x86_64h"] if machine.startswith("arm") else ["x86_64", "x86_64h", "arm64", "arm64e"]
    for a in order:
        if a in available:
            return a
    return available[0] if available else None


def thin(binary: Path) -> Path:
    """The host's slice of a universal binary, cached; anything else as is. A
    slice is a complete Mach-O at its offset, which is all `lipo -thin` copies."""
    slices = fat_slices(binary)
    if len(slices) <= 1:
        return binary
    arch = pick_arch([a for a, _, _ in slices])
    _, off, size = next(x for x in slices if x[0] == arch)
    digest = hashlib.sha256(str(binary.resolve()).encode() + str(binary.stat().st_mtime).encode()).hexdigest()[:12]
    dest = CACHE / "thin" / ("%s-%s-%s" % (binary.name, arch, digest))
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".part%d" % os.getpid())
        with open(binary, "rb") as src, open(tmp, "wb") as out:
            src.seek(off)
            left = size
            while left:
                buf = src.read(min(left, 1 << 20))
                if not buf:
                    raise OSError("%s ends inside its %s slice" % (binary, arch))
                out.write(buf)
                left -= len(buf)
        os.chmod(tmp, 0o755)
        os.replace(tmp, dest)
    return dest


def native(target: str, deadline: float) -> Dict:
    s = status()
    path = app_executable(Path(target).expanduser())
    if not path.is_file():
        return {"ok": False, "code": "target_missing", "message": "no binary at %s" % path}
    if not s["native_cli"]:
        return {"ok": False, "code": "no_native_engine",
                "message": "no Ghidra 12.1 + JDK 21 or Hopper here (brew install --cask ghidra temurin@21)"}
    thinned = thin(path)
    env = native_env()
    out = CACHE / "runs" / ("native-%s-%d.json" % (thinned.name, int(time.time())))
    res = run_rea(["analyze", str(thinned)], out, deadline, env)
    res["target"] = str(thinned)
    if res.get("ok"):
        n = res.pop("evidence").get("normalized_result") or {}
        res["summary"] = {k: n.get(k) for k in ("segment_count", "procedure_count", "string_count")}
        res["next"] = ("over the rea MCP, open_binary on %s reuses one import; "
                       "`chewbacca rea wire --apply` first if the MCP says provider_unavailable" % target)
    return res


# ── scope ───────────────────────────────────────────────────────────────────

def asar_of(target: Path) -> Optional[Path]:
    if target.suffix == ".asar":
        return target
    cand = target / "Contents" / "Resources" / "app.asar"
    return cand if cand.exists() else None


def extract(asar: Path) -> Path:
    st = asar.stat()
    key = hashlib.sha256(("%s|%d|%d" % (asar.resolve(), st.st_size, int(st.st_mtime))).encode()).hexdigest()[:12]
    dest = CACHE / "asar" / ("%s-%s" % (asar.parent.parent.parent.name or asar.stem, key))
    if not (dest / ".done").exists():
        shutil.rmtree(dest, ignore_errors=True)
        dest.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["npx", "-y", "@electron/asar", "extract", str(asar), str(dest)], check=True,
                       capture_output=True, timeout=600)
        (dest / ".done").write_text("")
    return dest


def find_seed(root: Path, seed: str, limit: int) -> List[Path]:
    """Files holding the seed, smallest first, then every preload: the bridge
    REA pairs channels across. node_modules is skipped (vendored code)."""
    hits, preloads = [], []
    needle = seed.encode()
    for dirpath, dirnames, files in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != "node_modules"]
        for f in files:
            if not f.endswith((".js", ".cjs", ".mjs")):
                continue
            p = Path(dirpath) / f
            if "preload" in f.lower():
                preloads.append(p)
            try:
                if needle in p.read_bytes():
                    hits.append(p)
            except OSError:
                continue
    hits.sort(key=lambda p: p.stat().st_size)
    chosen = [p for p in hits if p.stat().st_size <= MAX_FILE_BYTES][:limit]
    for p in preloads:
        if p not in chosen and len(chosen) < limit + 2 and p.stat().st_size <= MAX_FILE_BYTES:
            chosen.append(p)
    return chosen


def too_big(root: Path, seed: str) -> List[str]:
    needle = seed.encode()
    out = []
    for dirpath, dirnames, files in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != "node_modules"]
        for f in files:
            p = Path(dirpath) / f
            if f.endswith((".js", ".cjs", ".mjs")) and p.stat().st_size > MAX_FILE_BYTES:
                try:
                    if needle in p.read_bytes():
                        out.append(str(p))
                except OSError:
                    continue
    return out


def scope(target: str, seed: str, limit: int, deadline: float) -> Dict:
    t = Path(target).expanduser()
    asar = asar_of(t)
    if asar:
        root = extract(asar)
    elif t.is_dir():
        root = t
    else:
        return {"ok": False, "code": "target_missing", "message": "no app.asar or directory at %s" % t}
    files = find_seed(root, seed, limit)
    hits = [f for f in files if seed.encode() in f.read_bytes()]
    large = too_big(root, seed)
    if not hits:
        if large:
            return {"ok": False, "code": "only_large_files", "read_these": large,
                    "message": "%r is only in files over %d bytes, which REA stalls on; grep and read them" % (seed, MAX_FILE_BYTES)}
        return {"ok": False, "code": "seed_not_found", "message": "%r appears in no JS file under %s" % (seed, root)}
    slug = re.sub(r"[^A-Za-z0-9]+", "-", seed)[:24].strip("-") or "seed"
    sdir = CACHE / "scoped" / ("%s-%s" % (root.name, slug))
    shutil.rmtree(sdir, ignore_errors=True)
    for f in files:
        dest = sdir / f.relative_to(root)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dest)
    pkg = root / "package.json"
    if pkg.exists():
        shutil.copy2(pkg, sdir / "package.json")
    else:
        (sdir / "package.json").write_text('{"name":"scoped","main":"%s"}' % files[0].relative_to(root))
    out = CACHE / "runs" / ("scope-%s-%d.json" % (sdir.name, int(time.time())))
    res = run_rea(["analyze-javascript-application", str(sdir), "--artifact-format", "directory",
                   "--analysis-timeout-ms", str(SOURCE_TIMEOUT_MS)], out, deadline)
    res["scoped_dir"] = str(sdir)
    res["files"] = [str(f.relative_to(root)) for f in files]
    res["seed_hits"] = [str(f.relative_to(root)) for f in hits]
    res["read_these"] = large
    if res.get("ok"):
        ev = res.pop("evidence")
        res["summary"] = summarize_js(ev)
    return res


def summarize_js(ev: Dict) -> Dict:
    """The counts worth reading. The full Evidence stays on disk: two files of
    Claude.app came back as 41 MB, which no context should swallow."""
    n = ev.get("normalized_result") or {}
    out = dict(n.get("summary") or {})
    stats = n.get("statistics") or {}
    for k in ("parsed_javascript_files", "parse_failures", "findings"):
        if k in stats:
            out[k] = stats[k]
    sem = n.get("semantic_graph") or {}
    if isinstance(sem.get("unknowns"), list):
        out["unknowns"] = len(sem["unknowns"])
    return out


# ── mcp: the server agents launch ───────────────────────────────────────────

# open_binary is the one native tool that takes a path: of rea-agents 6.4.0's
# 170 tools, binary_overview, list_procedures and the rest read the session it
# opened. Through the bare MCP, open_binary on universal /usr/bin/uuidgen
# answered ok in 0.13 s and the next binary_overview failed with Ghidra's
# architecture_unsupported (2026-10-13), so the rewrite has to happen here.
THIN_ARGS = {"open_binary": "path"}
# Ghidra's first import of Cardhop's thinned 4 MB slice took 253 s through the
# CLI (2026-10-12); 900 s leaves 3.5x that before a call's group is killed.
CALL_DEADLINE = float(os.environ.get("REA_KIT_CALL_DEADLINE", "900"))
# A cancelled call gets this long to stop by itself. REA's JS analysis ignores
# cancellation (andrew.ooo review, 2026-10-10), and its worker keeps grinding.
CANCEL_GRACE = float(os.environ.get("REA_KIT_CANCEL_GRACE", "30"))
REINIT_ID = "chewbacca-rea-reinit"
# Chosen, not measured. How often the reaper checks REA's group still exists,
# so it exits within this long of REA ending; a SIGKILLed proxy wakes it at
# once through the pipe.
REAP_POLL = 2.0


def reap(fd: int, group: int) -> int:
    """Outlives a SIGKILLed proxy to take REA down with kill_tree. It learns of
    the death from EOF on a pipe only the proxy holds (a zombie proxy still
    answers kill 0), and quits as soon as REA's group is empty, so it never
    holds on to a group id the system could hand to someone else."""
    import select
    known: Dict[int, str] = {}
    while True:
        try:
            os.killpg(group, 0)
        except OSError:
            return 0
        known.update(descendants(group))
        if select.select([fd], [], [], REAP_POLL)[0] and not os.read(fd, 1):
            kill_tree(group, known)
            return 0


def thin_target(path: str) -> str:
    """What Ghidra can import for `path`: an app bundle's executable, and the
    host's slice of a universal binary. Anything else is returned untouched."""
    try:
        p = app_executable(Path(path))
        if not p.is_file():
            return path
        if len(fat_slices(p)) > 1:
            return str(thin(p))
        return str(p) if p != Path(path) else path
    except (OSError, ValueError, KeyError, StopIteration):
        return path


# How long a restarted REA gets to answer the replayed initialize before the
# call goes ahead anyway. It answered in 0.9 to 1.1 s from the pinned copy and
# 4.0 s through a cold npx (2026-10-13); Codex gives a server 30 s to start.
INIT_WAIT = 30.0


def trackable(rid) -> bool:
    return isinstance(rid, (str, int)) and not isinstance(rid, bool)


class Proxy:
    """stdio MCP between one agent and one REA server. The invariant it owns:
    no REA call outlives its deadline, and nothing REA started outlives the
    agent. A call past its deadline, or past CANCEL_GRACE after the agent
    cancelled it, kills REA's whole tree and answers every open call with an
    error; the next request starts REA again and replays initialize first.

    klock guards the child, its known processes and the open calls, so a kill
    and a respawn can never interleave."""

    def __init__(self, cmd: List[str], env: Dict[str, str], out=None, deadline: float = CALL_DEADLINE):
        self.cmd, self.env, self.deadline = cmd, env, deadline
        self.out = out or sys.stdout.buffer
        self.child = None  # (REA, its reaper, the reaper's lifeline fd)
        self.known: Dict[int, str] = {}
        self.init = None
        self.inflight = {}  # request id -> (monotonic deadline, method)
        self.klock = threading.RLock()
        self.wlock = threading.Lock()
        self.reinit = threading.Event()
        self.done = False
        self.kills = 0

    def emit(self, msg: Dict) -> None:
        self.write(json.dumps(msg).encode() + b"\n")

    def write(self, line: bytes) -> None:
        with self.wlock:
            try:
                self.out.write(line if line.endswith(b"\n") else line + b"\n")
                self.out.flush()
            except (BrokenPipeError, ValueError):
                pass  # the agent hung up; serve's finally still kills REA

    @staticmethod
    def send(proc, msg) -> None:
        line = msg if isinstance(msg, bytes) else json.dumps(msg).encode()
        proc.stdin.write(line if line.endswith(b"\n") else line + b"\n")
        proc.stdin.flush()

    def spawn(self) -> None:
        """Start REA and its reaper. Callers hold klock."""
        proc = subprocess.Popen(self.cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                env=dict(os.environ, **self.env), start_new_session=True)
        rfd, lifeline = os.pipe()
        try:
            reaper = subprocess.Popen([python_bin(), str(Path(__file__).resolve()), "reap", str(rfd),
                                       str(proc.pid)], pass_fds=(rfd,), start_new_session=True,
                                      stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                      stderr=subprocess.DEVNULL)
        except OSError:
            os.close(lifeline)
            kill_tree(proc.pid)
            proc.wait()
            raise
        finally:
            os.close(rfd)
        self.child, self.known = (proc, reaper, lifeline), {}
        threading.Thread(target=self.pump, args=(proc,), daemon=True).start()
        if self.init is not None:
            self.reinit.clear()
            self.send(proc, dict(self.init, id=REINIT_ID))
            # MCP has a client wait for initialize's answer before anything else.
            self.reinit.wait(INIT_WAIT)
            self.send(proc, {"jsonrpc": "2.0", "method": "notifications/initialized"})

    def kill(self, why: str, only=None) -> None:
        with self.klock:
            if self.child is None or (only is not None and self.child[0] is not only):
                return
            proc, reaper, lifeline = self.child
            self.child = None
            self.kills += 1
            kill_tree(proc.pid, self.known)
            proc.wait()
            reaper.kill()
            reaper.wait()
            os.close(lifeline)
            open_ids, self.inflight = list(self.inflight), {}
        for rid in open_ids:
            self.emit({"jsonrpc": "2.0", "id": rid, "error": {"code": -32001, "message": why}})

    def pump(self, proc) -> None:
        for line in iter(proc.stdout.readline, b""):
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            answer = isinstance(msg, dict) and "method" not in msg and "id" in msg
            if answer and msg["id"] == REINIT_ID:
                self.reinit.set()
                continue
            with self.klock:
                if self.child is None or self.child[0] is not proc:
                    continue  # a killed REA's late answer; its caller already has an error
                if answer and trackable(msg["id"]):
                    self.inflight.pop(msg["id"], None)
            self.write(line)
        if not self.done:
            # REA exited by itself mid-session (upstream #2269 kills the server
            # on one bad path); the open calls would otherwise hang forever.
            self.kill("REA exited; the next call starts it again", only=proc)

    def watch(self) -> None:
        snap = 0.0
        while not self.done:
            time.sleep(0.5)
            now = time.monotonic()
            with self.klock:
                proc = self.child[0] if self.child else None
                if proc is not None and now >= snap:
                    self.known.update(descendants(proc.pid))
                    snap = now + SNAPSHOT_EVERY
                late = [m for dl, m in self.inflight.values() if now >= dl]
            if proc is not None and proc.poll() is not None:
                # REA gone while something it started still holds its stdout
                # open, so pump never sees the end of the stream.
                self.kill("REA exited; the next call starts it again", only=proc)
            elif late:
                self.kill("REA %s passed its deadline; its process tree was killed. Scope the "
                          "question smaller" % late[0])

    def rewrite(self, msg: Dict) -> Dict:
        params = msg.get("params") or {}
        key = THIN_ARGS.get(params.get("name"))
        args = params.get("arguments") or {}
        if key and isinstance(args.get(key), str):
            new = thin_target(args[key])
            if new != args[key]:
                msg = dict(msg, params=dict(params, arguments=dict(args, **{key: new})))
        return msg

    def handle(self, line: bytes) -> None:
        try:
            msg = json.loads(line)
        except ValueError:
            msg = None
        method = msg.get("method") if isinstance(msg, dict) else None
        request = method is not None and trackable(msg.get("id"))
        if method == "tools/call":
            msg = self.rewrite(msg)
        if isinstance(msg, dict):
            line = json.dumps(msg).encode()
        with self.klock:
            if self.child is None:
                if not request:
                    # A notification or answer for an REA that is gone, such as
                    # the cancel an agent sends after a deadline error, would
                    # otherwise boot a fresh REA for nothing.
                    return
                try:
                    self.spawn()
                except OSError as e:
                    self.emit({"jsonrpc": "2.0", "id": msg["id"],
                               "error": {"code": -32002, "message": "REA could not start: %s" % e}})
                    return
            if method == "initialize":
                self.init = msg
            if request:
                self.inflight[msg["id"]] = (time.monotonic() + self.deadline, method)
            if method == "notifications/cancelled":
                rid = (msg.get("params") or {}).get("requestId")
                if trackable(rid) and rid in self.inflight:
                    dl, m = self.inflight[rid]
                    self.inflight[rid] = (min(dl, time.monotonic() + CANCEL_GRACE), m)
            proc = self.child[0]
            try:
                self.send(proc, line)
            except OSError:
                self.kill("REA exited; the next call starts it again", only=proc)

    def serve(self, inp=None) -> int:
        inp = inp or sys.stdin.buffer
        if threading.current_thread() is threading.main_thread():
            # An agent stops its MCP servers with SIGTERM; the finally below
            # then takes REA's tree down with it.
            for sig in (signal.SIGTERM, signal.SIGHUP):
                signal.signal(sig, lambda *_: sys.exit(0))
        threading.Thread(target=self.watch, daemon=True).start()
        try:
            for line in iter(inp.readline, b""):
                if line.strip():
                    self.handle(line)
        finally:
            self.done = True
            self.kill("agent closed the connection")
        return 0

def mcp() -> int:
    return Proxy(rea_cmd() + ["mcp"], native_env()).serve()


# ── wire and install ────────────────────────────────────────────────────────

def stable_tool() -> Path:
    """This file by a path that survives a kit update: a snapshot under
    ~/.chewbacca/kit/snapshots/<sha> is pruned, `current` always points at one."""
    here = Path(__file__).resolve()
    root = here.parent.parent
    if root.parent.name == "snapshots" and (root.parent.parent / "current" / "tools" / here.name).exists():
        return root.parent.parent / "current" / "tools" / here.name
    return here


def python_bin() -> str:
    # The proxy is 3.9-clean, so macOS's own interpreter runs it on any Mac.
    return "/usr/bin/python3" if Path("/usr/bin/python3").exists() else (shutil.which("python3") or "python3")


# Codex ends a tool call at 60 s unless the entry says otherwise, and Ghidra's
# Cardhop import took 266 s; a minute past the proxy's own deadline lets the
# proxy's error, not Codex's, end a long call.
TOOL_TIMEOUT = int(CALL_DEADLINE) + 60


def mcp_entry() -> Dict:
    return {"command": python_bin(), "args": [str(stable_tool()), "mcp", "--node", node_bin()]}


def codex_rewrite(text: str, entry: Dict) -> str:
    """The rea table pointed at the proxy: command and args replaced,
    tool_timeout_sec raised to TOOL_TIMEOUT, every other key, the .env table
    and every other table byte for byte. Raises ValueError on a rea entry in a
    form this can't edit, and never returns a file with two rea tables."""
    cmd = "command = %s" % json.dumps(entry["command"])
    args = "args = [ %s ]" % ", ".join(json.dumps(a) for a in entry["args"])
    m = CODEX_REA.search(text)
    if not m:
        if CODEX_REA_ANY.search(text):
            raise ValueError("rea is declared in a form wire can't edit safely; point it at %s by hand"
                             % entry["args"][0])
        return text.rstrip("\n") + "\n\n[mcp_servers.rea]\n%s\n%s\ntool_timeout_sec = %d\n" % (
            cmd, args, TOOL_TIMEOUT)
    nl = "\r\n" if m.group(0).find("\r\n") >= 0 else "\n"
    body = m.group(1)
    body = re.sub(r"^args\s*=\s*\[.*?\][ \t]*\r?\n", "", body, flags=re.S | re.M)
    body = re.sub(r"^command\s*=.*\r?\n", "", body, flags=re.M)
    old = re.search(r"^tool_timeout_sec\s*=\s*(\d+)", body, re.M)
    body = re.sub(r"^tool_timeout_sec\s*=.*\r?\n", "", body, flags=re.M)
    timeout = max(TOOL_TIMEOUT, int(old.group(1)) if old else 0)
    head = m.group(0)[:len(m.group(0)) - len(m.group(1))]
    lines = nl.join([cmd, args, "tool_timeout_sec = %d" % timeout]) + nl
    out = text[:m.start()] + head + lines + body + text[m.end():]
    if len(CODEX_REA.findall(out)) != 1:
        raise ValueError("rewrite would leave %d rea tables" % len(CODEX_REA.findall(out)))
    return out

def claude_bin() -> Optional[str]:
    # REA_KIT_CLAUDE="" means no Claude Code CLI, so a test can never rewrite
    # a real ~/.claude.json through it.
    if "REA_KIT_CLAUDE" in os.environ:
        return os.environ["REA_KIT_CLAUDE"] or None
    return shutil.which("claude")


def wire(apply: bool, add: bool = False) -> Dict:
    """Point the agents' rea MCP at the proxy. With `add`, register it where
    no entry exists yet (install does; a plain wire only fixes existing ones)."""
    s = status()
    entry = mcp_entry()
    plan = []
    claude = claude_bin()
    if claude and ((s["claude_mcp"] and not s["proxied_claude"]) or (add and not s["claude_mcp"])):
        plan.append("claude")
    if (s["codex_mcp"] and not s["proxied_codex"]) or (add and not s["codex_mcp"] and CODEX_TOML.exists()):
        plan.append("codex")
    if not plan:
        return {"ok": True, "message": "already wired, or no rea MCP entry to wire", "entry": entry}
    if not apply:
        return {"ok": True, "message": "would wire %s; rerun with --apply" % ", ".join(plan), "entry": entry}
    done = []
    for who in plan:
        if who == "claude":
            # Through the CLI, never a hand edit: Claude Code rewrites
            # ~/.claude.json while it runs, and a concurrent write loses one.
            # remove + add would drop the entry's env, so it rides along.
            mine = dict(entry, env=(claude_entry() or {}).get("env") or {})
            subprocess.run([claude, "mcp", "remove", "rea", "-s", "user"], capture_output=True)
            r = subprocess.run([claude, "mcp", "add-json", "rea", json.dumps(mine), "-s", "user"],
                               capture_output=True, text=True)
            done.append("claude" if r.returncode == 0 else "claude FAILED: %s" % r.stderr.strip()[:200])
        else:
            text = CODEX_TOML.read_text()
            try:
                new = codex_rewrite(text, entry)
            except ValueError as e:
                done.append("codex SKIPPED: %s" % e)
                continue
            shutil.copy2(CODEX_TOML, str(CODEX_TOML) + ".bak-rea")
            CODEX_TOML.write_text(new)
            done.append("codex")
    return {"ok": True, "wired": done, "entry": entry,
            "message": "new agent sessions start REA through the proxy; running ones keep theirs"}


def install(deadline: float = 600) -> Dict:
    if not status()["node_ok"]:
        return {"ok": False, "message": "REA needs Node 22.19+; this Mac has %s" % (
            ".".join(map(str, node_version() or ())) or "no node")}
    if local_version() != PIN:
        LOCAL.mkdir(parents=True, exist_ok=True)
        npm = shutil.which("npm") or "npm"
        try:
            # --save-exact pins rea-agents itself, which lists breaking
            # changes in every 6.x minor; npm's lockfile records its
            # dependencies as they resolved on the day of the install.
            r = subprocess.run([npm, "install", "--prefix", str(LOCAL), "--save-exact", "--no-audit",
                                "--no-fund", "--loglevel=error", "rea-agents@%s" % PIN],
                               capture_output=True, text=True, timeout=deadline)
        except (OSError, subprocess.TimeoutExpired) as e:
            return {"ok": False, "message": "npm install failed: %s" % e}
        if local_version() != PIN:
            return {"ok": False, "message": "npm install failed: %s" % (r.stderr.strip()[-300:] or r.returncode)}
    res = wire(apply=True, add=True)
    res["local"] = str(LOCAL_SCRIPT)
    return res


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="chewbacca rea", description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd")
    p = sub.add_parser("status")
    p.add_argument("--json", action="store_true")
    p.add_argument("--line", action="store_true", help="the one-line doctor summary")
    p = sub.add_parser("native")
    p.add_argument("target")
    p.add_argument("--deadline", type=float, default=300)
    p = sub.add_parser("scope")
    p.add_argument("target")
    p.add_argument("seed")
    p.add_argument("--max-files", type=int, default=MAX_SCOPE_FILES)
    p.add_argument("--deadline", type=float, default=300)
    p = sub.add_parser("wire")
    p.add_argument("--apply", action="store_true")
    sub.add_parser("install")
    p = sub.add_parser("mcp")
    p.add_argument("--node", help="the node wire saw, for agents launched with a thin PATH")
    p = sub.add_parser("reap")  # started by the mcp proxy, never by hand
    p.add_argument("fd", type=int)
    p.add_argument("group", type=int)
    a = ap.parse_args(argv)
    if a.cmd == "mcp":
        if a.node:
            os.environ["REA_KIT_NODE"] = a.node
        return mcp()
    if a.cmd == "reap":
        return reap(a.fd, a.group)

    if a.cmd in (None, "status"):
        s = status()
        if getattr(a, "line", False):
            print(status_line(s))
        elif getattr(a, "json", False):
            print(json.dumps(s, indent=1))
        else:
            print(status_line(s))
            for k, v in s.items():
                print("  %-20s %s" % (k, v))
        return 0
    if a.cmd == "install":
        res = install()
    elif a.cmd == "wire":
        res = wire(a.apply)
    elif a.cmd == "native":
        res = native(a.target, a.deadline)
    else:
        res = scope(a.target, a.seed, a.max_files, a.deadline)
    print(json.dumps(res, indent=1, default=str))
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
