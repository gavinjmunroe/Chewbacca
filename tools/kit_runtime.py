#!/usr/bin/env python3
"""Run the kit's PATH tools from a clean copy of origin/main that no agent edits.

Every tool in ~/.local/bin used to be a symlink into the shared checkout,
~/code/chewbacca, and that checkout is where every agent tab keeps its
uncommitted edits. So it almost never fast-forwards: on 2026-10-10 13:17 local
main was 2 commits ahead of rebased copies already on origin, `git reset --keep
origin/main` refused because another tab had edits in a file that also changed
upstream, and the installed `chewbacca clay` was a version that still refused
writes main had allowed since 19539ff1. Caleb kept getting handed commands
because the tools on PATH were whatever the dirty tree happened to hold.

So the tools run from a runtime nobody edits:

  ~/.chewbacca/kit/
    current -> snapshots/<sha>      the one path ~/.local/bin links through
    snapshots/<sha>/                a detached git worktree of origin/main
    snapshots/<sha>.kit-runtime.json  sidecar: sha, source checkout, build time

`update` fetches origin/main, builds a snapshot for its commit if there is not
one, then swaps `current` with a rename, which is atomic: a tool that already
resolved its path keeps reading its own snapshot to the end of its run, and
the next run gets the new one. Old snapshots are kept (KEEP) so a run that
started two updates ago still finds its files, then removed.

Gitignored state that lives in the source checkout (node_modules, hud/build,
superassistant/questions.jsonl) is symlinked into each snapshot, so a tool that
reads or appends to a path beside itself reaches the same file it always did.

`status` reports the runtime's commit against origin/main. `install-timer`
writes the launchd job that runs `update` between sessions. Runs on the stock
/usr/bin/python3 (3.9), which is what launchd and the hooks have.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import List, Optional

SIDECAR = ".kit-runtime.json"
REF = "origin/main"
LABEL = "com.chewbacca.kit-runtime"
# Three: the current snapshot, the one before it, and one more. Updates run at
# most every few minutes, so a snapshot is only removed once two newer ones
# exist, long after any tool that started on it has exited. Guessed, never
# measured: no tool run has been observed to span two updates.
KEEP = 3
# Gitignored paths in the source checkout that are NOT state a tool reads:
# other tabs' worktrees, caches, test scratch. Everything else ignored is
# linked in, because a build output or a log beside a tool is the tool's.
SKIP_PREFIXES = (".claude/", ".worktrees/", ".git/", ".pytest_cache/", ".playwright-mcp/", "tests/")
SKIP_PARTS = ("__pycache__", ".DS_Store")


def runtime_base() -> Path:
    return Path(os.environ.get("CHEWBACCA_KIT_RUNTIME") or Path.home() / ".chewbacca" / "kit")


def git(repo: Path, *args: str, timeout: int = 60) -> subprocess.CompletedProcess:
    # hooksPath off: `worktree add` runs post-checkout, and the shared repo's
    # hooks are for people committing, not for a runtime copy appearing.
    return subprocess.run(
        ["git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-C", str(repo), *args],
        capture_output=True, text=True, timeout=timeout)


def read_sidecar(snap: Path) -> Optional[dict]:
    try:
        return json.loads(Path(str(snap) + SIDECAR).read_text())
    except (OSError, ValueError):
        return None


def find_source(explicit: Optional[str]) -> Optional[Path]:
    """The git checkout the runtime is built from: the user's own clone."""
    candidates: List[str] = []
    if explicit:
        candidates.append(explicit)
    if os.environ.get("CHEWBACCA_REPO_DIR"):
        candidates.append(os.environ["CHEWBACCA_REPO_DIR"])
    config = Path.home() / ".claude" / "d1-config.sh"
    try:
        for line in config.read_text().splitlines():
            if line.startswith("CHEWBACCA_REPO_DIR="):
                candidates.append(line.split("=", 1)[1].strip().strip('"').strip("'"))
    except OSError:
        pass
    try:
        repo = json.loads((Path.home() / ".chewbacca" / "install-manifest.json").read_text()).get("repo")
        if repo:
            candidates.append(repo)
    except (OSError, ValueError):
        pass
    # Run from inside a snapshot: its sidecar names the source.
    here = Path(globals().get("__file__") or "tools/x").resolve().parents[1]
    side = read_sidecar(here)
    if side and side.get("source"):
        candidates.append(side["source"])
    candidates.append(str(here))
    for c in candidates:
        p = Path(os.path.expanduser(c))
        if (p / ".git").exists() and read_sidecar(p.resolve()) is None:
            return p
    return None


def current_sha(base: Path) -> Optional[str]:
    cur = base / "current"
    if not cur.is_symlink():
        return None
    side = read_sidecar(cur.resolve())
    return side.get("sha") if side else None


def ref_sha(source: Path, ref: str) -> Optional[str]:
    r = git(source, "rev-parse", "--verify", "--quiet", ref + "^{commit}")
    return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else None


class Lock:
    """One updater at a time; a second waits briefly, then gives up quietly."""

    def __init__(self, path: Path, wait: float = 25.0):
        self.path, self.wait, self.fd = path, wait, None

    def __enter__(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fd = os.open(str(self.path), os.O_RDWR | os.O_CREAT, 0o644)
        deadline = time.time() + self.wait
        while True:
            try:
                fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return True
            except OSError:
                if time.time() > deadline:
                    return False
                time.sleep(0.2)

    def __exit__(self, *exc) -> None:
        if self.fd is not None:
            os.close(self.fd)


def fetch(source: Path, base: Path, max_age: int) -> str:
    stamp = base / ".fetched"
    try:
        if max_age > 0 and time.time() - stamp.stat().st_mtime < max_age:
            return "fetch skipped (recent)"
    except OSError:
        pass
    remote, _, branch = REF.partition("/")
    try:
        r = git(source, "fetch", "--quiet", remote, branch, timeout=15)
    except subprocess.TimeoutExpired:
        return "fetch timed out"
    if r.returncode:
        return "fetch failed: " + (r.stderr.strip().splitlines() or ["?"])[-1]
    stamp.touch()
    return "fetched"


def remove_snapshot(source: Path, snap: Path) -> None:
    git(source, "worktree", "remove", "-f", "-f", str(snap))
    if snap.exists() or snap.is_symlink():
        shutil.rmtree(snap, ignore_errors=True)
    git(source, "worktree", "prune")
    try:
        Path(str(snap) + SIDECAR).unlink()
    except OSError:
        pass


def build_snapshot(source: Path, base: Path, sha: str) -> Path:
    snaps = base / "snapshots"
    snaps.mkdir(parents=True, exist_ok=True)
    snap = snaps / sha
    if read_sidecar(snap) and snap.is_dir():
        return snap
    if snap.exists():  # a build that died before its sidecar: start over
        remove_snapshot(source, snap)
    # Not locked. `git worktree prune` only drops entries whose directory is
    # gone, so a live snapshot is safe, and a scratch HOME's snapshot (a test,
    # a deleted install) cleans itself up. Locked, the first day's test runs
    # left seven entries for deleted temp dirs in the shared repo that prune
    # would never remove.
    r = git(source, "worktree", "add", "--detach", str(snap), sha, timeout=120)
    if r.returncode:
        raise RuntimeError("worktree add failed: " + r.stderr.strip())
    Path(str(snap) + SIDECAR).write_text(json.dumps(
        {"sha": sha, "source": str(source), "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}) + "\n")
    return snap


def link_state(source: Path, snap: Path) -> int:
    """Symlink the source checkout's gitignored state into the snapshot."""
    r = git(source, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory")
    if r.returncode:
        return 0
    chosen: List[str] = []
    for raw in r.stdout.splitlines():
        rel = raw.rstrip("/")
        if not rel or rel.startswith(SKIP_PREFIXES) or any(p in rel.split("/") for p in SKIP_PARTS):
            continue
        if any(rel == c or rel.startswith(c + "/") for c in chosen):
            continue
        chosen.append(rel)
    made = 0
    for rel in chosen:
        dst = snap / rel
        if dst.exists() or dst.is_symlink() or not dst.parent.is_dir():
            continue
        os.symlink(source / rel, dst)
        made += 1
    return made


def swap_current(base: Path, sha: str) -> None:
    tmp = base / ".current.{}".format(os.getpid())
    if tmp.is_symlink() or tmp.exists():
        tmp.unlink()
    os.symlink(os.path.join("snapshots", sha), tmp)
    os.replace(tmp, base / "current")  # rename(2): never a moment without `current`


def in_use(snaps: Path) -> set:
    """Snapshot names some running process still has open: a file, a
    directory or its cwd, per lsof. On 2026-10-10 hud-listen ran from
    95e730c4 from 18:29, four updates pruned that snapshot under it, and
    "show my agents" failed because the kyber-sessions path it had resolved
    at start no longer existed. Python closes a script once read, so a
    process can still miss this; that is why hud-listen should also restart
    on update, and why KEEP stays above one."""
    prefix = str(snaps.resolve()) + os.sep
    try:
        out = subprocess.run(["lsof", "-nP", "-Fn"], capture_output=True, text=True, timeout=60).stdout
    except (OSError, subprocess.SubprocessError):
        return set()
    names = set()
    for line in out.splitlines():
        if line.startswith("n") and line[1:].startswith(prefix):
            names.add(line[1 + len(prefix):].split(os.sep, 1)[0])
    return names


def prune(source: Path, base: Path, keep_sha: str) -> List[str]:
    snaps = base / "snapshots"
    busy = in_use(snaps) if snaps.is_dir() else set()
    rows = []
    for d in snaps.iterdir() if snaps.is_dir() else []:
        if d.is_dir() and not d.name.endswith(SIDECAR):
            side = read_sidecar(d) or {}
            rows.append((side.get("built", ""), d))
    rows.sort(reverse=True)
    kept, removed = 0, []
    for _, d in rows:
        if d.name == keep_sha or kept < KEEP - 1:
            if d.name != keep_sha:
                kept += 1
            continue
        if d.name in busy:
            continue  # a live process runs from it; the next update tries again
        remove_snapshot(source, d)
        removed.append(d.name[:12])
    return removed


def link_bin(base: Path, source: Path, live: str) -> str:
    """Put the runtime's tools on PATH with the runtime's own tools_link.py."""
    cur = base / "current"
    script = cur / "tools" / "tools_link.py"
    if not script.is_file():
        return "no tools_link.py in runtime"
    r = subprocess.run([sys.executable, "-I", str(script), "apply", "--repo", str(cur.resolve()),
                        "--link-root", str(cur), "--setup", str(cur / "setup.sh"),
                        "--live", live, "--retarget-from", str(source)],
                       capture_output=True, text=True, timeout=60)
    return (r.stdout.strip() or r.stderr.strip()).replace("\n", "; ")


def update(source: Path, base: Path, do_fetch: bool, max_age: int, live: Optional[str],
           adopt: bool = False) -> dict:
    out = {"source": str(source), "runtime": str(base / "current")}
    with Lock(base / ".lock") as got:
        if not got:
            out["result"] = "busy: another update holds the lock"
            out["sha"] = current_sha(base)
            return out
        if do_fetch:
            out["fetch"] = fetch(source, base, max_age)
        sha = ref_sha(source, REF)
        if not sha:
            out["result"] = "no {} in {}".format(REF, source)
            out["sha"] = current_sha(base)
            out["error"] = True
            return out
        before = current_sha(base)
        # A caller pointed at some other checkout (a test's scratch clone, a
        # second clone) must not repoint the runtime every PATH tool uses.
        # setup.sh passes --adopt; a source that no longer exists is adopted.
        owner = (read_sidecar((base / "current").resolve()) or {}).get("source") if before else None
        if owner and Path(owner).resolve() != source.resolve() and not adopt and (Path(owner) / ".git").exists():
            out["result"] = "refused: runtime belongs to {}, not {} (pass --adopt)".format(owner, source)
            out["sha"], out["error"] = before, True
            return out
        snap = build_snapshot(source, base, sha)
        out["state_linked"] = link_state(source, snap)
        if before != sha:
            swap_current(base, sha)
        out["removed"] = prune(source, base, sha)
        out["sha"], out["previous"] = sha, before
        out["result"] = "updated" if before != sha else "current"
        if live:
            out["tools"] = link_bin(base, source, live)
    return out


def status(source: Path, base: Path) -> dict:
    sha, origin = current_sha(base), ref_sha(source, REF)
    behind = None
    if sha and origin and sha != origin:
        r = git(source, "rev-list", "--count", "{}..{}".format(sha, origin))
        behind = int(r.stdout.strip()) if r.returncode == 0 and r.stdout.strip().isdigit() else None
    live = Path(os.environ.get("CHEWBACCA_BIN_DIR") or Path.home() / ".local" / "bin")
    into_source = []
    src = str(source.resolve())
    for f in sorted(live.iterdir()) if live.is_dir() else []:
        if f.is_symlink():
            t = os.readlink(f)
            if t == src or t.startswith(src + "/"):
                into_source.append(f.name)
    return {"runtime": str(base / "current"), "sha": sha, "origin_main": origin,
            "equal": bool(sha and sha == origin), "behind": behind,
            "links_into_source": into_source, "source": str(source)}


def install_timer(source: Path, base: Path, live: str, interval: int) -> str:
    """A launchd job that runs `update` between sessions, from the runtime itself."""
    if sys.platform != "darwin":
        return "not macOS, no timer"
    plist = Path.home() / "Library" / "LaunchAgents" / (LABEL + ".plist")
    log = Path.home() / "Library" / "Logs" / "chewbacca-kit-runtime.log"
    script = base / "current" / "tools" / "kit_runtime.py"
    args = ["/usr/bin/python3", "-I", str(script), "update", "--fetch", "--repo", str(source), "--link-bin", live]
    items = "".join("<string>{}</string>".format(a) for a in args)
    plist.parent.mkdir(parents=True, exist_ok=True)
    plist.write_text("""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>{label}</string>
  <key>ProgramArguments</key><array>{items}</array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartInterval</key><integer>{interval}</integer>
  <key>RunAtLoad</key><true/>
  <key>LowPriorityIO</key><true/>
  <key>StandardOutPath</key><string>{log}</string>
  <key>StandardErrorPath</key><string>{log}</string>
</dict></plist>
""".format(label=LABEL, items=items, interval=interval, log=log))
    domain = "gui/{}".format(os.getuid())
    subprocess.run(["launchctl", "bootout", domain + "/" + LABEL], capture_output=True)
    r = subprocess.run(["launchctl", "bootstrap", domain, str(plist)], capture_output=True, text=True)
    return "timer every {}s".format(interval) if r.returncode == 0 else "timer not loaded: " + r.stderr.strip()


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="kit_runtime", description=__doc__.splitlines()[0])
    ap.add_argument("action", choices=("update", "status", "install-timer", "path"))
    ap.add_argument("--repo", help="source checkout (default: d1-config, then the install manifest)")
    ap.add_argument("--fetch", action="store_true", help="git fetch origin main first")
    ap.add_argument("--max-age", type=int, default=0, help="skip the fetch if one ran this many seconds ago")
    ap.add_argument("--link-bin", help="also put the runtime's tools on PATH in this directory")
    ap.add_argument("--adopt", action="store_true", help="update: rebuild from --repo even if another checkout owns the runtime")
    ap.add_argument("--interval", type=int, default=900)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)

    base = runtime_base()
    if a.action == "path":
        print(base / "current")
        return 0
    source = find_source(a.repo)
    if source is None:
        print("kit_runtime: no source checkout found (pass --repo)", file=sys.stderr)
        return 2

    if a.action == "update":
        try:
            res = update(source, base, a.fetch, a.max_age, a.link_bin, a.adopt)
        except (RuntimeError, OSError, subprocess.SubprocessError) as e:
            res = {"result": "failed: {}".format(e), "error": True, "sha": current_sha(base)}
        if a.json:
            print(json.dumps(res))
        else:
            sha = (res.get("sha") or "none")[:12]
            line = "runtime {} {}".format(sha, res["result"])
            if res.get("previous") and res.get("result") == "updated":
                line += " (was {})".format(res["previous"][:12])
            if res.get("tools"):
                line += "; tools: " + res["tools"]
            print(line)
        return 1 if res.get("error") else 0

    if a.action == "status":
        st = status(source, base)
        if a.json:
            print(json.dumps(st))
        else:
            print("runtime   {}".format(st["runtime"]))
            print("sha       {}".format(st["sha"] or "none"))
            print("origin    {}".format(st["origin_main"] or "none"))
            print("state     {}".format("current" if st["equal"] else
                                        "behind by {}".format(st["behind"]) if st["behind"] else "differs"))
            if st["links_into_source"]:
                print("PATH links still into the source checkout: " + " ".join(st["links_into_source"]))
        return 0 if st["equal"] else 1

    print(install_timer(source, base, a.link_bin or str(Path.home() / ".local" / "bin"), a.interval))
    return 0


if __name__ == "__main__":
    sys.exit(main())
