#!/usr/bin/env python3
"""
product_sync: keep the files a product shares with Chewbacca the same in both.

  tools/product_sync.py                 what's in step, and which side moved
  tools/product_sync.py pull            bring Chewbacca's landed changes here
  tools/product_sync.py push            land this repo's changes on Chewbacca's main
  tools/product_sync.py push --dry-run  build and check the land, never push
  tools/product_sync.py add PATH...     start sharing a file (same path both sides)
  tools/product_sync.py add HERE=THERE  share HERE in this repo as THERE in Chewbacca

It lives in Chewbacca and every product carries a copy at the same path, kept
in step by itself. The product's sync.json lists the shared files and
sync.lock.json holds each one's hash at the last sync, which is how a change
is placed: only Chewbacca moved, only this repo moved, or both did. Both moved
stops with the two hashes and writes nothing, because picking a side is a
person's call. Generalized from usc-os tools/sync (8d2a597, 2026-10-28).

Chewbacca is read with `git show origin/main:<path>` after a fetch, never from
its working tree: the shared checkout holds other tabs' unfinished edits (on
2026-10-28 bin/coursework there was modified and uncommitted). Push lands
through `chewbacca land` from a throwaway worktree, which also regenerates
Chewbacca's SHA256SUMS.

Products ship to other people and Chewbacca is private, so nothing personal
crosses into a product. A pull refuses any file with a match for the firewall
patterns and writes nothing for it. On 2026-10-28 anchored's copy of
slop-check had been hand-scrubbed of names while Chewbacca's still quoted them,
which is the drift this exists to end: the shared copy has to be clean at the
source.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# Generic shapes only. The names, accounts and paths of the people who build
# in Chewbacca live in its config/product-firewall.json, read from origin/main,
# so this file can ship inside a product without carrying them. Products add
# their own under "firewall" in sync.json.
FIREWALL = [
    r"/Users/[a-z]",
    r"/home/[a-z]",
    r"\+1[ -]?\(?\d{3}\)?[ -]?\d{3}[ -]?\d{4}",
]


def root_dir(arg):
    if arg:
        return Path(arg).resolve()
    return Path(__file__).resolve().parent.parent


def chewbacca_dir():
    d = Path(os.environ.get("CHEWBACCA_DIR") or Path.home() / "code" / "chewbacca")
    if not (d / ".git").exists():
        sys.exit(f"BLOCKED: no Chewbacca checkout at {d}. Set CHEWBACCA_DIR to one.")
    return d


def git(repo, *args, check=True):
    r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True)
    if check and r.returncode:
        sys.exit(f"git {' '.join(args)} failed: {r.stderr.decode().strip()}")
    return r


def sha(data):
    return hashlib.sha256(data).hexdigest() if data is not None else None


def load(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def save(path, data):
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")


def ref():
    return os.environ.get("CHEWBACCA_REF", "origin/main")


class Product:
    def __init__(self, root):
        self.root = root
        self.manifest_path = root / "sync.json"
        self.lock_path = root / "sync.lock.json"
        self.manifest = load(self.manifest_path, {"files": []})
        self.lock = load(self.lock_path, {})

    def entries(self):
        """(path here, path in Chewbacca) for every shared file."""
        out = []
        for f in self.manifest.get("files", []):
            if isinstance(f, str):
                out.append((f, f))
            else:
                out.append((f["path"], f.get("chewbacca", f["path"])))
        return out

    def firewall(self, repo):
        private = theirs(repo, "config/product-firewall.json")
        named = json.loads(private).get("patterns", []) if private else []
        pats = FIREWALL + named + self.manifest.get("firewall", [])
        return [re.compile(p) for p in pats]

    def ours(self, path):
        p = self.root / path
        return p.read_bytes() if p.is_file() else None

    def save(self):
        save(self.manifest_path, self.manifest)
        save(self.lock_path, self.lock)


def theirs(repo, path):
    r = git(repo, "show", f"{ref()}:{path}", check=False)
    return r.stdout if r.returncode == 0 else None


def leaks(data, pats):
    """Lines in a file that match a firewall pattern, as (line number, text)."""
    hits = []
    for n, line in enumerate(data.decode("utf-8", "replace").splitlines(), 1):
        if any(p.search(line) for p in pats):
            hits.append((n, line.strip()[:120]))
    return hits


def states(prod, repo):
    out = []
    for here, there in prod.entries():
        a, b = prod.ours(here), theirs(repo, there)
        base = prod.lock.get(here, {}).get("sha256")
        ha, hb = sha(a), sha(b)
        if ha == hb:
            s = "same" if ha else "missing in both"
        elif hb == base or b is None:
            s = "changed here"
        elif ha == base or a is None:
            s = "changed in Chewbacca"
        else:
            s = "changed in both"
        out.append({"path": here, "chewbacca": there, "state": s, "ours": a, "theirs": b,
                    "ours_sha": ha, "theirs_sha": hb})
    return out


def fetch(repo):
    if os.environ.get("CHEWBACCA_NO_FETCH") != "1":
        git(repo, "fetch", "-q", "origin", "main", check=False)
    return git(repo, "rev-parse", "--short", ref()).stdout.decode().strip()


def record(prod, path, data, commit):
    prod.lock[path] = {"sha256": sha(data), "chewbacca_commit": commit}


def write(dest, data):
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    if data[:2] == b"#!":
        dest.chmod(0o755)


def cmd_status(prod, repo, args):
    commit = fetch(repo)
    rows = states(prod, repo)
    name = prod.manifest.get("product", prod.root.name)
    pats = prod.firewall(repo)
    report = {"product": name, "chewbacca": commit, "files": []}
    for r in rows:
        blocked = r["state"] == "changed in Chewbacca" and bool(leaks(r["theirs"], pats))
        report["files"].append({"path": r["path"], "state": r["state"], "firewall": blocked})
    n = sum(r["state"] == "same" for r in rows)
    if args.json:
        report["in_step"] = n
        report["total"] = len(rows)
        print(json.dumps(report, indent=2))
    else:
        print(f"{name}: Chewbacca {ref()} at {commit}, {len(rows)} shared files")
        for f in report["files"]:
            if f["state"] != "same":
                extra = "  (personal, firewall holds it)" if f["firewall"] else ""
                print(f"  {f['state']:<22} {f['path']}{extra}")
        print(f"  {n} of {len(rows)} in step")
    return 0 if n == len(rows) else 1


def conflicts(stuck):
    for r in stuck:
        print(f"BLOCKED: {r['path']} changed in both repos (here {r['ours_sha'][:10]}, "
              f"Chewbacca {r['theirs_sha'][:10]}). Merge it by hand, then sync again.")
    return 3 if stuck else 0


def cmd_pull(prod, repo, _):
    commit = fetch(repo)
    pats = prod.firewall(repo)
    stuck, pulled, walled = [], [], []
    for r in states(prod, repo):
        if r["state"] == "changed in Chewbacca":
            hits = leaks(r["theirs"], pats)
            if hits:
                walled.append((r, hits))
                continue
            write(prod.root / r["path"], r["theirs"])
            record(prod, r["path"], r["theirs"], commit)
            pulled.append(r["path"])
        elif r["state"] == "same" and r["ours"] is not None:
            record(prod, r["path"], r["ours"],
                   prod.lock.get(r["path"], {}).get("chewbacca_commit") or commit)
        elif r["state"] == "changed in both":
            stuck.append(r)
    prod.save()
    for p in pulled:
        print(f"  pulled {p}")
    print(f"Pulled {len(pulled)} file(s) from Chewbacca {commit}")
    for r, hits in walled:
        print(f"BLOCKED: {r['chewbacca']} in Chewbacca has personal data, so it stays out of "
              f"{r['path']}. Make the Chewbacca copy clean, then pull again:")
        for n, line in hits[:5]:
            print(f"    line {n}: {line}")
    rc = conflicts(stuck)
    return rc or (4 if walled else 0)


def cmd_push(prod, repo, args):
    commit = fetch(repo)
    rows = states(prod, repo)
    stuck = [r for r in rows if r["state"] == "changed in both"]
    if stuck:
        return conflicts(stuck)
    todo = [r for r in rows if r["state"] == "changed here" and r["ours"] is not None]
    if not todo:
        print("Nothing to push: Chewbacca already has every shared file as it is here")
        return 0
    land = shutil.which("chewbacca")
    if not land:
        sys.exit("BLOCKED: `chewbacca` isn't on PATH, and pushing to Chewbacca's main goes through `chewbacca land`")
    wt = Path(tempfile.mkdtemp(prefix="product-sync-")) / "wt"
    git(repo, "worktree", "add", "-q", "--detach", str(wt), ref())
    try:
        for r in todo:
            write(wt / r["chewbacca"], r["ours"])
        paths = [r["chewbacca"] for r in todo]
        name = prod.manifest.get("product", prod.root.name)
        msg = args.message or f"chore: sync {len(paths)} file(s) from {name}"
        cmd = [land, "land", "--paths", *paths, "-m", msg] + (["--dry-run"] if args.dry_run else [])
        res = subprocess.run(cmd, cwd=wt)
        if res.returncode:
            print(f"BLOCKED: chewbacca land exited {res.returncode}; nothing recorded")
            return res.returncode
    finally:
        git(repo, "worktree", "remove", "--force", str(wt), check=False)
        shutil.rmtree(wt.parent, ignore_errors=True)
    if args.dry_run:
        print(f"Dry run: {len(todo)} file(s) would land on Chewbacca main")
        return 0
    new = fetch(repo)
    for r in todo:
        record(prod, r["path"], r["ours"], new)
    prod.save()
    print(f"Pushed {len(todo)} file(s) to Chewbacca main ({commit} -> {new})")
    return 0


def cmd_add(prod, repo, args):
    commit = fetch(repo)
    files = prod.manifest.setdefault("files", [])
    known = {here for here, _ in prod.entries()}
    for spec in args.paths:
        here, _, there = spec.partition("=")
        there = there or here
        a, b = prod.ours(here), theirs(repo, there)
        if a is None and b is None:
            sys.exit(f"{here} is in neither repo")
        if here not in known:
            files.append(here if here == there else {"path": here, "chewbacca": there})
        if a is not None and b is not None and sha(a) == sha(b):
            record(prod, here, a, commit)
        else:
            # The side that has it, or Chewbacca when both differ, reads as the
            # change: a None base means the first status shows who moved.
            prod.lock[here] = {"sha256": sha(a) if b is not None and a is not None else None,
                               "chewbacca_commit": commit}
        print(f"  sharing {here}" + (f" as {there} in Chewbacca" if there != here else ""))
    files.sort(key=lambda f: f if isinstance(f, str) else f["path"])
    prod.save()
    return 0


def main():
    ap = argparse.ArgumentParser(description="Keep files a product shares with Chewbacca the same in both.")
    ap.add_argument("--root", help="the product repo (default: the repo this file is in)")
    sub = ap.add_subparsers(dest="cmd")
    s = sub.add_parser("status")
    s.add_argument("--json", action="store_true")
    sub.add_parser("pull")
    p = sub.add_parser("push")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("-m", "--message")
    a = sub.add_parser("add")
    a.add_argument("paths", nargs="+")
    args = ap.parse_args()
    if not args.cmd:
        args.cmd, args.json = "status", False
    prod = Product(root_dir(args.root))
    repo = chewbacca_dir()
    return {"pull": cmd_pull, "push": cmd_push, "add": cmd_add, "status": cmd_status}[args.cmd](prod, repo, args)


if __name__ == "__main__":
    sys.exit(main())
