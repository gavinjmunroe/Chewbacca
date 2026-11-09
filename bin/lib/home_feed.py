"""The feed behind Kyber's home panel: ~/.bob/home-panel.json.

The graph supplies the calendar and the to-dos (osgraph_walks.home); this
adds the projects and the to-dos crossed off on the panel, and writes the file
the panel watches. The surfaces daemon writes it after every ingest, beside
badges.json, and `kyber-surfaces home` prints or writes it on demand.

Projects are the person's own list when they pinned one, in their order, each
with its newest commit across the repositories named for it. Otherwise a
project is a repository under one of the roots whose last commit by the
person (git's user.email) is inside the window. Commits by anyone else do not
count: a fork that only took upstream's merges is not something he is
working on, and neither do his own `chore:` commits. Worktrees (a `.git` file,
not a directory) are left out, because they are a second checkout of a
repository already listed.

Personal choices live in ~/.chewbacca/home-panel.json, never here:

    {"projects": {"pinned": [{"title": "Music", "paths": ["~/dev/studio"]}],
                  "roots": ["~/dev"], "hide": ["gavin-context"],
                  "names": {"oakleysarshar0": "Oakley consulting"}}}

A to-do crossed off on the panel (`kyber-surfaces home --done <id>`) is
finished in its own app where that app can be written: Reminders, the people
store's tasks, and the coursework ledger. Anything else (a backlog row, whose
file belongs to a team repository, or a promise taken from a meeting) is only
crossed off here. Either way it is recorded in ~/.bob/home-done.json and stays
on the list, struck through, until the day ends. After that the app is the
truth for what it was written to, and the record for what it was not.

A to-do typed on the panel (`kyber-surfaces home --add <text>`) goes into
Reminders, his default list, with no date. It is recorded in
~/.bob/home-added.json so the panel shows it for a day whatever the cap.
"""
from __future__ import annotations

import fcntl
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

# Crossed-off to-dos, beside the feed.
DONE_NAME = "home-done.json"
# A crossed-off row stays struck through for the rest of the day it was
# crossed, so a misclick is seen and can be undone; after that it leaves. A
# record whose app was written to is kept this long, for nothing but the
# undo of a ledger row; a panel-only one is kept as long as its row exists.
# Guessed, never measured.
DONE_KEEP_DAYS = 30
# Struck-through rows shown at once. Crossing off a dozen in an evening grew
# the list past the five-row budget (HOME_TODOS) and pushed the projects off a
# laptop-sized panel (review, 2026-10-11); the latest few are the ones a
# misclick is among. Guessed.
DONE_SHOWN = 3
# Of the five open rows, how many a to-do for someone is sure of. On
# 2026-10-11 the two people rows, "Do Reagan's stuff" and the Zelle, had no
# date and sorted 8th and 9th of 9 behind seven dated ones, so the handle
# press he asked for that day was never on the panel. Classwork gives up the
# places, and it is also on the calendar as "6 due". Guessed, never measured.
PEOPLE_SLOTS = 2
# To-dos added on the panel, beside the feed.
ADDED_NAME = "home-added.json"
# A to-do added on the panel is shown whatever the cap for this long. On
# 2026-10-16 four overdue reminders and a dated one already held the five
# places, and an undated one sorts last, so the row he had just typed would
# not have been on the panel at all. Guessed, never measured.
ADDED_KEEP_H = 24
# Reminders takes any length; past this it was pasted, not typed, and the
# graph clips a title at 100 anyway (osgraph_ingest.reminders). Guessed.
ADDED_MOST_CHARS = 200
# Where the person's own commands live when Kyber, launched with launchd's
# bare PATH, runs a refresh: `mac` and `people` in ~/.local/bin, node for
# `people` from Homebrew.
TOOL_DIRS = ("~/.local/bin", "/opt/homebrew/bin", "/usr/local/bin")
# A write-back that hangs (Reminders asking for access, a locked people
# store) must not hold the panel's process. Guessed.
TOOL_TIMEOUT_S = 15

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


def expand(path: str, home: Path) -> Path:
    return home / path[2:] if path.startswith("~/") else Path(path)


def last_commit(repo: Path, author: str, since: str = "") -> tuple[str, str] | None:
    """(when, subject) of the newest commit in `repo` by `author` that is not
    a chore, or None."""
    # Chores are upkeep, not the work: Loyola Studio's only commits in the
    # week to 2026-10-11 were a nightly job's "chore: nightly brain run",
    # which kept it top of the list while nobody touched it.
    args = ["log", "-1", "--invert-grep", "--grep=^chore", "--format=%cI%x1f%s"]
    if since:
        args.insert(2, f"--since={since}")
    if author:
        args.insert(1, f"--author={author}")
    line = _git(args, repo)
    if "\x1f" not in line:
        return None
    at, said = line.split("\x1f", 1)
    return at, said


def pinned(items: list, home: Path, author: str) -> list[dict]:
    """The person's own list, in their order. A project may name several
    repositories (a consulting practice with one per client); its row shows
    the newest commit across them and opens that one. A project with no
    commit of theirs still shows, quietly, and opens its first repository."""
    rows = []
    for item in items:
        if not isinstance(item, dict) or not str(item.get("title") or "").strip():
            continue
        named = item.get("paths") or ([item["path"]] if item.get("path") else [])
        repos = [expand(str(p), home) for p in named if isinstance(p, str)]
        repos = [r for r in repos if (r / ".git").exists()]
        newest = None
        for repo in repos:
            found = last_commit(repo, author)
            if found and (newest is None or osgraph_walks.when_of(found[0]) > osgraph_walks.when_of(newest[1])):
                newest = (repo, found[0], found[1])
        title = str(item["title"]).strip()
        path = newest[0] if newest else (repos[0] if repos else None)
        rows.append({"id": f"project:{title}", "title": title,
                     "detail": subject(newest[2]) if newest else "", "at": newest[1] if newest else "",
                     "path": str(path) if path else ""})
    return rows


def projects(now: datetime, home: Path, config: dict, email: str | None = None,
             most: int = osgraph_walks.HOME_ROWS) -> list[dict]:
    """The person's pinned projects, or else the repositories they committed
    to inside the window, newest first: {id, title, detail, at, path}."""
    settings = config.get("projects") or {}
    author = email if email is not None else me_email()
    if isinstance(settings.get("pinned"), list):
        return pinned(settings["pinned"], home, author)
    roots = [str(r) for r in settings.get("roots") or DEFAULT_ROOTS]
    hide = {str(h).casefold() for h in settings.get("hide") or []}
    names = {str(k).casefold(): str(v) for k, v in (settings.get("names") or {}).items()}
    since = (now - timedelta(days=PROJECT_DAYS)).isoformat()
    rows = []
    for repo in candidates(roots, home):
        if repo.name.casefold() in hide:
            continue
        found = last_commit(repo, author, since)
        if not found:
            continue
        at, said = found
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


def build(graph, now: datetime, project_rows: list[dict], errors=None, written: datetime | None = None,
          done: dict | None = None, agent: dict | None = None, added: dict | None = None) -> dict:
    """`written` is when the graph was last ingested, if not now: the panel
    shows the feed's age from `at`, so a graph nobody refreshes says so.
    `done` is the crossed-off record (load_done), `agent` the runs handed
    to the agent from the panel (home_agent.load), and `added` the to-dos
    typed on the panel (load_added)."""
    body = osgraph_walks.home(graph, now, most_todos=None)
    body["todos"], body["todoCount"] = crossed(body["todos"], done or {}, now,
                                               keep=waiting(agent) | fresh(added, now))
    if agent:
        import home_agent  # noqa: PLC0415  it imports this module

        body["todos"] = home_agent.annotate(body["todos"], agent, now)
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


# ── crossed off ──────────────────────────────────────────────────────────


class Refused(Exception):
    """A cross-off or undo that cannot happen, said in a line for the panel."""


def done_path(feed: Path) -> Path:
    return feed.with_name(DONE_NAME)


def load_done(path: Path) -> dict:
    return {k: v for k, v in read(path).items() if isinstance(v, dict)}


def _crossed_at(record: dict) -> datetime | None:
    try:
        at = datetime.fromisoformat(str(record.get("at") or ""))
    except ValueError:
        return None
    return at if at.tzinfo else at.astimezone()


def waiting(agent: dict | None) -> set[str]:
    """The to-dos with a run out or a draft waiting on his press, which are
    shown past the cap. An answer that only says "yours" or "failed" takes
    its place in the list like any other row, so old ones never pile up."""
    return {k for k, v in (agent or {}).items() if v.get("state") in ("working", "drafted")}


def crossed(rows: list[dict], done: dict, now: datetime,
            most: int = osgraph_walks.HOME_TODOS, keep=()) -> tuple[list[dict], int]:
    """The to-dos with the crossed-off record applied: open rows first, up to
    `most`, then the last few crossed off today, struck through, in the order
    they were crossed. A row finished in its own app has left the graph by the
    next ingest, so today's are drawn from the record.

    After the day it was crossed, a row whose app was written to is whatever
    that app says: gone once it is finished there, and open again if it is
    not (a failed write, or a repeating reminder, which Reminders keeps under
    the same id with its next date). Only a panel-only row stays hidden by the
    record. The count is what is still open. A row in `keep` (one the agent
    is working on, or has a draft for) is shown whatever the cap, in its
    place: a text waiting on his send must never be one of the rows cut. Up
    to PEOPLE_SLOTS of the rest go to to-dos for someone, also in place."""
    today = now.date()

    def crossed_today(record: dict) -> bool:
        at = _crossed_at(record)
        return at is not None and at.astimezone(now.tzinfo).date() == today

    def hides(record: dict) -> bool:
        return crossed_today(record) or (not record.get("wrote") and not record.get("failed"))

    by_id = {r["id"]: r for r in rows}
    open_rows = [r for r in rows if r["id"] not in done or not hides(done[r["id"]])]
    struck = []
    for rid, record in sorted(done.items(), key=lambda item: str(item[1].get("at") or "")):
        if not crossed_today(record):
            continue
        row = by_id.get(rid) or {"id": rid, "title": str(record.get("title") or ""),
                                 "detail": str(record.get("detail") or ""), "day": str(record.get("day") or ""),
                                 "overdue": False}
        if record.get("failed"):
            row = {**row, "detail": f"Still open in {record['failed']}"}
        struck.append({**row, "done": True, "reopen": bool(record.get("reopen", True))})
    kept = {r["id"] for r in open_rows if r["id"] in keep}
    # Up to PEOPLE_SLOTS of the places go to to-dos for someone first, so the
    # ones the agent can take are on the panel however their dates sort.
    held = sum(1 for r in open_rows if r["id"] in kept and r.get("person"))
    people = [r["id"] for r in open_rows if r.get("person") and r["id"] not in kept]
    kept |= set(people[:max(0, min(PEOPLE_SLOTS, most) - held)])
    room = [r["id"] for r in open_rows if r["id"] not in kept][:max(0, most - len(kept))]
    shown = [r for r in open_rows if r["id"] in kept or r["id"] in room]
    return shown + struck[-DONE_SHOWN:], len(open_rows)


def tool_env(home: Path) -> dict:
    env = dict(os.environ)
    have = [p for p in env.get("PATH", "").split(":") if p]
    extra = [str(expand(d, home)) for d in TOOL_DIRS]
    env["PATH"] = ":".join([d for d in extra if d not in have] + have)
    return env


def run_tool(argv: list[str], home: Path) -> tuple[int, str]:
    """(exit code, stdout, or what went wrong)."""
    try:
        done = subprocess.run(argv, capture_output=True, text=True, timeout=TOOL_TIMEOUT_S, env=tool_env(home))
    except (OSError, subprocess.TimeoutExpired) as err:
        return 1, str(err)
    return done.returncode, done.stdout if done.returncode == 0 else (done.stderr or done.stdout).strip()


def _reminder_id(row_id: str, run) -> str:
    """The Reminders id behind a graph task: the ingest keyed it by the
    reminder's id and title (osgraph_ingest.reminders), so the open
    reminders are listed and keyed the same way."""
    code, out = run(["mac", "reminders", "list", "--json"])
    if code != 0:
        raise Refused(f"Reminders could not be read: {out[:120]}")
    try:
        listed = json.loads(out or "[]")
    except json.JSONDecodeError:
        raise Refused("Reminders answered with something that is not JSON") from None
    for row in listed if isinstance(listed, list) else []:
        if isinstance(row, dict) and row.get("id") and row.get("title") and \
                osgraph.node_key("task", "reminders", row["id"], row["title"]) == row_id:
            return str(row["id"])
    raise Refused("That reminder is no longer open in Reminders.")


def _assignment(row_id: str, run) -> tuple[Path, str]:
    """The ledger file and exact name behind a graph assignment, keyed the way
    osgraph_ingest.coursework keys it."""
    code, out = run(["coursework", "due", "--days", "400", "--json"])
    if code != 0:
        raise Refused(f"The coursework ledger could not be read: {out[:120]}")
    try:
        body = json.loads(out or "{}")
    except json.JSONDecodeError:
        raise Refused("coursework answered with something that is not JSON") from None
    if not isinstance(body, dict):
        raise Refused("coursework answered with something that is not a ledger")
    for bucket in ("overdue", "upcoming", "undated"):
        for row in body.get(bucket) or []:
            if isinstance(row, dict) and row.get("name") and row.get("file") and \
                    osgraph.node_key("assignment", "coursework", str(row.get("course") or ""), row["name"]) == row_id:
                return Path(row["file"]), str(row["name"])
    raise Refused("That assignment is not in the coursework ledger.")


def _scalar(text: str) -> str:
    """A YAML scalar as written on one line: quotes taken off, and a trailing
    comment, as the coursework CLI reads it."""
    text = text.strip()
    quoted = re.match(r"""^(["'])(.*)\1\s*(?:#.*)?$""", text)
    if quoted:
        inner = quoted.group(2)
        return inner.replace('\\"', '"') if quoted.group(1) == '"' else inner.replace("''", "'")
    return re.sub(r"\s+#.*$", "", text)


def set_status(path: Path, name: str, status: str) -> str:
    """Set one deliverable's `status:` in a coursework ledger file, touching
    that line and no other, so his comments, quoting and order survive. A
    deliverable with no status line gets one under its name. Returns the
    status it had, empty when it had none."""
    lines = path.read_text().splitlines(keepends=True)
    start, indent = None, 0
    for i, line in enumerate(lines):
        m = re.match(r"^(\s*)-\s+name:\s*(.*?)\s*$", line)
        if m and _scalar(m.group(2)) == name:
            if start is not None:
                raise Refused(f"Two deliverables are named {name!r} in {path.name}.")
            start, indent = i, len(m.group(1)) + 2
    if start is None:
        raise Refused(f"No deliverable named {name!r} in {path.name}.")
    found = None
    for j in range(start + 1, len(lines)):
        line = lines[j]
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        depth = len(line) - len(line.lstrip())
        if depth < indent:
            break
        if depth == indent and line.lstrip().startswith("status:"):
            found = j
            break
    was = ""
    if found is None:
        lines.insert(start + 1, " " * indent + f"status: {status}\n")
    else:
        was = _scalar(lines[found].split(":", 1)[1])
        comment = re.search(r"\s+#.*$", lines[found].rstrip("\n"))
        lines[found] = " " * indent + f"status: {status}" + (comment.group(0) if comment else "") + "\n"
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as out:
            out.write("".join(lines))
        os.chmod(tmp, path.stat().st_mode & 0o777)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return was


def _prune(done: dict, now: datetime, live: set[str]) -> dict:
    """Drop what no longer needs remembering: a written-back record after
    DONE_KEEP_DAYS, and a panel-only one once its row has left the graph."""
    keep = now - timedelta(days=DONE_KEEP_DAYS)
    return {k: v for k, v in done.items()
            if (k in live if not v.get("wrote") and not v.get("failed") else (_crossed_at(v) or now) >= keep)}


class _Locked:
    """One cross-off or undo at a time. Each reads the record, waits on an app
    for seconds, then writes the record back, so two crossed a second apart
    ran side by side and the second write dropped the first (review,
    2026-10-11: two threads, a 1 s tool delay, one cross-off lost)."""

    def __init__(self, record: Path):
        self.path = record.with_name(f".{record.name}.lock")

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o600)
        fcntl.flock(self.fd, fcntl.LOCK_EX)
        return self

    def __exit__(self, *_):
        fcntl.flock(self.fd, fcntl.LOCK_UN)
        os.close(self.fd)


def cross(graph, row_id: str, now: datetime, path: Path, home: Path | None = None, run=None) -> str:
    """Cross a to-do off: in its own app where that app can be written, and
    in the panel's record either way. A write that fails is recorded too and
    shown on the row ("Still open in Reminders"), never dropped quietly."""
    home = home or Path.home()
    run = run or (lambda argv: run_tool(argv, home))
    with _Locked(path):
        return _cross(graph, row_id, now, path, run)


def _cross(graph, row_id: str, now: datetime, path: Path, run) -> str:
    done = load_done(path)
    if row_id in done:
        return "Already crossed off."
    node = graph.node(row_id)
    if not node or node["type"] not in ("Task", "Assignment"):
        raise Refused("That is not a to-do the panel knows.")
    props = node.get("props") or {}
    record = {"title": node["label"], "day": osgraph_walks.due_day(graph, row_id) or "",
              "at": now.isoformat(), "wrote": "", "reopen": True}
    try:
        if node["type"] == "Assignment":
            file, name = _assignment(row_id, run)
            was = set_status(file, name, "done")
            record.update(wrote="coursework", file=str(file), name=name, was=was or "todo")
        elif row_id.startswith("task:people:"):
            code, out = run(["people", "task", "done", row_id.split(":", 2)[2][:6]])
            if code != 0:
                raise Refused(out[:120] or "people task done failed")
            # The people store has no undo for a finished task.
            record.update(wrote="people", reopen=False)
        elif props.get("app") == "Reminders":
            code, out = run(["mac", "reminders", "complete", _reminder_id(row_id, run), "--quiet"])
            if code != 0:
                raise Refused(out[:120] or "mac reminders complete failed")
            # `mac reminders` can complete a reminder and cannot reopen one.
            record.update(wrote="Reminders", reopen=False)
    except (Refused, OSError) as err:
        app = "the ledger" if node["type"] == "Assignment" else (
            "Reminders" if props.get("app") == "Reminders" else "the people store")
        record.update(failed=app, why=str(err)[:200])
    done[row_id] = record
    live = {r["id"] for r in osgraph_walks.home_todos(graph, now, most=None)[0]}
    write(_prune(done, now, live | {row_id}), path)
    if record.get("failed"):
        return f"Crossed off here; still open in {record['failed']}: {record['why']}"
    return f"Crossed off in {record['wrote']}." if record["wrote"] else "Crossed off on the panel."


def uncross(row_id: str, path: Path) -> str:
    """Undo a cross-off where its app can take it back: the ledger and the
    panel's own record. Reminders and the people store cannot reopen."""
    with _Locked(path):
        return _uncross(row_id, path)


def _uncross(row_id: str, path: Path) -> str:
    done = load_done(path)
    record = done.get(row_id)
    if record is None:
        return "Not crossed off."
    if not record.get("reopen", True) and not record.get("failed"):
        raise Refused(f"Done in {record.get('wrote') or 'its app'}; reopen it there.")
    if record.get("wrote") == "coursework" and not record.get("failed"):
        set_status(Path(record["file"]), str(record["name"]), str(record.get("was") or "todo"))
    del done[row_id]
    write(done, path)
    return "Back on the list."


# ── added on the panel ───────────────────────────────────────────────────


def added_path(feed: Path) -> Path:
    return feed.with_name(ADDED_NAME)


def load_added(path: Path) -> dict:
    return {k: v for k, v in read(path).items() if isinstance(v, dict)}


def fresh(added: dict | None, now: datetime) -> set[str]:
    """The to-dos typed on the panel in the last ADDED_KEEP_H hours, which
    are shown whatever the cap."""
    since = now - timedelta(hours=ADDED_KEEP_H)
    return {k for k, v in (added or {}).items() if (at := _crossed_at(v)) is not None and at >= since}


def add(title: str, now: datetime, path: Path, home: Path | None = None, run=None) -> tuple[str, str]:
    """Add a to-do to Reminders, on his default list with no date, and record
    it so the feed keeps it on the panel. Returns the row id the next
    Reminders ingest gives it (osgraph_ingest.reminders) and a line to say."""
    words = " ".join(title.split())
    if not words:
        raise Refused("Type the to-do first.")
    if len(words) > ADDED_MOST_CHARS:
        raise Refused(f"That is {len(words)} characters; keep a to-do under {ADDED_MOST_CHARS}.")
    home = home or Path.home()
    run = run or (lambda argv: run_tool(argv, home))
    code, out = run(["mac", "reminders", "add", words, "--json"])
    if code != 0:
        raise Refused(out[:120] or "mac reminders add failed")
    try:
        made = json.loads(out)
    except json.JSONDecodeError:
        made = None
    rid = made.get("id") if isinstance(made, dict) else None
    if not isinstance(rid, str) or not rid:
        # It may well be in Reminders; only its place on the panel is unknown.
        return "", "Added to Reminders; it shows here after the next pass."
    row_id = osgraph.node_key("task", "reminders", rid, str(made.get("title") or words))
    with _Locked(path):
        since = now - timedelta(hours=ADDED_KEEP_H)
        kept = {k: v for k, v in load_added(path).items() if (at := _crossed_at(v)) is not None and at >= since}
        kept[row_id] = {"title": words, "at": now.isoformat(), "reminder": rid}
        write(kept, path)
    return row_id, "Added to Reminders."
