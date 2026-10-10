#!/usr/bin/env python3
"""Keep ~/.claude/hooks in step with the kit's hooks on origin/main.

The hooks Claude Code runs are copies setup.sh made, so a hook fix on main
does nothing until someone recopies it. On 2026-10-09 the live copies were
hand-synced in the afternoon and by 9 pm 17 of them were stale again and two
new hooks had never been installed. Pulling the repo does not help either:
the shared checkout is nearly always dirty, so autopull declines.

So this reads the hooks straight from the ref (default origin/main), never
the working tree, and sorts every live copy:

  current   identical to the ref
  stale     an older kit version: its blob exists in the repo's history
  missing   the ref has it, ~/.claude/hooks does not
  local     matches nothing the repo ever stored: someone edited it live

`scan` (the default) only reports. `apply` replaces stale copies and installs
missing ones, backing up every file it overwrites. A local copy is left alone
unless --include-local: the first run on 2026-10-09 found 7 "local" hooks and
every one was a pre-scrub kit copy (names the history rewrite replaced, an old
Todoist endpoint), not anyone's edit, because rewriting history drops the old
blobs. The backup is what makes replacing them safe.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HOOKS_PATH = ".claude/hooks"
# Only scripts setup.sh itself installs (cp .claude/hooks/*.sh).
SUFFIX = ".sh"


def git(repo: Path, *args: str, data: bytes | None = None) -> bytes:
    result = subprocess.run(["git", "-c", "core.fsmonitor=false", "-C", str(repo), *args],
                            input=data, capture_output=True, timeout=20)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors="replace").strip() or f"git {args[0]} failed")
    return result.stdout


def blob_hash(repo: Path, content: bytes) -> str:
    return git(repo, "hash-object", "--stdin", data=content).decode().strip()


def known_blobs(repo: Path, hashes: list[str]) -> set[str]:
    """Which of these hashes the repo has stored, i.e. once committed."""
    if not hashes:
        return set()
    out = git(repo, "cat-file", "--batch-check", data=("\n".join(hashes) + "\n").encode()).decode()
    return {line.split()[0] for line in out.splitlines() if line and not line.endswith("missing")}


def scan(repo: Path, live: Path, ref: str) -> list[dict]:
    listing = git(repo, "ls-tree", "-z", ref, HOOKS_PATH + "/").decode().split("\0")
    rows = []
    for entry in filter(None, listing):
        meta, path = entry.split("\t", 1)
        mode, kind, sha = meta.split()
        name = path.rsplit("/", 1)[-1]
        if kind != "blob" or not name.endswith(SUFFIX):
            continue
        target = live / name
        row = {"name": name, "ref_blob": sha, "mode": mode}
        if not target.exists():
            row["state"] = "missing"
        else:
            row["live_blob"] = blob_hash(repo, target.read_bytes())
            row["state"] = "current" if row["live_blob"] == sha else None
        rows.append(row)
    pending = [r["live_blob"] for r in rows if r["state"] is None]
    stored = known_blobs(repo, pending)
    for row in rows:
        if row["state"] is None:
            row["state"] = "stale" if row["live_blob"] in stored else "local"
    return rows


def apply(repo: Path, live: Path, rows: list[dict], backup_root: Path,
          include_local: bool = False) -> list[dict]:
    """Write only the rows a scan returned as stale or missing (and local,
    when asked), backing up every file it overwrites."""
    states = ("stale", "missing", "local") if include_local else ("stale", "missing")
    backup = backup_root / time.strftime("hooks-backup-%Y%m%d-%H%M%S")
    live.mkdir(parents=True, exist_ok=True)
    done = []
    for row in rows:
        if row["state"] not in states:
            continue
        target = live / row["name"]
        if row["state"] != "missing":
            backup.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, backup / row["name"])
        content = git(repo, "cat-file", "blob", row["ref_blob"])
        tmp = target.with_name(f".{row['name']}.sync-{os.getpid()}")
        tmp.write_bytes(content)
        os.chmod(tmp, 0o755)
        os.replace(tmp, target)
        done.append(row)
    return done


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("action", nargs="?", default="scan", choices=("scan", "apply"))
    parser.add_argument("--repo", default=os.environ.get("CHEWBACCA_REPO_DIR", "."))
    parser.add_argument("--live", default=str(Path.home() / ".claude" / "hooks"))
    parser.add_argument("--ref", default="origin/main")
    parser.add_argument("--backup-root", default=str(Path.home() / ".chewbacca" / "runtime"))
    parser.add_argument("--include-local", action="store_true",
                        help="also replace copies that match no stored kit version (backed up)")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    repo, live = Path(args.repo), Path(args.live)
    try:
        rows = scan(repo, live, args.ref)
        changed = apply(repo, live, rows, Path(args.backup_root), args.include_local) if args.action == "apply" else []
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as err:
        print(f"hooks-sync: {err}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps({"rows": rows, "changed": [r["name"] for r in changed]}))
        return 0
    counts: dict[str, list[str]] = {}
    for row in rows:
        counts.setdefault(row["state"], []).append(row["name"])
    verb = "updated" if args.action == "apply" else "would update"
    for state in ("stale", "missing", "local"):
        names = counts.get(state, [])
        if names:
            local = (f"{verb} (matches no stored kit version, backed up)" if args.include_local
                     else "left alone (matches no stored kit version)")
            label = {"stale": f"{verb} (older kit version)", "missing": f"{verb} (not installed)",
                     "local": local}[state]
            print(f"{label}: {', '.join(sorted(names))}")
    print(f"{len(counts.get('current', []))} of {len(rows)} hooks already current")
    return 0


if __name__ == "__main__":
    sys.exit(main())
