"""Fresh content snapshots; child repositories are explicit separate scopes.

No metadata cache substitutes for reading bytes. The stability checks catch
ordinary concurrent writers; this is not an atomic filesystem transaction.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def git(repo, *args):
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, timeout=30)
    if result.returncode:
        raise ValueError("git could not read the repository state")
    return result.stdout


def repository_files(repo):
    tracked = set(git(repo, "ls-files", "-z").split(b"\0")) - {b""}
    untracked = set(git(repo, "ls-files", "--others", "--exclude-standard", "-z").split(b"\0")) - {b""}
    # Without --directory, Git emits directory names only for embedded repos.
    # The parent baseline made 262 extra rev-parse calls for these same markers.
    boundaries = {name for name in untracked - tracked if name.endswith(b"/")}
    return tracked | untracked, boundaries


def revision(repo):
    try:
        return git(repo, "rev-parse", "--verify", "HEAD").decode().strip()
    except ValueError:
        # Distinguish an unborn branch from an unreadable/corrupt revision.
        branch = git(repo, "symbolic-ref", "-q", "HEAD").decode().strip()
        if git(repo, "for-each-ref", "--format=%(refname)", branch).strip():
            raise ValueError("could not resolve repository HEAD")
        return "UNBORN"


def signature(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def file_signature(path):
    try:
        return signature(path.lstat())
    except FileNotFoundError:
        return None


def file_entry(repo, raw_name, boundaries):
    name = os.fsdecode(raw_name)
    path = repo / name
    try:
        info = path.lstat()
    except FileNotFoundError:
        return [name, "deleted"], None
    before = signature(info)
    mode = stat.S_IMODE(info.st_mode)
    if raw_name in boundaries and stat.S_ISDIR(info.st_mode):
        # Child contents may change independently; only its boundary is bound.
        return [name, "separate_repository", mode], (info.st_dev, info.st_ino, info.st_mode)
    if stat.S_ISLNK(info.st_mode):
        entry = [name, "symlink", mode, os.readlink(path)]
    elif stat.S_ISREG(info.st_mode):
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        with os.fdopen(os.open(path, flags), "rb") as source:
            opened = os.fstat(source.fileno())
            if not stat.S_ISREG(opened.st_mode) or signature(opened) != before:
                raise ValueError("repository file changed during snapshot")
            hasher = hashlib.sha256()
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                hasher.update(chunk)
            if signature(os.fstat(source.fileno())) != before:
                raise ValueError("repository file changed during snapshot")
        entry = [name, "file", mode, hasher.hexdigest()]
    else:
        raise ValueError("submodules and special files require a separate review scope")
    if file_signature(path) != before:
        raise ValueError("repository file changed during snapshot")
    return entry, before


def _snapshot_data(repo, *, workers=4):
    repo = Path(repo).resolve()
    if Path(os.fsdecode(git(repo, "rev-parse", "--show-toplevel")).strip()).resolve() != repo:
        raise ValueError("snapshot requires a repository root")
    head = revision(repo)
    index = git(repo, "ls-files", "--stage", "-z")
    if git(repo, "ls-files", "--unmerged", "-z"):
        raise ValueError("unmerged index cannot be reviewed")
    if any(record.startswith(b"160000 ") for record in index.split(b"\0")):
        raise ValueError("submodules and special files require a separate review scope")
    header = {"repo": str(repo), "head": head, "index": digest(index),
              "staged": digest(git(repo, "diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv")),
              "unstaged": digest(git(repo, "diff", "--binary", "--no-ext-diff", "--no-textconv"))}
    names, boundaries = repository_files(repo)
    ordered = sorted(names)
    if workers == 1:
        results = [file_entry(repo, name, boundaries) for name in ordered]
    else:
        # Bounded threads overlap fresh reads and SHA256 without a persistent cache.
        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(lambda name: file_entry(repo, name, boundaries), ordered))
    for raw_name, (entry, before) in zip(ordered, results):
        after = file_signature(repo / os.fsdecode(raw_name))
        if entry[1] == "separate_repository":
            after = after[:3] if after else None
        if after != before:
            raise ValueError("repository file changed during snapshot")
    if (revision(repo) != head or git(repo, "ls-files", "--stage", "-z") != index
            or repository_files(repo) != (names, boundaries)):
        raise ValueError("repository state changed during snapshot")
    index_entries = {}
    for record in index.split(b"\0"):
        if record:
            metadata, name = record.split(b"\t", 1)
            index_entries.setdefault(os.fsdecode(name), []).append(metadata.decode().split())
    return {"state": header, "files": [entry for entry, _ in results]}, index_entries


def snapshot_manifest(repo, *, workers=4):
    manifest, index_entries = _snapshot_data(repo, workers=workers)
    return dict(manifest, index_entries=index_entries)


def snapshot_details(repo):
    manifest = snapshot_manifest(repo)
    return {"digest": digest(canonical(manifest)), "head": manifest["state"]["head"],
            "files": manifest["files"], "index_entries": manifest["index_entries"]}


def snapshot(repo):
    return snapshot_details(repo)["digest"]
