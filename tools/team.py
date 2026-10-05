#!/usr/bin/env python3
"""The team's task board, stored as one markdown file per task in this repo.

    team                      the board: every open task, grouped by status
    team mine                 your open tasks (TEAM_ME, else git user.name)
    team add "title" [--owner NAME --due YYYY-MM-DD --priority high
                      --done-when TEXT --labels a,b --status todo]
    team show CHW-3           one task, with its activity
    team move CHW-3 in_progress
    team assign CHW-3 Gavin
    team done CHW-3 --proof https://...
    team comment CHW-3 "text"
    team edit CHW-3 --due 2026-10-09 --title "..."
    team feed [-n 20]         recent changes, newest first
    team open [CHW-3]         the web board in a browser
    add --json to board, mine, show or feed for machine output

Caleb, 2026-10-04: one tracker the whole team uses, "same functionality as
linear bidirectional sync to the repo, so we can interact w it both through
browser anywhere and through inside of chewbacca anywhere".

THE REPO IS THE DATABASE. A task is `team/tasks/<ID>.md`. The web board
(apps/team-web) writes the same files through GitHub's contents API, so there
is no sync engine to drift: both sides read and write one branch.

WRITES NEVER TOUCH YOUR WORKING TREE. Every write builds a one-file commit on
top of the freshly fetched remote branch with a temporary index and pushes it.
This checkout is shared with whatever else is in progress in it (bin/site-gate
was modified, uncommitted, the night this was written), and a pull or a bare
`git commit` here would sweep that work into a task commit. Reads come from the
fetched remote branch too, so the CLI and the website always see the same board.
"""
import argparse
import datetime as dt
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import webbrowser

ROOT = pathlib.Path(__file__).resolve().parent.parent
TASK_DIR = "team/tasks"
STATUSES = ["inbox", "backlog", "todo", "in_progress", "in_review", "done", "canceled"]
LABELS = {"inbox": "Inbox", "backlog": "Backlog", "todo": "Todo", "in_progress": "In progress",
          "in_review": "In review", "done": "Done", "canceled": "Canceled"}
PRIORITIES = ["urgent", "high", "medium", "low", "none"]
FIELDS = ["id", "title", "status", "owner", "priority", "due", "labels",
          "done_when", "proof", "source", "created", "updated"]
ID_PREFIX = "CHW"
# A push loses the race when the website or a teammate committed in between.
# Three tries covers two writers landing in the same second; past that the
# remote is genuinely busy or rejecting, and the error should surface.
PUSH_TRIES = 3


class TeamError(Exception):
    pass


# ---------- task file format (apps/team-web/lib/task.js mirrors this) ----------

def parse(text):
    """Frontmatter of `key: value` lines between --- fences, then a markdown body."""
    lines = text.replace("\r\n", "\n").split("\n")
    if not lines or lines[0].strip() != "---":
        raise TeamError("task file has no frontmatter")
    meta, i = {}, 1
    while i < len(lines) and lines[i].strip() != "---":
        if ":" in lines[i]:
            key, value = lines[i].split(":", 1)
            meta[key.strip()] = value.strip()
        i += 1
    if i >= len(lines):
        raise TeamError("task frontmatter is not closed")
    body = "\n".join(lines[i + 1:]).strip("\n")
    task = {f: meta.get(f, "") for f in FIELDS}
    task["labels"] = [x.strip() for x in task["labels"].split(",") if x.strip()]
    notes, _, activity = body.partition("\n## Activity\n")
    if body.startswith("## Activity\n"):
        notes, activity = "", body[len("## Activity\n"):]
    task["notes"] = notes.strip()
    task["activity"] = [a[2:] for a in activity.strip().split("\n") if a.startswith("- ")]
    return task


# Terminal control bytes, minus tab and newline. A task title arrives from the
# web board or a teammate's push and gets printed raw by `team board`; an OSC 52
# sequence in it would write the clipboard of whoever ran the command
# (security review of 62e59f1, 2026-10-04).
# C1 controls (0x80-0x9f) too: 0x9b is a one-byte CSI some terminals honor.
# And the bidi overrides, which reorder a title so it reads differently than it runs.
CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]")
ACTIVITY_HEADING = "## Activity"


def clean(value):
    return CONTROL.sub("", str(value or ""))


def one_line(value):
    """Frontmatter values are single lines; a newline would end the field early."""
    return re.sub(r"\s+", " ", clean(value)).strip()


def safe_notes(notes):
    """A note line reading exactly '## Activity' would split the file there and
    turn the rest of the note into fake activity entries, so it is demoted."""
    lines = clean(notes).strip().split("\n")
    return "\n".join("### Activity" if l.strip() == ACTIVITY_HEADING else l for l in lines)


def render(task):
    out = ["---"]
    for f in FIELDS:
        v = ", ".join(task.get("labels") or []) if f == "labels" else task.get(f, "")
        out.append(f"{f}: {one_line(v)}")
    out.append("---")
    if task.get("notes"):
        out += ["", safe_notes(task["notes"])]
    out += ["", "## Activity"] + [f"- {one_line(a)}" for a in task.get("activity", [])]
    return "\n".join(out) + "\n"


def id_number(task_id):
    m = re.fullmatch(rf"{ID_PREFIX}-(\d+)", task_id or "")
    return int(m.group(1)) if m else 0


# ---------- git plumbing ----------

class Repo:
    def __init__(self, path, remote="origin", branch="main", offline=False):
        self.path = pathlib.Path(path)
        self.remote, self.branch, self.offline = remote, branch, offline
        self.ref = f"{remote}/{branch}"

    def git(self, *args, env=None, inp=None, check=True):
        p = subprocess.run(["git", "-C", str(self.path), *args], capture_output=True,
                           text=True, input=inp, env={**os.environ, **(env or {})})
        if check and p.returncode != 0:
            raise TeamError(f"git {args[0]} failed: {(p.stderr or p.stdout).strip()[:300]}")
        return p.stdout

    def fetch(self):
        if self.offline:
            return
        p = subprocess.run(["git", "-C", str(self.path), "fetch", "-q", self.remote, self.branch],
                           capture_output=True, text=True)
        if p.returncode != 0:
            print(f"team: fetch failed, showing the last fetched board ({p.stderr.strip()[:120]})",
                  file=sys.stderr)

    def files(self):
        out = self.git("ls-tree", "--name-only", self.ref, TASK_DIR + "/", check=False)
        return [f for f in out.split("\n") if f.endswith(".md")]

    def read(self, path):
        return self.git("show", f"{self.ref}:{path}")

    def tasks(self):
        out = []
        for f in self.files():
            try:
                task = parse(self.read(f))
            except TeamError as e:
                print(f"team: skipping {f}: {e}", file=sys.stderr)
                continue
            # The file name is the identity. A file whose id field disagrees
            # (CHW-5.md saying id: CHW-1) would show a second CHW-1, and editing
            # it would write the real CHW-1.md.
            if task["id"] != pathlib.PurePosixPath(f).stem:
                print(f"team: skipping {f}: its id field says {task['id']!r}", file=sys.stderr)
                continue
            out.append(task)
        return sorted(out, key=lambda t: id_number(t["id"]))

    def write_many(self, make_changes, message):
        """One commit for many files. `make_changes` returns {path: text, or None
        to delete} and reruns after a lost race, like write()."""
        if self.offline:
            raise TeamError("writes need the remote; drop --offline")
        for attempt in range(PUSH_TRIES):
            if attempt:
                self.fetch()
            parent = self.git("rev-parse", self.ref).strip()
            changes = make_changes()
            if not changes:
                return None
            with tempfile.TemporaryDirectory() as tmp:
                env = {"GIT_INDEX_FILE": os.path.join(tmp, "index")}
                self.git("read-tree", parent, env=env)
                for path, content in changes.items():
                    if content is None:
                        self.git("update-index", "--force-remove", path, env=env)
                    else:
                        blob = self.git("hash-object", "-w", "--stdin", inp=content).strip()
                        self.git("update-index", "--add", "--cacheinfo", f"100644,{blob},{path}", env=env)
                tree = self.git("write-tree", env=env).strip()
            commit = self.git("commit-tree", tree, "-p", parent, "-m", message).strip()
            p = subprocess.run(["git", "-C", str(self.path), "push", "-q", self.remote,
                                f"{commit}:refs/heads/{self.branch}"], capture_output=True, text=True)
            if p.returncode == 0:
                self.git("update-ref", f"refs/remotes/{self.ref}", commit)
                return commit
        raise TeamError(f"push kept losing the race after {PUSH_TRIES} tries: {p.stderr.strip()[:200]}")

    def write(self, path, make_content, message, create=False):
        """Commit one file on top of the remote branch and push, retrying a lost race.

        `make_content` runs again on every attempt, after the refetch, so an edit
        is reapplied to whatever the other writer committed. Re-pushing the first
        attempt's text would silently drop their change to the same task.
        """
        if self.offline:
            raise TeamError("writes need the remote; drop --offline")
        for attempt in range(PUSH_TRIES):
            if attempt:
                self.fetch()
            parent = self.git("rev-parse", self.ref).strip()
            if create and path in self.files():
                raise FileExistsError(path)
            content = make_content()
            with tempfile.TemporaryDirectory() as tmp:
                env = {"GIT_INDEX_FILE": os.path.join(tmp, "index")}
                self.git("read-tree", parent, env=env)
                blob = self.git("hash-object", "-w", "--stdin", inp=content).strip()
                self.git("update-index", "--add", "--cacheinfo", f"100644,{blob},{path}", env=env)
                tree = self.git("write-tree", env=env).strip()
            commit = self.git("commit-tree", tree, "-p", parent, "-m", message).strip()
            p = subprocess.run(["git", "-C", str(self.path), "push", "-q", self.remote,
                                f"{commit}:refs/heads/{self.branch}"], capture_output=True, text=True)
            if p.returncode == 0:
                self.git("update-ref", f"refs/remotes/{self.ref}", commit)
                return commit
        raise TeamError(f"push kept losing the race after {PUSH_TRIES} tries: {p.stderr.strip()[:200]}")


# ---------- operations ----------

def today():
    return os.environ.get("TEAM_TODAY") or dt.date.today().isoformat()


def me(repo):
    name = os.environ.get("TEAM_ME") or repo.git("config", "user.name", check=False).strip()
    members = load_members(repo)
    for m in members:
        if name and name.lower() in {(m.get("name") or "").lower(), (m.get("github") or "").lower()}:
            return m["name"]
    return name


def load_members(repo):
    try:
        return json.loads(repo.read("team/members.json"))
    except (TeamError, json.JSONDecodeError):
        return []


def resolve_owner(repo, owner):
    if not owner:
        return ""
    members = load_members(repo)
    for m in members:
        if owner.lower() in {(m.get("name") or "").lower(), (m.get("github") or "").lower()}:
            return m["name"]
    if members:
        names = ", ".join(m["name"] for m in members)
        raise TeamError(f"no team member called {owner!r}. Members: {names}")
    return owner


def check_date(value):
    if value and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise TeamError(f"dates are YYYY-MM-DD, got {value!r}")
    return value


def find(repo, task_id):
    task_id = task_id.upper()
    path = f"{TASK_DIR}/{task_id}.md"
    if not re.fullmatch(rf"{ID_PREFIX}-\d+", task_id) or path not in repo.files():
        raise TeamError(f"no task {task_id}")
    task = parse(repo.read(path))
    if task["id"] != task_id:
        raise TeamError(f"{path} has a mismatched id field ({task['id']!r})")
    return task


def log(task, who, text):
    task.setdefault("activity", []).append(f"{today()} {who or 'someone'}: {text}")


def create(repo, task):
    task["updated"] = today()
    path = f"{TASK_DIR}/{task['id']}.md"
    repo.write(path, lambda: render(task), f"team: {task['id']} created: {task['title']}", create=True)


def add(repo, a):
    status = a.status or "todo"
    if status not in STATUSES:
        raise TeamError(f"status is one of {', '.join(STATUSES)}")
    if a.priority and a.priority not in PRIORITIES:
        raise TeamError(f"priority is one of {', '.join(PRIORITIES)}")
    task = {"title": one_line(a.title), "status": status,
            "owner": resolve_owner(repo, a.owner), "priority": a.priority or "none",
            "due": check_date(a.due or ""), "labels": [x.strip() for x in (a.labels or "").split(",") if x.strip()],
            "done_when": a.done_when or "", "proof": "", "source": one_line(getattr(a, "source", "") or ""),
            "created": today(), "notes": a.notes or ""}
    if not task["title"]:
        raise TeamError("a task needs a title")
    for _ in range(PUSH_TRIES):
        task["id"] = f"{ID_PREFIX}-{max([id_number(t['id']) for t in repo.tasks()] + [0]) + 1}"
        task["activity"] = []
        log(task, me(repo), "created")
        try:
            create(repo, task)
            return task
        except FileExistsError:
            repo.fetch()
    raise TeamError("could not claim a free task id")


def update(repo, task_id, verb, apply=None, message=None, **changes):
    """Read, change and write one task; the read and change rerun if the push races."""
    task_id, who, result = task_id.upper(), me(repo), {}

    def build():
        task = find(repo, task_id)
        task.update(changes)
        if apply:
            apply(task)
        log(task, who, verb)
        task["updated"] = today()
        result["task"] = task
        return render(task)

    find(repo, task_id)  # a missing task fails before any git work
    repo.write(f"{TASK_DIR}/{task_id}.md", build, f"team: {task_id} {message or verb}")
    return result["task"]


# ---------- commits -> tasks ----------

# A commit that says "fixes CHW-12" closes the task with the commit as proof; any
# other mention moves a not-started task to In progress. GitHub Actions can't do
# this here (jobs refuse to start on this account's billing, 2026-10-04), so the
# CLI and the web board each run it against the newest commits on main. Both are
# idempotent: a commit already in a task's activity is never logged twice.
TASK_REF = re.compile(r"\bCHW-(\d+)\b", re.I)
CLOSING_REF = re.compile(r"\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s*:?\s+CHW-(\d+)\b", re.I)
# How far back each sync looks. A busy day here was 94 commits (2026-09-20), so
# 120 covers a full day of pushes between two syncs.
LINK_WINDOW = 120


# Only the subject line and trailer-style body lines count ("Fixes CHW-2", "Refs CHW-3,
# CHW-4"). On 2026-10-04 the commit that shipped this feature explained it in its
# own body ('"fixes CHW-12" closes it') and the sync closed CHW-12 with that commit
# as proof. Prose that mentions an id is a description, not an instruction.
TRAILER = re.compile(r"^\s*(?:(fix(?:es|ed)?|close[sd]?|resolve[sd]?)|refs?|part of)?\s*:?\s*((?:CHW-\d+[\s,]*)+)$", re.I)


def parse_commit_refs(subject, body):
    """(referenced ids, closing ids) for one commit, or two empty sets for task commits."""
    if subject.startswith("team:") or subject.startswith("Merge "):
        return set(), set()
    refs = {f"{ID_PREFIX}-{int(n)}" for n in TASK_REF.findall(subject)}
    closing = {f"{ID_PREFIX}-{int(n)}" for n in CLOSING_REF.findall(subject)}
    for line in body.splitlines():
        m = TRAILER.match(line)
        if not m:
            continue
        ids = {f"{ID_PREFIX}-{int(n)}" for n in TASK_REF.findall(m.group(2))}
        refs |= ids
        if m.group(1):
            closing |= ids
    return refs, closing


def apply_commit(task, sha, who, subject, url, closing, date):
    """Mutate one task for one commit. False when this commit is already logged on it."""
    if any(f"commit {sha[:7]}" in a for a in task["activity"]):
        return False
    task["activity"].append(f"{date} {who}: commit {sha[:7]} {one_line(subject)[:160]}")
    if closing and task["status"] != "done":
        task["status"] = "done"
        task["proof"] = task["proof"] or url
    elif task["status"] in ("inbox", "backlog", "todo"):
        task["status"] = "in_progress"
    task["updated"] = date
    return True


def repo_web_url(repo):
    url = repo.git("remote", "get-url", repo.remote, check=False).strip()
    m = re.search(r"github\.com[:/]([^/]+/[^/]+?)(?:\.git)?$", url)
    return f"https://github.com/{m.group(1)}" if m else ""


def link_commits(repo):
    """Log recent commits onto the tasks they mention. Returns how many task updates landed."""
    out = repo.git("log", f"-{LINK_WINDOW}", "--format=%H%x1f%an%x1f%ad%x1f%s%x1f%b%x1e", "--date=short",
                   repo.ref, check=False)
    commits = []
    for rec in out.split("\x1e"):
        parts = rec.strip("\n").split("\x1f")
        if len(parts) < 5:
            continue
        sha, author, date, subject, body = parts[:5]
        refs, closing = parse_commit_refs(subject, body)
        if refs:
            commits.append((sha, author, date, subject, refs, closing))
    if not commits:
        return 0
    members = load_members(repo)
    base = repo_web_url(repo)
    result = {"n": 0}

    def changes():
        tasks = {t["id"]: t for t in repo.tasks()}
        touched = set()
        for sha, author, date, subject, refs, closing in reversed(commits):  # oldest first
            who = next((m["name"] for m in members if author.lower() in
                        {(m.get("name") or "").lower(), (m.get("github") or "").lower()}), author)
            for tid in sorted(refs):
                if tid in tasks and apply_commit(tasks[tid], sha, who, subject,
                                                 f"{base}/commit/{sha}" if base else sha, tid in closing, date):
                    touched.add(tid)
        result["n"] = len(touched)
        return {f"{TASK_DIR}/{tid}.md": render(tasks[tid]) for tid in touched}

    repo.write_many(changes, "team: link commits to tasks")
    return result["n"]


# ---------- import ----------

# Sections of BACKLOG.md that hold work still to do. Done and Dead are history,
# and "Other task owners" belongs to other tasks by the file's own contract.
IMPORT_SECTIONS = {"Now": ("high", "now"), "Next": ("medium", "next"), "Blocked": ("none", "blocked"),
                   "Deferred": ("low", "deferred"), "Verification gaps": ("medium", "verify")}


def read_backlog(text, source_name="BACKLOG.md"):
    """Rows of the BACKLOG.md status tables as task dicts, in file order. Pure: writes nothing."""
    rows, section = [], None
    for line in text.splitlines():
        if line.startswith("## "):
            section = line[3:].strip()
            continue
        if section not in IMPORT_SECTIONS or not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 6 or not re.fullmatch(r"\d+", cells[0]):
            continue
        num, item, status, evidence, deps, accept = cells[:6]
        priority, label = IMPORT_SECTIONS[section]
        notes = "\n".join(x for x in (
            f"Backlog status: {status}.",
            f"Acceptance: {accept}" if accept else "",
            f"Evidence: {evidence}" if evidence else "",
            f"Depends on: {deps}" if deps and deps.lower() != "none" else "",
        ) if x)
        rows.append({"title": one_line(item), "status": "inbox", "owner": "", "priority": priority,
                     "due": "", "labels": ["backlog", label], "done_when": one_line(accept)[:600],
                     "proof": "", "source": f"{source_name} CB-{num}", "notes": notes})
    return rows


def plan_import(repo, rows):
    """Which rows would be created: anything whose source is not already on the board."""
    have = {t["source"] for t in repo.tasks() if t["source"]}
    return [r for r in rows if r["source"] not in have]


def apply_import(repo, rows, who):
    def changes():
        fresh = plan_import(repo, rows)
        next_id = max([id_number(t["id"]) for t in repo.tasks()] + [0]) + 1
        out = {}
        for i, row in enumerate(fresh):
            task = {**row, "id": f"{ID_PREFIX}-{next_id + i}", "created": today(), "updated": today(),
                    "activity": [f"{today()} {who or 'someone'}: imported from {row['source']}"]}
            out[f"{TASK_DIR}/{task['id']}.md"] = render(task)
        result["count"] = len(out)
        return out

    result = {"count": 0}
    repo.write_many(changes, f"team: import {len(rows)} items from {rows[0]['source'].split(' ')[0] if rows else 'nothing'}")
    return result["count"]


def remove_imported(repo, prefix):
    """Undo: delete only tasks whose source starts with `prefix` and nobody has touched
    (still in the inbox, unassigned, one activity line). Touched ones are kept."""
    result = {"removed": 0, "kept": 0}

    def changes():
        out, kept = {}, 0
        for t in repo.tasks():
            if not t["source"].startswith(prefix):
                continue
            if t["status"] == "inbox" and not t["owner"] and len(t["activity"]) <= 1:
                out[f"{TASK_DIR}/{t['id']}.md"] = None
            else:
                kept += 1
        result.update(removed=len(out), kept=kept)
        return out

    repo.write_many(changes, f"team: remove untouched imports from {prefix}")
    return result


# ---------- display ----------

def overdue(task):
    return bool(task["due"]) and task["due"] < today() and task["status"] not in ("done", "canceled")


def line(t):
    t = {k: one_line(v) if isinstance(v, str) else v for k, v in t.items()}
    due = f" due {t['due']}" + (" OVERDUE" if overdue(t) else "") if t["due"] else ""
    owner = f"  @{t['owner']}" if t["owner"] else "  unassigned"
    pri = f" [{t['priority']}]" if t["priority"] not in ("", "none") else ""
    return f"  {t['id']:<7} {t['title']}{pri}{owner}{due}"


def board(tasks, show_closed=False):
    out = []
    for s in STATUSES:
        group = [t for t in tasks if t["status"] == s]
        if s == "inbox" and len(group) > 8 and not show_closed:
            out.append(f"INBOX ({len(group)}, newest 8; team inbox for all)")
            out += [line(t) for t in group[-8:]]
            out.append("")
            continue
        if s in ("done", "canceled") and not show_closed:
            if group:
                out.append(f"{LABELS[s]}: {len(group)} (team board --all to list)")
            continue
        if group:
            out.append(f"{LABELS[s].upper()} ({len(group)})")
            out += [line(t) for t in group]
            out.append("")
    return "\n".join(out).strip() or "No tasks yet. Add one: team add \"title\" --owner NAME --due YYYY-MM-DD"


def config(repo):
    try:
        return json.loads(repo.read("team/config.json"))
    except (TeamError, json.JSONDecodeError):
        return {}


def main(argv=None):
    ap = argparse.ArgumentParser(prog="team", description="The team task board in this repo.")
    ap.add_argument("--repo", default=os.environ.get("CHEWBACCA_TEAM_REPO") or str(ROOT))
    ap.add_argument("--offline", action="store_true", help="read the last fetched board, no network")
    sub = ap.add_subparsers(dest="cmd")
    b = sub.add_parser("board"); b.add_argument("--all", action="store_true"); b.add_argument("--json", action="store_true")
    m = sub.add_parser("mine"); m.add_argument("--json", action="store_true")
    x = sub.add_parser("add"); x.add_argument("title")
    for flag in ("--owner", "--due", "--priority", "--done-when", "--labels", "--status", "--notes", "--source"):
        x.add_argument(flag)
    s = sub.add_parser("show"); s.add_argument("id"); s.add_argument("--json", action="store_true")
    mv = sub.add_parser("move"); mv.add_argument("id"); mv.add_argument("status", choices=STATUSES)
    asg = sub.add_parser("assign"); asg.add_argument("id"); asg.add_argument("owner")
    d = sub.add_parser("done"); d.add_argument("id"); d.add_argument("--proof", default="")
    c = sub.add_parser("comment"); c.add_argument("id"); c.add_argument("text")
    e = sub.add_parser("edit"); e.add_argument("id")
    for flag in ("--title", "--due", "--priority", "--done-when", "--labels", "--proof", "--notes"):
        e.add_argument(flag)
    f = sub.add_parser("feed"); f.add_argument("-n", type=int, default=20); f.add_argument("--json", action="store_true")
    o = sub.add_parser("open"); o.add_argument("id", nargs="?")
    sub.add_parser("sync", help="log recent commits that mention a task onto it")
    ib = sub.add_parser("inbox"); ib.add_argument("--json", action="store_true")
    im = sub.add_parser("import", help="preview, then --apply, BACKLOG.md rows into the inbox")
    im.add_argument("file", nargs="?", default=str(ROOT / "BACKLOG.md")); im.add_argument("--apply", action="store_true")
    un = sub.add_parser("unimport", help="remove untouched imported tasks whose source starts with PREFIX")
    un.add_argument("prefix")
    a = ap.parse_args(argv)
    repo = Repo(a.repo, offline=a.offline)

    try:
        repo.fetch()
        cmd = a.cmd or "board"
        if not a.offline and cmd not in ("import", "unimport"):
            try:
                linked = link_commits(repo)
                if linked:
                    print(f"team: logged recent commits on {linked} task(s)", file=sys.stderr)
            except TeamError as err:
                print(f"team: commit sync skipped: {err}", file=sys.stderr)
        if cmd == "board":
            tasks = repo.tasks()
            print(json.dumps(tasks, indent=1) if getattr(a, "json", False) else board(tasks, getattr(a, "all", False)))
        elif cmd == "mine":
            who = me(repo)
            tasks = [t for t in repo.tasks() if t["owner"].lower() == who.lower() and t["status"] not in ("done", "canceled")]
            if a.json:
                print(json.dumps(tasks, indent=1))
            else:
                print(f"{who or 'You'}: {len(tasks)} open")
                print("\n".join(line(t) for t in tasks) or "  nothing assigned")
        elif cmd == "add":
            t = add(repo, a)
            print(f"{t['id']} created: {t['title']}")
        elif cmd == "show":
            t = find(repo, a.id)
            if a.json:
                print(json.dumps(t, indent=1))
            else:
                print(f"{t['id']}  {t['title']}\n  status {LABELS.get(t['status'], t['status'])}, owner {t['owner'] or 'unassigned'}, "
                      f"priority {t['priority'] or 'none'}, due {t['due'] or 'none'}")
                for k in ("done_when", "proof"):
                    if t[k]:
                        print(f"  {k.replace('_', ' ')}: {t[k]}")
                if t["labels"]:
                    print(f"  labels: {', '.join(t['labels'])}")
                if t["notes"]:
                    print("\n" + t["notes"])
                if t["activity"]:
                    print("\nActivity:\n" + "\n".join(f"  {x}" for x in t["activity"]))
        elif cmd == "move":
            t = update(repo, a.id, f"moved to {LABELS[a.status]}", status=a.status)
            print(f"{t['id']} is {LABELS[a.status]}")
        elif cmd == "assign":
            owner = resolve_owner(repo, a.owner)
            t = update(repo, a.id, f"assigned to {owner}", owner=owner)
            print(f"{t['id']} assigned to {owner}")
        elif cmd == "done":
            if not a.proof and not find(repo, a.id)["proof"]:
                raise TeamError("done needs proof: --proof <link, video or commit>")
            changes = {"status": "done", **({"proof": a.proof} if a.proof else {})}
            t = update(repo, a.id, "done" + (f", proof {a.proof}" if a.proof else ""), **changes)
            print(f"{t['id']} done")
        elif cmd == "comment":
            text = one_line(a.text)
            if not text:
                raise TeamError("a comment needs text")
            t = update(repo, a.id, text, message="comment")
            print(f"comment added to {t['id']}")
        elif cmd == "edit":
            changes = {}
            for k in ("title", "due", "priority", "done_when", "proof", "notes"):
                v = getattr(a, k)
                if v is not None:
                    changes[k] = check_date(v) if k == "due" else v
            if a.labels is not None:
                changes["labels"] = [x.strip() for x in a.labels.split(",") if x.strip()]
            if "priority" in changes and changes["priority"] not in PRIORITIES:
                raise TeamError(f"priority is one of {', '.join(PRIORITIES)}")
            if not changes:
                raise TeamError("nothing to edit; pass --title, --due, --priority, --done-when, --labels, --proof or --notes")
            t = update(repo, a.id, "edited " + ", ".join(k.replace("_", " ") for k in changes), **changes)
            print(f"{t['id']} updated")
        elif cmd == "feed":
            out = repo.git("log", f"-{a.n}", "--format=%h%x09%ad%x09%an%x09%s", "--date=format:%Y-%m-%d %H:%M",
                           repo.ref, "--", TASK_DIR, check=False)
            rows = [dict(zip(("sha", "when", "who", "what"), r.split("\t"))) for r in out.strip().split("\n") if r]
            print(json.dumps(rows, indent=1) if a.json else "\n".join(f"{r['when']}  {r['who']:<16} {r['what']}" for r in rows) or "No activity yet.")
        elif cmd == "sync":
            print("team: commits and tasks are in sync")
        elif cmd == "inbox":
            tasks = [t for t in repo.tasks() if t["status"] == "inbox"]
            print(json.dumps(tasks, indent=1) if a.json else f"Inbox: {len(tasks)}\n" + "\n".join(line(t) for t in tasks))
        elif cmd == "import":
            path = pathlib.Path(a.file)
            rows = read_backlog(path.read_text(), path.name)
            fresh = plan_import(repo, rows)
            if not a.apply:
                print(f"{len(rows)} open items in {path.name}, {len(fresh)} not on the board yet.")
                print("\n".join(f"  {r['source']:<18} [{r['labels'][1]}] {r['title']}" for r in fresh[:15]))
                if len(fresh) > 15:
                    print(f"  ... and {len(fresh) - 15} more")
                print("Nothing written. Run again with --apply to add them to the inbox in one commit.")
            else:
                n = apply_import(repo, rows, me(repo))
                print(f"{n} tasks added to the inbox from {path.name}")
        elif cmd == "unimport":
            r = remove_imported(repo, a.prefix)
            print(f"removed {r['removed']} untouched imported tasks; kept {r['kept']} someone had touched")
        elif cmd == "open":
            url = str(config(repo).get("url") or "")
            if not url:
                raise TeamError("team/config.json has no url yet")
            # config.json is editable by anyone with push access; only a web page opens.
            if not re.fullmatch(r"https://[^\s]+", url):
                raise TeamError("team/config.json url must be an https:// address")
            url = f"{url.rstrip('/')}/#{a.id.upper()}" if a.id else url
            webbrowser.open(url)
            print(url)
        return 0
    except TeamError as err:
        print(f"team: {err}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
