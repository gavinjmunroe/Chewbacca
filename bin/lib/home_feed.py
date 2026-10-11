"""The feed behind Kyber's home panel: ~/.bob/home-panel.json.

The graph supplies the calendar, the to-dos and the people
(osgraph_walks.home); this adds the projects, which are git repositories the
person committed to lately, and writes the file the panel watches. The
surfaces daemon writes it after every ingest, beside badges.json, and
`kyber-surfaces home` prints or writes it on demand.

A project is a repository under one of the roots whose last commit by the
person (git's user.email) is inside the window. Commits by anyone else do not
count: a fork that only took upstream's merges is not something he is
working on, and neither do his own `chore:` commits. Worktrees (a `.git` file, not a directory) are left out, because
they are a second checkout of a repository already listed.

Personal choices live in ~/.chewbacca/home-panel.json, never here:

    {"projects": {"roots": ["~/dev"], "hide": ["gavin-context"],
                  "names": {"oakleysarshar0": "Oakley consulting"}}}
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

import osgraph
import osgraph_walks

# The Chewbacca checkout this file lives in, so the project itself is found
# wherever it was cloned.
REPO = Path(__file__).resolve().parents[2]
DEFAULT_ROOTS = ("~/dev", "~/Developer", "~/Projects", "~/code", "~/src")
# A week of his commits on 2026-10-11 held the repos the brain lists as live
# (Firm Foundation, Oakley, noahstudio, Chewbacca, the Chase Durkin and Popoff
# sites). Guessed from that one look, never checked against what he would pick.
PROJECT_DAYS = 7
# Every repo under ~/dev took 0.27 s to read on 2026-10-11, and the daemon
# writes the feed every ingest (each minute with a panel open, each five
# otherwise), so the scan is kept this long between reads.
PROJECT_TTL_S = 300
# Per repository. That whole scan of about thirty took 0.27 s on 2026-10-11, so
# three seconds is only ever a hung git (a network mount, a lock). Guessed.
GIT_TIMEOUT_S = 3
PREFIX = re.compile(r"^(feat|fix|chore|docs|refactor|test|perf|style|build|ci|memory|research|init)(\([^)]*\))?!?:\s*",
                    re.I)

_cache: dict = {"at": 0.0, "key": None, "rows": []}


def config_path(home: Path) -> Path:
    return Path(os.environ.get("KYBER_HOME_CONFIG") or home / ".chewbacca" / "home-panel.json")


def load_config(path: Path) -> dict:
    try:
        body = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return body if isinstance(body, dict) else {}


def pretty(name: str) -> str:
    """'firm-foundation' reads as 'Firm Foundation'."""
    words = [w for w in re.split(r"[-_\s]+", name) if w]
    return " ".join(w[:1].upper() + w[1:] for w in words) or name


def subject(line: str) -> str:
    """A commit subject without its conventional prefix, first letter up."""
    text = PREFIX.sub("", line.strip())
    return text[:1].upper() + text[1:]


def _git(args: list[str], cwd: Path) -> str:
    try:
        done = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, timeout=GIT_TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return done.stdout.strip() if done.returncode == 0 else ""


def me_email() -> str:
    return _git(["config", "--global", "user.email"], REPO)


def candidates(roots: list[str], home: Path) -> list[Path]:
    """Every repository directly under a root, plus the Chewbacca checkout.
    A root written `~/x` is under `home`, so a test's home is the only one read."""
    found: dict[str, Path] = {}
    for root in roots:
        base = home / root[2:] if root.startswith("~/") else Path(root)
        if (base / ".git").is_dir():
            found[str(base.resolve())] = base
            continue
        try:
            children = sorted(base.iterdir())
        except OSError:
            continue
        for child in children:
            if (child / ".git").is_dir():
                found[str(child.resolve())] = child
    if (REPO / ".git").is_dir():
        found.setdefault(str(REPO.resolve()), REPO)
    return list(found.values())


def projects(now: datetime, home: Path, config: dict, email: str | None = None,
             most: int = osgraph_walks.HOME_ROWS) -> list[dict]:
    """The repositories the person committed to inside the window, newest
    first: {id, title, detail, at, path}."""
    settings = config.get("projects") or {}
    roots = [str(r) for r in settings.get("roots") or DEFAULT_ROOTS]
    hide = {str(h).casefold() for h in settings.get("hide") or []}
    names = {str(k).casefold(): str(v) for k, v in (settings.get("names") or {}).items()}
    author = email if email is not None else me_email()
    since = (now - timedelta(days=PROJECT_DAYS)).isoformat()
    rows = []
    for repo in candidates(roots, home):
        if repo.name.casefold() in hide:
            continue
        # Chores are upkeep, not the work: Loyola Studio's only commits in the
        # week to 2026-10-11 were a nightly job's "chore: nightly brain run",
        # which kept it top of the list while nobody touched it.
        args = ["log", "-1", f"--since={since}", "--invert-grep", "--grep=^chore", "--format=%cI%x1f%s"]
        if author:
            args.insert(1, f"--author={author}")
        line = _git(args, repo)
        if "\x1f" not in line:
            continue
        at, said = line.split("\x1f", 1)
        rows.append({"id": f"repo:{repo}", "title": names.get(repo.name.casefold()) or pretty(repo.name),
                     "detail": subject(said), "at": at, "path": str(repo)})
    rows.sort(key=lambda r: osgraph_walks.when_of(r["at"]), reverse=True)
    return rows[:most]


def cached_projects(now: datetime, clock: float, home: Path) -> list[dict]:
    settings = load_config(config_path(home))
    key = json.dumps([str(home), settings.get("projects") or {}], sort_keys=True)
    if _cache["key"] == key and clock - _cache["at"] < PROJECT_TTL_S:
        return _cache["rows"]
    rows = projects(now, home, settings)
    _cache.update(at=clock, key=key, rows=rows)
    return rows


def build(graph, now: datetime, project_rows: list[dict], errors=None, written: datetime | None = None) -> dict:
    """`written` is when the graph was last ingested, if not now: the panel
    shows the feed's age from `at`, so a graph nobody refreshes says so."""
    body = osgraph_walks.home(graph, now)
    body["at"] = (written or now).isoformat()
    body["projects"] = project_rows
    # A source that failed is named, so an empty list is never mistaken for a
    # clear day (the surfaces' own rule, walks.py).
    body["failed"] = sorted(errors or [])
    return body


def graph_written(path: Path) -> datetime | None:
    """When the graph file last changed. Every ingest rewrites each source's
    rows (Graph.apply), so this is when the daemon last ran one."""
    stamps = [p.stat().st_mtime for p in (path, Path(f"{path}-wal")) if p.exists()]
    return datetime.fromtimestamp(max(stamps)).astimezone() if stamps else None


def read(path: Path) -> dict:
    try:
        body = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return body if isinstance(body, dict) else {}


def write(body: dict, path: Path) -> None:
    """Atomically and owner-only, and out of Time Machine like the graph: it
    holds names and the last line of texts. A temp name of its own, since the
    daemon and Kyber's refresh can write at the same moment."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as out:
            json.dump(body, out, default=str)
        # The exclusion is a property of the file, and the rename replaces the
        # file, so it goes on the new one before it takes the name.
        osgraph.exclude_from_backups(tmp)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
