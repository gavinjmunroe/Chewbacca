#!/usr/bin/env python3
"""Merge drivers for the two generated files, so a merge or rebase never stops on them.

WHY. On the night of 2026-10-09 about ten tabs pushed main, and nearly every
merge and rebase conflicted on SHA256SUMS.txt and on README.md's counts block,
both written by tools (checksums.py, counts.py). Each tab resolved it by hand
with `checkout --theirs` plus a regenerate, and a tab that skipped the
regenerate pushed a stale manifest that pre-push then refused for the next tab.

HOW. A merge driver runs per file, before the merge has finished, so the
working tree it could regenerate from is half merged. So the driver never
regenerates. It merges what it can know exactly and defers the rest:

  sums    SHA256SUMS.txt is `hash  path` lines. Merged by path, three-way:
          the side that changed a path's hash wins. That is exact whenever
          no single file changed on both sides, which is the common case (two
          tabs, two different bin/ files). A path changed on both sides gets
          a hash nobody can know until the merged file exists, so the driver
          keeps ours for it and marks the merge for settling.
  readme  README.md is merged by `git merge-file` with the generated counts
          region masked out, so a real prose conflict still stops the merge.
          Counts depend on the whole merged tree, so a changed region always
          marks the merge for settling, even when both sides agree.

  settle  Runs from post-merge, post-commit and post-rewrite. If a mark is
          waiting, it regenerates both files from the committed HEAD tree
          (a temporary worktree when this one is dirty, so another tab's
          untracked skills never reach the counts) and folds the result into
          HEAD with plumbing. It never touches the index or working tree
          entry of a path someone else has changed, and it never rewrites a
          commit already on a remote branch.

When settling is impossible (core.hooksPath does not point at hooks that call
`settle`), an ambiguous merge is reported as a conflict, which is the old
behavior, rather than a silent stale file.

  python3 tools/merge_regen.py install [--repo DIR]      register drivers (idempotent)
  python3 tools/merge_regen.py driver sums|readme O A B P
  python3 tools/merge_regen.py settle [hook-name]
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SUMS = "SHA256SUMS.txt"
README = "README.md"
BEGIN = "<!-- BEGIN GENERATED: counts -->"
END = "<!-- END GENERATED: counts -->"
REGION = re.compile(re.escape(BEGIN) + r"\n(.*?)\n" + re.escape(END), re.S)
MASK = "chewbacca-merge-regen: generated region"
MARK = "chewbacca-regen-pending"
DRIVERS = {"chewbacca-sums": ("sums", "SHA256SUMS.txt by path"),
           "chewbacca-readme": ("readme", "README.md with the counts region masked")}
# A hook body has to name this for settle to count as wired: the hooks call
# chewbacca_settle from .githooks/lib-regen.sh.
HOOK_NEEDLE = "chewbacca_settle"


def git(*args, cwd=None, check=True, env=None, inp=None):
    r = subprocess.run(["git", "-c", "core.fsmonitor=false", *args], cwd=cwd, env=env,
                       input=inp, capture_output=True, text=isinstance(inp, str) or inp is None)
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.strip() if isinstance(r.stderr, str) else r.stderr}")
    return r


def out(*args, cwd=None):
    return git(*args, cwd=cwd).stdout.strip()


def git_dir(cwd=None):
    return Path(out("rev-parse", "--absolute-git-dir", cwd=cwd))


def mark(reason):
    """Note that this merge needs settling. Per worktree: each has its own git dir."""
    try:
        with open(git_dir() / MARK, "a", encoding="utf-8") as f:
            f.write(reason + "\n")
    except (OSError, RuntimeError):
        pass


# ── install ──────────────────────────────────────────────────────────────────

def install(repo):
    repo = Path(repo).resolve()
    common = Path(out("rev-parse", "--path-format=absolute", "--git-common-dir", cwd=repo))
    # The main checkout, not this worktree: worktrees are removed when their
    # branch lands, and a driver path into one would dangle for every tab.
    main = common.parent if common.name == ".git" else repo
    script = main / "tools" / "merge_regen.py"
    if not script.is_file():
        script = Path(__file__).resolve()
    changed = []
    for name, (kind, label) in DRIVERS.items():
        want = {f"merge.{name}.name": f"Chewbacca: {label}",
                f"merge.{name}.driver": f"python3 '{script}' driver {kind} %O %A %B %P"}
        for key, val in want.items():
            have = git("config", "--get", key, cwd=repo, check=False).stdout.strip()
            if have != val:
                git("config", key, val, cwd=repo)
                changed.append(key)
    print(f"merge drivers: {'registered ' + ', '.join(changed) if changed else 'already registered'}")
    return 0


def settle_wired(cwd=None):
    """core.hooksPath points at hooks that call settle after a merge, commit and rewrite."""
    hp = git("config", "--get", "core.hooksPath", cwd=cwd, check=False).stdout.strip()
    if not hp:
        return False
    hooks = Path(hp) if os.path.isabs(hp) else Path(out("rev-parse", "--show-toplevel", cwd=cwd)) / hp
    for name in ("post-merge", "post-commit", "post-rewrite"):
        try:
            if HOOK_NEEDLE not in (hooks / name).read_text(encoding="utf-8"):
                return False
        except OSError:
            return False
    return True


# ── drivers ──────────────────────────────────────────────────────────────────

def parse_sums(text):
    rows = {}
    for line in text.splitlines():
        h, sep, path = line.partition("  ")
        if sep and path:
            rows[path] = h
    return rows


def merge_sums(o, a, b):
    """Three-way by path. Returns (text, ambiguous paths)."""
    O, A, B = parse_sums(o), parse_sums(a), parse_sums(b)
    merged, ambiguous = {}, []
    for path in sorted(set(O) | set(A) | set(B)):
        ho, ha, hb = O.get(path), A.get(path), B.get(path)
        if ha == hb:
            pick = ha
        elif ha == ho:
            pick = hb
        elif hb == ho:
            pick = ha
        else:
            pick = ha if ha is not None else hb
            ambiguous.append(path)
        if pick is not None:
            merged[path] = pick
    return "".join(f"{h}  {p}\n" for p, h in sorted(merged.items())), ambiguous


def merge_readme(o, a, b, size):
    """(text, clean, region_ambiguous). Prose goes through git merge-file."""
    regions = [REGION.search(t) for t in (o, a, b)]
    if not all(regions):
        return None
    ro, ra, rb = (m.group(1) for m in regions)
    masked = [t[:m.start(1)] + MASK + t[m.end(1):] for t, m in zip((o, a, b), regions)]
    with tempfile.TemporaryDirectory() as d:
        paths = []
        for name, text in zip(("base", "ours", "theirs"), masked):
            p = Path(d) / name
            p.write_text(text, encoding="utf-8")
            paths.append(str(p))
        r = subprocess.run(["git", "merge-file", "-p", f"--marker-size={size}",
                            "-L", "ours", "-L", "base", "-L", "theirs",
                            paths[1], paths[0], paths[2]], capture_output=True, text=True)
    if r.returncode < 0 or r.returncode > 127:
        return None
    # Counts are a function of the merged tree, not of either side: two tabs
    # that each add one skill both write "1 skill", and agreeing is still
    # wrong. So any change to the region marks the merge for settling, and
    # the region meanwhile takes the side that changed it.
    region = rb if ra == ro else ra
    ambiguous = not (ra == ro == rb)
    if r.stdout.count(MASK) != 1:
        # The masked line itself sits inside a conflict hunk: leave git's
        # default behavior to a human.
        return None
    return r.stdout.replace(MASK, region), r.returncode == 0, ambiguous


def driver(kind, o_path, a_path, b_path, path):
    read = lambda p: Path(p).read_text(encoding="utf-8", errors="surrogateescape")
    o, a, b = read(o_path), read(a_path), read(b_path)
    if kind == "sums":
        text, ambiguous = merge_sums(o, a, b)
        Path(a_path).write_text(text, encoding="utf-8", errors="surrogateescape")
        if ambiguous:
            if not settle_wired():
                print(f"merge_regen: {path}: {len(ambiguous)} file(s) changed on both sides and "
                      f"no settle hook is wired; regenerate with tools/checksums.py", file=sys.stderr)
                return 1
            mark(f"sums {path}: {', '.join(ambiguous[:5])}")
        return 0
    if kind == "readme":
        size = int(os.environ.get("CHEWBACCA_MARKER_SIZE", "7"))
        res = merge_readme(o, a, b, size)
        if res is None:
            # No region to mask, or the conflict touches it: plain merge-file.
            r = subprocess.run(["git", "merge-file", f"--marker-size={size}", a_path, o_path, b_path])
            return 0 if r.returncode == 0 else 1
        text, clean, ambiguous = res
        Path(a_path).write_text(text, encoding="utf-8", errors="surrogateescape")
        if ambiguous:
            if not settle_wired():
                print(f"merge_regen: {path}: both sides changed the counts region and no settle "
                      f"hook is wired; regenerate with tools/counts.py", file=sys.stderr)
                return 1
            mark(f"readme {path}")
        return 0 if clean else 1
    print(f"merge_regen: unknown driver kind {kind!r}", file=sys.stderr)
    return 1


# ── settle ───────────────────────────────────────────────────────────────────

def in_progress(gd):
    return any((gd / n).exists() for n in ("rebase-merge", "rebase-apply", "MERGE_HEAD",
                                            "CHERRY_PICK_HEAD", "REVERT_HEAD"))


def regenerate(top, head):
    """{path: bytes} for the two files as HEAD's tree says they should be.

    Both tools run inside a checkout of HEAD: the working tree here when it is
    clean, a temporary detached worktree when it is not. counts.py reads the
    working tree, and in the shared checkout that holds other tabs' untracked
    skills, which pre-push refused on 2026-10-09 for exactly this reason.
    """
    clean = not out("status", "--porcelain", "--untracked-files=normal", cwd=top)
    tmp = None
    try:
        if clean:
            where = top
        else:
            tmp = Path(tempfile.mkdtemp(prefix="chewbacca-regen-")) / "tree"
            git("worktree", "add", "--quiet", "--detach", str(tmp), head, cwd=top)
            where = tmp
        env = dict(os.environ, CHEWBACCA_SUITE="")
        for tool in ("tools/checksums.py", "tools/counts.py"):
            if (Path(where) / tool).is_file():
                subprocess.run([sys.executable, tool], cwd=where, capture_output=True, env=env)
        return {p: (Path(where) / p).read_bytes() for p in (SUMS, README) if (Path(where) / p).is_file()}
    finally:
        if tmp is not None:
            git("worktree", "remove", "--force", str(tmp), cwd=top, check=False)
            shutil.rmtree(tmp.parent, ignore_errors=True)


def on_remote(top, sha):
    return bool(out("branch", "-r", "--contains", sha, cwd=top))


def settle(hook=""):
    # A post-commit after `git commit -- paths` can inherit GIT_INDEX_FILE
    # naming git's temporary index. Settle means the real one.
    os.environ.pop("GIT_INDEX_FILE", None)
    try:
        top = out("rev-parse", "--show-toplevel")
    except RuntimeError:
        return 0
    gd = git_dir(top)
    marker = gd / MARK
    head = out("rev-parse", "HEAD", cwd=top)
    parents = len(out("rev-list", "--parents", "-n", "1", "HEAD", cwd=top).split()) - 1
    # Git never calls a driver when both sides wrote identical bytes, and two
    # tabs that each add one skill both write "1 skill" to the counts line,
    # so a missing mark proves nothing. Every real merge and every rebase is
    # checked; a plain commit is checked only when a driver left a mark.
    checked = (marker.is_file() or hook in ("post-merge", "post-rewrite-rebase")
               or (hook == "post-commit" and parents > 1))
    if not checked:
        return 0
    # Only a post-commit (or a hand run) can land mid-operation: a rebase
    # replaying picks, or a merge stopped on a real conflict, which
    # post-rewrite or the concluding commit settles instead. post-merge and
    # post-rewrite run BEFORE git deletes MERGE_HEAD and rebase-merge, so the
    # same check there swallowed every settle (measured in the test repo).
    if hook not in ("post-merge", "post-rewrite-rebase") and in_progress(gd):
        return 0
    reasons = marker.read_text(encoding="utf-8", errors="replace").strip() if marker.is_file() else ""
    if marker.is_file():
        marker.unlink()
    elif on_remote(top, head):
        # A fast-forward onto a published commit: nothing this tab merged.
        return 0
    want = regenerate(top, head)
    changed = {}
    for path, data in want.items():
        old = git("rev-parse", "--verify", "--quiet", f"HEAD:{path}", cwd=top, check=False).stdout.strip()
        new = git("hash-object", "-w", "--stdin", cwd=top, inp=data).stdout.decode().strip()
        if old != new:
            changed[path] = (old, new)
    if not changed:
        print(f"merge_regen: generated files already current after {hook or 'merge'}", file=sys.stderr)
        return 0
    if on_remote(top, head):
        # Never rewrite a published commit: leave the fix in the working tree.
        for path, (old, _new) in changed.items():
            p = Path(top) / path
            if not p.exists() or git("hash-object", str(p), cwd=top).stdout.strip() == old:
                p.write_bytes(want[path])
        print(f"merge_regen: HEAD is already on a remote, so {', '.join(changed)} were "
              f"regenerated in the working tree for the next commit", file=sys.stderr)
        return 0

    # Fold the regenerated files into HEAD with plumbing: a temporary index,
    # so the real index (which may hold another tab's staged work) is untouched.
    with tempfile.TemporaryDirectory() as d:
        env = dict(os.environ, GIT_INDEX_FILE=str(Path(d) / "index"))
        git("read-tree", "HEAD", cwd=top, env=env)
        for path, (_old, new) in changed.items():
            mode = out("ls-tree", "HEAD", "--", path, cwd=top).split(" ", 1)[0] or "100644"
            git("update-index", "--add", "--cacheinfo", f"{mode},{new},{path}", cwd=top, env=env)
        tree = git("write-tree", cwd=top, env=env).stdout.strip()
    fmt = "%an%x00%ae%x00%ad%x00%cn%x00%ce%x00%cd"
    an, ae, ad, cn, ce, cd = out("log", "-1", f"--format={fmt}", "--date=raw", "HEAD", cwd=top).split("\0")
    msg = git("log", "-1", "--format=%B", "HEAD", cwd=top).stdout
    parent_shas = out("rev-list", "--parents", "-n", "1", "HEAD", cwd=top).split()[1:]
    cenv = dict(os.environ, GIT_AUTHOR_NAME=an, GIT_AUTHOR_EMAIL=ae, GIT_AUTHOR_DATE=ad,
                GIT_COMMITTER_NAME=cn, GIT_COMMITTER_EMAIL=ce, GIT_COMMITTER_DATE=cd)
    args = ["commit-tree", tree]
    for p in parent_shas:
        args += ["-p", p]
    commit = git(*args, cwd=top, env=cenv, inp=msg).stdout.strip()
    git("update-ref", "-m", "merge_regen: regenerate generated files", "HEAD", commit, head, cwd=top)

    # Bring the index and working tree along, path by path, only where they
    # still hold the old HEAD version: anything else is somebody's edit.
    for path, (old, new) in changed.items():
        staged = out("ls-files", "-s", "--", path, cwd=top).split()
        if not staged or staged[1] == old:
            mode = staged[0] if staged else "100644"
            r = git("update-index", "--add", "--cacheinfo", f"{mode},{new},{path}", cwd=top, check=False)
            if r.returncode != 0:
                print(f"merge_regen: index busy, {path} left staged as before: {r.stderr.strip()}",
                      file=sys.stderr)
        p = Path(top) / path
        if not p.exists() or git("hash-object", str(p), cwd=top).stdout.strip() == old:
            p.write_bytes(want[path])
    print(f"merge_regen: regenerated {', '.join(sorted(changed))} into {commit[:8]} "
          f"after {hook or 'merge'} ({reasons.splitlines()[0] if reasons else 'counts or checksums were stale'})",
          file=sys.stderr)
    return 0


def main(argv):
    if len(argv) >= 1 and argv[0] == "install":
        repo = argv[argv.index("--repo") + 1] if "--repo" in argv else "."
        return install(repo)
    if len(argv) == 6 and argv[0] == "driver":
        return driver(*argv[1:])
    if argv and argv[0] == "settle":
        try:
            return settle(argv[1] if len(argv) > 1 else "")
        except Exception as e:  # noqa: BLE001 (a hook must never break the merge it follows)
            print(f"merge_regen: settle failed: {e}", file=sys.stderr)
            return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
