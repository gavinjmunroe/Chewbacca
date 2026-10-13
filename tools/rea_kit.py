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

Commands:
  status [--json]                     what's installed and wired, offline, no REA call
  native <binary|App.app> [--deadline S]
  scope <App.app|app.asar|dir> <seed> [--max-files N] [--deadline S]
  wire [--apply]                      add the Ghidra env to the rea MCP entries
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
import subprocess
import sys
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


def codex_block() -> Optional[str]:
    try:
        text = CODEX_TOML.read_text()
    except OSError:
        return None
    m = re.search(r"^\[mcp_servers\.rea\]\n(.*?)(?=^\[|\Z)", text, re.S | re.M)
    if not m:
        return None
    # The env table lives in its own header, [mcp_servers.rea.env].
    env = re.search(r"^\[mcp_servers\.rea\.env\]\n(.*?)(?=^\[|\Z)", text, re.S | re.M)
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
    }
    s["installed"] = bool(s["cached"] or s["on_path"] or s["claude_mcp"] or s["codex_mcp"])
    s["native_cli"] = bool(gdir and s["java21"]) or s["hopper"]
    s["native_mcp"] = s["hopper"] or bool(gdir and s["java21"] and (s["ghidra_wired_claude"] or not s["claude_mcp"]))
    return s


def status_line(s: Dict) -> str:
    """One line for doctor. Information, never a failure: REA is optional."""
    if not s["installed"]:
        if not s["node_ok"]:
            return "REA: not installed (optional; needs Node 22.19+, this Mac has %s)" % (s["node"] or "no node")
        return "REA: not installed (optional; `chewbacca rea install` adds it for how-does-this-app-work questions)"
    where = [n for n, on in (("Claude Code", s["claude_mcp"]), ("Codex", s["codex_mcp"])) if on]
    ver = ",".join(s["registered_pins"] or s["cached"]) or "?"
    if s["hopper"]:
        native = "native via Hopper"
    elif s["ghidra"] and s["java21"]:
        if s["claude_mcp"] and not s["ghidra_wired_claude"]:
            native = "native via Ghidra in `chewbacca rea native`; MCP needs `chewbacca rea wire --apply`"
        else:
            native = "native via Ghidra"
    else:
        native = "no native engine (brew install --cask ghidra temurin@21 to add one)"
    return "REA %s: MCP in %s; JS/Electron static; %s" % (ver, ", ".join(where) or "no agent", native)


# ── running REA with a deadline ─────────────────────────────────────────────

def rea_cmd() -> List[str]:
    if os.environ.get("REA_KIT_BIN"):
        return [os.environ["REA_KIT_BIN"]]
    return ["npx", "-y", "rea-agents@%s" % PIN]


def run_rea(args: List[str], out: Path, deadline: float, env: Optional[Dict] = None) -> Dict:
    """Run one REA command into `out`, in its own process group, and kill the
    whole group at the deadline or after exit. The analysis worker outlives the
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
        timed_out = False
        try:
            p.wait(timeout=deadline)
        except subprocess.TimeoutExpired:
            timed_out = True
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
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


def archs(binary: Path) -> List[str]:
    return _run(["lipo", "-archs", str(binary)]).split()


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
    avail = archs(binary)
    if len(avail) <= 1:
        return binary
    arch = pick_arch(avail)
    digest = hashlib.sha256(str(binary.resolve()).encode() + str(binary.stat().st_mtime).encode()).hexdigest()[:12]
    dest = CACHE / "thin" / ("%s-%s-%s" % (binary.name, arch, digest))
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["lipo", str(binary), "-thin", str(arch), "-output", str(dest)], check=True,
                       capture_output=True)
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
    env = {}
    if s["ghidra"]:
        env["GHIDRA_INSTALL_DIR"] = s["ghidra"]
    if s["java21"]:
        env["JAVA_HOME"] = s["java21"]
    out = CACHE / "runs" / ("native-%s-%d.json" % (thinned.name, int(time.time())))
    res = run_rea(["analyze", str(thinned)], out, deadline, env)
    res["target"] = str(thinned)
    if res.get("ok"):
        n = res.pop("evidence").get("normalized_result") or {}
        res["summary"] = {k: n.get(k) for k in ("segment_count", "procedure_count", "string_count")}
        res["next"] = ("open_binary on %s over the rea MCP reuses one import; "
                       "`chewbacca rea wire --apply` first if the MCP says provider_missing" % thinned)
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


# ── wire ────────────────────────────────────────────────────────────────────

def wire(apply: bool) -> Dict:
    s = status()
    if not (s["ghidra"] and s["java21"]):
        return {"ok": False, "message": "no Ghidra 12.1 + JDK 21 to wire (brew install --cask ghidra temurin@21)"}
    env = {"GHIDRA_INSTALL_DIR": s["ghidra"], "JAVA_HOME": s["java21"]}
    plan = []
    if s["claude_mcp"] and not s["ghidra_wired_claude"]:
        entry = dict(claude_entry() or {})
        entry["env"] = dict(entry.get("env") or {}, **env)
        plan.append(("claude", entry))
    if s["codex_mcp"] and not s["ghidra_wired_codex"]:
        plan.append(("codex", env))
    if not plan:
        return {"ok": True, "message": "already wired, or no rea MCP entry to wire", "env": env}
    if not apply:
        return {"ok": True, "message": "would wire %s; rerun with --apply" % ", ".join(p[0] for p in plan),
                "env": env}
    done = []
    for who, payload in plan:
        if who == "claude":
            # Through the CLI, never a hand edit: Claude Code rewrites
            # ~/.claude.json while it runs, and a concurrent write loses one.
            if shutil.which("claude"):
                subprocess.run(["claude", "mcp", "remove", "rea", "-s", "user"], capture_output=True)
                r = subprocess.run(["claude", "mcp", "add-json", "rea", json.dumps(payload), "-s", "user"],
                                   capture_output=True, text=True)
                done.append("claude" if r.returncode == 0 else "claude FAILED: %s" % r.stderr.strip()[:200])
        else:
            text = CODEX_TOML.read_text()
            block = "\n[mcp_servers.rea.env]\n" + "".join('%s = "%s"\n' % kv for kv in sorted(payload.items()))
            m = re.search(r"^\[mcp_servers\.rea\]\n.*?(?=^\[|\Z)", text, re.S | re.M)
            if m and "[mcp_servers.rea.env]" not in text:
                end = m.end()
                text = text[:end].rstrip("\n") + "\n" + block + ("\n" if end < len(text) else "") + text[end:]
                shutil.copy2(CODEX_TOML, str(CODEX_TOML) + ".bak-rea")
                CODEX_TOML.write_text(text)
                done.append("codex")
    return {"ok": True, "wired": done, "env": env, "message": "restart the agent for the MCP to pick it up"}


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
    a = ap.parse_args(argv)

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
        if not status()["node_ok"]:
            print("REA needs Node 22.19+; this Mac has %s" % (node_version() or "no node"), file=sys.stderr)
            return 1
        # Upstream's own setup shows its plan and asks before it writes anything.
        return subprocess.call(["npx", "-y", "rea-agents@%s" % PIN, "setup"])
    if a.cmd == "wire":
        res = wire(a.apply)
    elif a.cmd == "native":
        res = native(a.target, a.deadline)
    else:
        res = scope(a.target, a.seed, a.max_files, a.deadline)
    print(json.dumps(res, indent=1, default=str))
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
