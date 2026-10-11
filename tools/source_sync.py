#!/usr/bin/env python3
"""Catch the source checkout up to the kit snapshot before setup installs from it.

2026-10-11: `chewbacca update` ran setup, and setup re-execs from the checkout
the kit runtime was built from (~/code/chewbacca). That checkout sat 62 commits
behind main, so a hook landed an hour earlier (essay-gate) was copied but never
registered. It couldn't fast-forward because six files were "dirty", and every
one of them was a copy of something already on main: four byte-identical to
main, one an older main version, one untracked file main also has.

So: a dirty or untracked file whose content equals some version of that file
between HEAD and the target is already landed, and replacing it with the
target's version loses nothing. Anything else is somebody's real work, and the
sync stops without touching it. Never resets, never stashes, never forces.

Usage: source_sync.py <repo> <target-sha>
Exit 0 = repo HEAD now equals target (or already did). 1 = left as is, says why.
"""
import os
import subprocess
import sys


def git(repo, *args, check=True, binary=False):
    r = subprocess.run(["git", "-C", repo, *args], capture_output=True)
    if check and r.returncode != 0:
        raise RuntimeError(r.stderr.decode(errors="replace").strip())
    return r.stdout if binary else r.stdout.decode(errors="replace").strip()


def blob_hash(repo, path):
    return git(repo, "hash-object", "--", path)


def landed_versions(repo, head, target, path):
    """Every blob this path had on HEAD..target, plus at target."""
    out = git(repo, "log", "--format=%H", f"{head}..{target}", "--", path, check=False)
    shas = {target} | set(out.split())
    blobs = set()
    for sha in shas:
        b = git(repo, "rev-parse", f"{sha}:{path}", check=False)
        if b and not b.startswith("fatal"):
            blobs.add(b)
    return blobs


def edits_already_landed(repo, head, target, path, full):
    """True when every line this copy added is on main and every line it cut
    is gone from main too. The 10/11 case: a tab appended two index lines to
    MEMORY.md and landed them, main gained more lines since, so no whole-file
    version matched, yet the local edit held nothing main didn't."""
    import difflib
    old = git(repo, "show", f"{head}:{path}", check=False).splitlines()
    new = open(full, encoding="utf-8", errors="replace").read().splitlines()
    tgt = set(git(repo, "show", f"{target}:{path}", check=False).splitlines())
    added, cut = [], []
    for line in difflib.ndiff(old, new):
        if line.startswith("+ "):
            added.append(line[2:])
        elif line.startswith("- "):
            cut.append(line[2:])
    return bool(added or cut) and all(a in tgt for a in added) and not any(c in tgt for c in cut)


def main(repo, target):
    head = git(repo, "rev-parse", "HEAD")
    target = git(repo, "rev-parse", target)
    if head == target:
        return 0, "already at target"
    if subprocess.run(["git", "-C", repo, "merge-base", "--is-ancestor", head, target]).returncode != 0:
        return 1, "source has commits main doesn't; left as is"
    changed = set(git(repo, "diff", "--name-only", head, target).splitlines())
    # -z, unstripped: a stripped first line " M index.md" loses its leading
    # space and the path comes out as "ndex.md".
    raw = git(repo, "status", "--porcelain", "-z", "--untracked-files=all", binary=True)
    status = [e for e in raw.decode(errors="replace").split("\0") if e]
    heal, keep = [], []
    for line in status:
        code, path = line[:2], line[3:]
        if path not in changed:
            continue  # ff won't touch it; leave it exactly as it is
        full = os.path.join(repo, path)
        if code.strip() == "D" or not os.path.isfile(full):
            keep.append(path)
            continue
        if blob_hash(repo, full) in landed_versions(repo, head, target, path):
            heal.append((code, path))
        elif code.strip() == "M" and edits_already_landed(repo, head, target, path, full):
            heal.append((code, path))
        else:
            keep.append(path)
    if keep:
        return 1, "real local work in " + ", ".join(sorted(keep)[:5]) + "; left as is"
    for code, path in heal:
        if code == "??":
            os.remove(os.path.join(repo, path))
        else:
            git(repo, "checkout", head, "--", path)
    r = subprocess.run(["git", "-C", repo, "merge", "--ff-only", "-q", target], capture_output=True)
    if r.returncode != 0:
        return 1, "fast-forward failed: " + r.stderr.decode(errors="replace").strip()[:200]
    return 0, f"caught up {len(changed)} files, cleared {len(heal)} already-landed copies"


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__.strip().splitlines()[-2])
        sys.exit(2)
    try:
        rc, msg = main(sys.argv[1], sys.argv[2])
    except RuntimeError as e:
        rc, msg = 1, str(e)
    print("source-sync: " + msg)
    sys.exit(rc)
