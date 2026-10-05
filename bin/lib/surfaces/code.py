"""code: what changed in the repos under ~/code, and the diff, on the glass.

Replaces opening VS Code to look at what changed. Every repo under the code
root with uncommitted changes, or with a Claude or Codex session in it, is one
row: its branch, how far it is ahead of and behind its upstream, how many
files changed, and whether an agent is in it. A repo's row opens its changed
files; a file's Diff draws `git diff` in the Diff component, and Preview draws
the file itself in a File component.

READ ONLY. Nothing on this panel stages, commits, checks out, stashes or
discards. Git is asked to `status` and `diff`, and to `config --list`,
`ls-tree` and `ls-files` to decide whether those two are safe to run. Every
call carries `--no-optional-locks`, so a status never rewrites the index. The
File component is never given `editable`, because its save overwrites the
path.

WHAT A REPO'S CONFIG MAY RUN. Git runs programs named in config: fsmonitor on
a status, an external diff driver, textconv, and the clean, smudge and process
commands of a filter driver, which a `.gitattributes` line in the tree picks.
The first three are switched off on every call. A filter cannot be switched off
by one flag, so before any status or diff the repo's config is listed, and
every filter driver defined anywhere but Caleb's own global or system config is
blanked with `-c filter.<name>.clean=` (and smudge, process, `required=false`).
A driver name git could not take back on a `-c` line fails the repo closed.
Submodules are compared by commit only (`--ignore-submodules=dirty`), because
a status inside one would run that submodule's config. Global filters such as
git-lfs are Caleb's choice and stay on. What is left open: a config written
between the listing and the status, inside one 30 s refresh.

WHAT A PRESS MAY NAME. A row's id is only a lookup key: a press is honoured
only when its id is exactly a repo, or a repo and a path, that the last fetch
read out of git itself, and the path is checked again at the press. Preview
draws only a regular text file whose fully resolved path is still inside its
repo and outside `.git`, so a symlink in a repo cannot point the glass at
~/.ssh. Binary files and files over PREVIEW_MAX_BYTES are named, not drawn,
and a tracked file over DIFF_MAX_BYTES on either side is not diffed.

UNTRUSTED TEXT. File names, diffs and file contents were written by whoever
wrote the code, including code cloned from strangers into ~/code/refs. They
are only drawn: every Unicode control and format character (categories C*,
which holds the bidi overrides and marks of Trojan Source, CVE-2021-42574, the
zero-width and tag characters and the soft hyphen) and the line and paragraph
separators are stripped before anything reaches the HUD, and every value
goes out inside a JSON string on a `d` line. Preview hands the HUD a path, not
text, and the File view draws its name as given, so a file whose path holds
any of those characters is refused by Preview rather than drawn.

Running sessions come from `kyber-sessions --json`, the same discovery the
sessions surface uses. Only its `state`, `agent` and `cwd` are read, and a
cwd counts only when it resolves inside the code root: a transcript is untrusted and does
not get to point git at a folder nobody chose.
"""
from __future__ import annotations

import codecs
import json
import os
import re
import stat
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path, PurePosixPath

from . import ACTION_PREFIX, Bind, Context, Provider, Result, SurfaceError, ago, clip, comp, note_for

# Miller's seven plus two, the same cap kyber-sessions puts on its list.
MAX_REPOS = 9
# kyber-sessions' card lists 12 changed files (git_changes); the same here so
# the two panels agree on what "the changes" are.
MAX_FILES = 12
# The Diff component draws the LAST 600 lines (hud/CLAUDE.md, and
# DiffView's `suffix(600)` in hud/Sources/KyberKit/SessionViews.swift). A diff
# is read from the top, so it keeps 599 lines and the 600th says how much is
# left; at 600 plus the note the view dropped line one, the `diff --git` header
# that names the file (verifier, 2026-10-05).
DIFF_LINES = 600
# A minified bundle line can run to megabytes. Guessed, never measured.
LINE_CHARS = 400
# Preview draws text through the File component. Guessed, never measured: a
# megabyte of source is longer than anything anyone reads off a panel.
PREVIEW_MAX_BYTES = 1 << 20
# A tracked file's diff reads both sides whole before anything is cut.
# Measured 2026-10-05: a modified 95 MB text file took 4.0 s and about 929 MB
# peak RSS in the long-lived daemon, to draw 600 lines. Either side over this
# is named, not diffed. The bar matches Preview's.
DIFF_MAX_BYTES = PREVIEW_MAX_BYTES
# How much of a file is read to decide it is text: git's own heuristic looks
# for a NUL in the first 8000 bytes (xdiff-interface.c, FIRST_FEW_BYTES).
SNIFF_BYTES = 8000
# Measured 2026-10-05: `git status` over the 72 repos two levels under ~/code
# took 1.8 s one after another. Eight at a time is guessed, never measured.
WORKERS = 8
# Groups under the code root that are not work. Measured 2026-10-05:
# archive/2026-code-root, the pre-reorg ~/code, showed 9,803 changed paths
# and would have sat on top of every real repo.
SKIP_GROUPS = frozenset({"archive", "node_modules"})
# kyber-sessions states that mean an agent is in the repo now.
LIVE_STATES = {"working": "working", "needs": "needs you"}
# kyber-sessions' `agent` field. Seen 2026-10-05: 168 claude rows and 20 codex
# rows. Anything else is drawn as "Agent", never as its raw value.
AGENT_NAMES = {"claude": "Claude", "codex": "Codex"}
# Config scopes a repo cannot write. A filter driver defined only here is
# Caleb's own (git-lfs is, in ~/.gitconfig) and stays on.
TRUSTED_SCOPES = frozenset({"global", "system"})

# The global switches every git call here carries. --no-optional-locks keeps a
# status from refreshing and rewriting the index (the panel promises it never
# writes); core.fsmonitor names a program git would run on every status.
GIT = ["git", "--no-pager", "--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false",
       "-c", "color.ui=never"]
DIFF_FLAGS = ["--no-color", "--no-ext-diff", "--no-textconv", "--ignore-submodules=dirty"]

KINDS = {"M": "modified", "A": "added", "D": "deleted", "R": "renamed", "C": "copied",
         "T": "type changed", "U": "conflict", "?": "new"}


def clean(text: str) -> str:
    """Text from a repo with every control, format and bidi character removed:
    the whole C category (as github.py drops it) and the line and paragraph
    separators, keeping tab and newline. A hand list missed U+061C, the Arabic
    letter mark, which reached the glass in a file name (verifier, 2026-10-05)."""
    s = str(text or "")
    if s.replace("\t", "").replace("\n", "").isprintable():
        return s
    return "".join(ch for ch in s if ch in "\t\n" or not (
        unicodedata.category(ch)[0] == "C" or unicodedata.category(ch) in ("Zl", "Zp")))


def run_git(ctx: Context, argv: list) -> tuple[int, str, str]:
    """ctx.run, with output that isn't UTF-8 (a Latin-1 file's diff, a
    file name in another encoding) as a failed call instead of a crash."""
    try:
        return ctx.run(argv)
    except UnicodeDecodeError:
        return 1, "", "git printed something that isn't UTF-8 text"


def filter_guard(ctx: Context, root: str) -> list[str] | None:
    """The `-c` switches that blank every filter driver the repo's own config
    (or anything it includes) defines, or None when the config can't be read
    or names a driver a `-c` line can't take back. Reproduced 2026-10-05: a
    `filter.pwn.clean` in .git/config and `* filter=pwn` in .gitattributes ran
    its command on `git diff HEAD`, with every other switch here already on."""
    code, out, _ = run_git(ctx, GIT + ["-C", root, "config", "--list", "--show-scope", "-z"])
    if code != 0:
        return None
    tokens = out.split("\0")
    names: set[str] = set()
    for scope, entry in zip(tokens[0::2], tokens[1::2]):
        key = entry.split("\n", 1)[0]
        if scope in TRUSTED_SCOPES or not key.lower().startswith("filter."):
            continue
        rest = key[len("filter."):]
        if "." not in rest:
            continue
        name = rest.rsplit(".", 1)[0]
        if not name or any(ch in name for ch in "=\n\0"):
            return None
        names.add(name)
    guard: list[str] = []
    for name in sorted(names):
        for var in ("clean", "smudge", "process"):
            guard += ["-c", f"filter.{name}.{var}="]
        guard += ["-c", f"filter.{name}.required=false"]
    return guard


def label(text: str, limit: int) -> str:
    return clip(clean(text), limit)


def sessions_cli() -> str:
    """bin/kyber-sessions beside this package, so a checkout uses its own."""
    here = Path(__file__).resolve().parents[2] / "kyber-sessions"
    return str(here) if here.exists() else "kyber-sessions"


def code_root(ctx: Context) -> Path:
    return Path(ctx.env.get("KYBER_CODE_ROOT") or ctx.home / "code")


def candidates(root: Path) -> list[Path]:
    """Every repo at <root>/<repo> or <root>/<group>/<repo>, the layout of
    ~/code since 2026-10-03. Links are not followed: a link in ~/code is not a
    repo anyone put there."""
    found: list[Path] = []
    try:
        top = sorted(root.iterdir())
    except OSError as err:
        raise SurfaceError(f"Can't read {root}: {err.strerror or err}") from None
    for child in top:
        if child.name.startswith(".") or child.name in SKIP_GROUPS or child.is_symlink() or not child.is_dir():
            continue
        if (child / ".git").exists():
            found.append(child)
            continue
        try:
            inner = sorted(child.iterdir())
        except OSError:
            continue
        for repo in inner:
            if repo.name.startswith(".") or repo.is_symlink() or not repo.is_dir():
                continue
            if (repo / ".git").exists():
                found.append(repo)
    return found


def toplevel(cwd: str, root: Path) -> Path | None:
    """The repo a session's folder is in, only when it is inside the code
    root. A worktree under <repo>/.claude/worktrees/ is its own repo."""
    try:
        real = Path(cwd).resolve(strict=True)
        base = root.resolve(strict=True)
    except (OSError, RuntimeError, ValueError):
        return None
    if not real.is_relative_to(base):
        return None
    probe = real
    while probe != base and probe.is_relative_to(base):
        if (probe / ".git").exists():
            return probe
        probe = probe.parent
    return None


def parse_status(out: str) -> dict:
    """`git status --porcelain=v2 --branch -z`: branch, ahead, behind and the
    changed paths, exactly as git wrote them."""
    info = {"branch": "", "oid": "", "upstream": "", "ahead": 0, "behind": 0, "files": []}
    tokens = out.split("\0")
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        i += 1
        if not tok:
            continue
        if tok.startswith("# "):
            key, _, value = tok[2:].partition(" ")
            if key == "branch.head":
                info["branch"] = value
            elif key == "branch.oid":
                info["oid"] = value
            elif key == "branch.upstream":
                info["upstream"] = value
            elif key == "branch.ab":
                m = re.fullmatch(r"\+(\d+) -(\d+)", value)
                if m:
                    info["ahead"], info["behind"] = int(m.group(1)), int(m.group(2))
            continue
        kind = tok[0]
        if kind == "?" and tok.endswith("/"):
            # Even with -uall, a repo nested inside this one (a worktree
            # under .claude/worktrees/, a clone in a subfolder) is one entry
            # ending in "/": a folder with no diff and no preview. It is its
            # own repo, not a change in this one (verifier, 2026-10-05).
            continue
        if kind == "?":
            info["files"].append({"rel": tok[2:], "orig": "", "code": "?", "sub": False})
        elif kind == "1":
            parts = tok.split(" ", 8)
            if len(parts) == 9:
                xy = parts[1]
                info["files"].append({"rel": parts[8], "orig": "", "code": xy[1] if xy[1] != "." else xy[0],
                                      "sub": parts[2] != "N..."})
        elif kind == "2":
            parts = tok.split(" ", 9)
            orig = tokens[i] if i < len(tokens) else ""
            i += 1  # the original path is its own NUL-separated token
            if len(parts) == 10:
                info["files"].append({"rel": parts[9], "orig": orig, "code": parts[1][0] if parts[1][0] != "." else "R",
                                      "sub": parts[2] != "N..."})
        elif kind == "u":
            parts = tok.split(" ", 10)
            if len(parts) == 11:
                info["files"].append({"rel": parts[10], "orig": "", "code": "U", "sub": False})
    return info


def file_id(key: str, rel: str) -> str:
    """A changed file's row id: the repo key and the path, as JSON, so no
    separator inside a file name can make it name another file."""
    return json.dumps([key, rel], ensure_ascii=False)


def safe_path(root: str, rel: str) -> Path | None:
    """The file `rel` names, only if it is a regular file whose fully resolved
    path is inside the repo and outside `.git`."""
    if not rel or "\0" in rel or rel.startswith("/"):
        return None
    parts = PurePosixPath(rel).parts
    if ".." in parts or ".git" in parts:
        return None
    try:
        base = Path(root).resolve(strict=True)
        real = (Path(root) / rel).resolve(strict=True)
        mode = real.stat().st_mode
    except (OSError, RuntimeError, ValueError):
        return None
    if not real.is_relative_to(base) or ".git" in real.relative_to(base).parts:
        return None
    return real if stat.S_ISREG(mode) else None


def text_problem(path: Path) -> str:
    """Why a file can't be drawn as text, or "" when it can."""
    try:
        size = path.stat().st_size
        with path.open("rb") as f:
            head = f.read(SNIFF_BYTES)
    except OSError as err:
        return f"can't be read ({err.strerror or err})"
    if size > PREVIEW_MAX_BYTES:
        return f"is {size >> 10} KB, too big to draw"
    if b"\0" in head:
        return "is binary"
    try:
        codecs.getincrementaldecoder("utf-8")().decode(head, final=False)
    except UnicodeDecodeError:
        return "isn't UTF-8 text"
    return ""


def render_diff(out: str) -> str:
    """At most DIFF_LINES lines including the note, so the view's last-600 cut
    never takes the header. Cut before cleaning, so a huge diff is not walked
    character by character."""
    lines = str(out or "").split("\n")
    while lines and not lines[-1]:
        lines.pop()
    note = []
    if len(lines) > DIFF_LINES:
        rest = len(lines) - (DIFF_LINES - 1)
        lines, note = lines[: DIFF_LINES - 1], [f"… {rest} more lines not drawn"]
    lines = [clean(line) if len(line) <= LINE_CHARS else clean(line[: LINE_CHARS - 1]) + "…" for line in lines]
    return "\n".join(lines + note)


class Code(Provider):
    name = "code"
    title = "CODE"
    region = "center"
    # kyber-sessions draws its File surface 520 wide; a diff needs the room.
    width = 560
    # Measured 2026-10-05: one `kyber-sessions --json` took 1.6 s cold (188
    # transcripts) and the status scan about 0.3 s; every 30 s keeps that
    # under a tenth of a core. The interval itself is guessed.
    refresh = 30.0
    replaces = "VS Code (reading what changed)"

    def __init__(self) -> None:
        super().__init__()
        self.actions = {
            f"{ACTION_PREFIX}repo": self.pick_repo,
            f"{ACTION_PREFIX}diff": self.diff,
            f"{ACTION_PREFIX}preview": self.preview,
        }

    # ── fetch ────────────────────────────────────────────────────────────

    def live_sessions(self, ctx: Context, root: Path) -> tuple[dict, str]:
        """{repo path: (state, agent name)} for every session working or
        waiting in a repo under the root, and a line when the sessions could
        not be read."""
        try:
            code, out, err = ctx.run([sessions_cli(), "--json"])
        except UnicodeDecodeError:
            code, out, err = 1, "", "not UTF-8"
        if code != 0:
            return {}, f"sessions unavailable ({label(err or out, 60)})"
        try:
            rows = json.loads(out or "[]")
        except json.JSONDecodeError:
            return {}, "sessions unavailable (not JSON)"
        live: dict[str, tuple[str, str]] = {}
        for s in rows if isinstance(rows, list) else []:
            if not isinstance(s, dict):
                continue
            state = str(s.get("state") or "")
            if state not in LIVE_STATES:
                continue
            repo = toplevel(str(s.get("cwd") or ""), root)
            if repo is None:
                continue
            agent = AGENT_NAMES.get(str(s.get("agent") or "").lower(), "Agent")
            # "needs" outranks "working" when two sessions share a repo.
            if live.get(str(repo), ("",))[0] != "needs":
                live[str(repo)] = (state, agent)
        return live, ""

    def status(self, ctx: Context, repo: Path) -> dict | None:
        guard = filter_guard(ctx, str(repo))
        if guard is None:
            return None
        # -uall: with the default, a new folder is one entry ending in "/",
        # which is a directory and has neither a diff nor a preview
        # (components/tts/v4/ in TTS-Dev, 2026-10-05).
        code, out, _ = run_git(ctx, GIT + guard + ["-C", str(repo), "status", "--porcelain=v2", "--branch", "-z",
                                                   "--untracked-files=all", "--ignore-submodules=dirty"])
        if code != 0:
            return None
        info = parse_status(out)
        info["root"] = str(repo)
        return info

    def fetch(self, ctx: Context) -> dict:
        try:
            # Canonical once, so a session's resolved cwd and a scanned repo
            # compare equal even when ~/code is reached through a link.
            root = code_root(ctx).resolve(strict=True)
        except (OSError, RuntimeError):
            raise SurfaceError(f"There's no {code_root(ctx)} to read.") from None
        repos = candidates(root)
        live, sessions_note = self.live_sessions(ctx, root)
        known = {str(r) for r in repos}
        # A session in a worktree (<repo>/.claude/worktrees/x) is its own repo.
        repos += [Path(p) for p in live if p not in known]
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            results = list(pool.map(lambda r: self.status(ctx, r), repos))
        unread = sum(1 for r in results if r is None)
        rows = []
        for info in results:
            if info is None:
                continue
            state, agent = live.get(info["root"], ("", ""))
            if not info["files"] and not state:
                continue
            for f in info["files"]:
                try:
                    f["mtime"] = (Path(info["root"]) / f["rel"]).lstat().st_mtime
                except (OSError, ValueError):
                    f["mtime"] = 0.0
            info["files"].sort(key=lambda f: f["mtime"], reverse=True)
            info["total"] = len(info["files"])
            info["files"] = info["files"][:MAX_FILES]
            info["edited"] = max((f["mtime"] for f in info["files"]), default=0.0)
            info["session"] = state
            info["agent"] = agent
            try:
                info["key"] = str(Path(info["root"]).relative_to(root))
            except ValueError:
                info["key"] = info["root"]
            rows.append(info)
        # An agent in the repo first, then the most recently touched.
        rows.sort(key=lambda r: (r["session"] == "", -r["edited"]))
        names: dict[str, int] = {}
        for r in rows:
            names[Path(r["key"]).name] = names.get(Path(r["key"]).name, 0) + 1
        for r in rows:
            short = Path(r["key"]).name
            r["name"] = label(short if names[short] == 1 else r["key"], 40)
        return {"repos": rows[:MAX_REPOS], "more": max(0, len(rows) - MAX_REPOS),
                "unread": unread, "sessions": sessions_note}

    # ── drawing ──────────────────────────────────────────────────────────

    def layout(self) -> list[str]:
        return [
            comp(self.cid("s"), "Screen", title=self.title),
            comp(self.cid("note"), "Text", value=Bind(self.p("note")), tone="muted"),
            comp(self.cid("repos"), "Table", columns=Bind(self.p("columns")), rows=Bind(self.p("repos")),
                 action=f"{ACTION_PREFIX}repo", actionLabel="Open"),
            comp(self.cid("head"), "Text", value=Bind(self.p("head"))),
            comp(self.cid("files"), "List", items=Bind(self.p("files")), action=f"{ACTION_PREFIX}diff",
                 actionLabel="Diff"),
            comp(self.cid("preview"), "Button", label="Preview", action=f"{ACTION_PREFIX}preview"),
            comp(self.cid("diff"), "Diff", text=Bind(self.p("diff"))),
            # Never `editable`: its save would overwrite the file.
            comp(self.cid("file"), "File", path=Bind(self.p("path"))),
            comp(self.cid("status"), "Text", value=Bind(self.p("status")), tone="muted"),
            f"> {self.cid('s')} {self.cid('note')} {self.cid('repos')} {self.cid('head')} {self.cid('files')} "
            f"{self.cid('preview')} {self.cid('diff')} {self.cid('file')} {self.cid('status')}",
            f"r {self.cid('s')}",
        ]

    def initial(self) -> dict:
        return {
            self.p("repo"): "", self.p("file"): "", self.p("diff"): "", self.p("path"): "", self.p("status"): "",
            self.p("columns"): [{"field": "repo", "label": "Repo"}, {"field": "branch", "label": "Branch"},
                                {"field": "sync", "label": "Sync"}, {"field": "changes", "label": "Changed"},
                                {"field": "agent", "label": "Agent"}],
        }

    def repo_for(self, data, key: str) -> dict | None:
        matches = [r for r in (data or {}).get("repos") or [] if r["key"] == key]
        return matches[0] if len(matches) == 1 else None

    def shown_repo(self, data, values: dict) -> dict | None:
        """For display: the picked repo, else the first."""
        repos = (data or {}).get("repos") or []
        return self.repo_for(data, str(values.get(self.p("repo")) or "")) or (repos[0] if repos else None)

    @staticmethod
    def sync(r: dict) -> str:
        if not r["upstream"]:
            return "no upstream"
        bits = ([f"↑{r['ahead']}"] if r["ahead"] else []) + ([f"↓{r['behind']}"] if r["behind"] else [])
        return " ".join(bits) or "even"

    @staticmethod
    def agent(r: dict) -> str:
        if r.get("session") not in LIVE_STATES:
            return ""
        return f"{r.get('agent') or 'Agent'} {LIVE_STATES[r['session']]}"

    @staticmethod
    def branch(r: dict) -> str:
        return label(r["branch"] if r["branch"] and r["branch"] != "(detached)" else "detached", 28)

    def file_rows(self, r: dict) -> list[dict]:
        out = []
        for f in r["files"]:
            word = "submodule" if f["sub"] else KINDS.get(f["code"], "changed")
            name = f"{clean(f['orig'])} → {clean(f['rel'])}" if f["orig"] else clean(f["rel"])
            out.append({"id": file_id(r["key"], f["rel"]), "text": clip(f"{word}  {name}", 72)})
        return out

    def model(self, data, error, values, ctx) -> dict:
        if data is None:
            return {self.p("note"): note_for(None, error, ""), self.p("repos"): [], self.p("files"): [],
                    self.p("head"): ""}
        now = ctx.now()
        repos = data["repos"]
        extras = []
        if data.get("more"):
            extras.append(f"{data['more']} more repos not shown")
        if data.get("unread"):
            extras.append(f"{data['unread']} couldn't be read")
        if data.get("sessions"):
            extras.append(data["sessions"])
        empty = "Nothing uncommitted under ~/code, and no agent working." if not repos else ""
        note = note_for(data, error, empty, data.get("_at"))
        note = ". ".join(x for x in [note.rstrip(".")] + extras if x)
        table = [{"id": r["key"], "repo": r["name"], "branch": self.branch(r), "sync": self.sync(r),
                  "changes": str(r["total"]), "agent": self.agent(r)} for r in repos]
        shown = self.shown_repo(data, values)
        if shown is None:
            head, files = "", []
        else:
            edited = ago(datetime.fromtimestamp(shown["edited"]).astimezone(), now) if shown["edited"] else ""
            more = shown["total"] - len(shown["files"])
            head = " · ".join(x for x in (
                shown["name"], self.branch(shown), self.sync(shown),
                f"{shown['total']} changed" + (f", last edit {edited}" if edited else "") if shown["total"]
                else "no uncommitted changes",
                f"{more} more not listed" if more > 0 else "") if x)
            files = self.file_rows(shown)
        out = {self.p("note"): note, self.p("repos"): table, self.p("head"): head, self.p("files"): files}
        if shown is not None and values.get(self.p("repo")) != shown["key"]:
            out[self.p("repo")] = shown["key"]
        return out

    # ── presses ──────────────────────────────────────────────────────────

    def chosen_file(self, data, row_id: str) -> tuple[dict, dict] | None:
        """Exactly the repo and changed file a row id names, as the last fetch
        read them from git. Anything else is None, never a nearest match."""
        try:
            key, rel = json.loads(row_id)
        except (TypeError, ValueError):
            return None
        if not isinstance(key, str) or not isinstance(rel, str):
            return None
        repo = self.repo_for(data, key)
        if repo is None:
            return None
        hits = [f for f in repo["files"] if f["rel"] == rel]
        return (repo, hits[0]) if len(hits) == 1 else None

    def pick_repo(self, ctx: Context, data, values: dict) -> Result:
        repo = self.repo_for(data, str(values.get("row") or ""))
        if repo is None:
            return Result(False, "That repo isn't on the list any more.")
        return Result(True, f"{repo['name']}: {repo['total']} changed.",
                      updates={self.p("repo"): repo["key"], self.p("file"): "", self.p("diff"): "",
                               self.p("path"): ""})

    def diff_argv(self, repo: dict, f: dict, guard: list) -> tuple[list, set]:
        """The one git command a file's diff runs, and the exit codes that
        mean it worked (`--no-index` exits 1 when the files differ)."""
        base = GIT + guard + ["-C", repo["root"]]
        if f["code"] == "?":
            return base + ["diff", "--no-index"] + DIFF_FLAGS + ["--", "/dev/null", f["rel"]], {0, 1}
        against = ["--cached"] if repo["oid"] == "(initial)" else ["HEAD"]
        paths = [f["rel"]] + ([f["orig"]] if f["orig"] else [])
        return base + ["diff"] + DIFF_FLAGS + ["-M"] + against + ["--"] + paths, {0}

    def too_big(self, ctx: Context, repo: dict, f: dict) -> str:
        """Why a tracked file's diff would read too much, or "" when it
        won't. The worktree side by its size on disk, the other side by the
        blob size git already stores, so nothing is read to find out."""
        paths = [f["rel"]] + ([f["orig"]] if f["orig"] else [])
        for rel in paths:
            try:
                st = os.lstat(Path(repo["root"]) / rel)
            except (OSError, ValueError):
                continue
            if stat.S_ISREG(st.st_mode) and st.st_size > DIFF_MAX_BYTES:
                return f"is {st.st_size >> 10} KB, too big to diff on the glass"
        if repo["oid"] == "(initial)":
            argv = GIT + ["-C", repo["root"], "ls-files", "-z", "--format=%(objectsize)", "--"] + paths
        else:
            argv = GIT + ["-C", repo["root"], "ls-tree", "-z", "-l", "HEAD", "--"] + paths
        code, out, _ = run_git(ctx, argv)
        if code != 0:
            return "couldn't be sized, so it isn't diffed"
        for record in filter(None, out.split("\0")):
            size = record.split("\t", 1)[0].split(" ")[-1].strip()
            if size.isdigit() and int(size) > DIFF_MAX_BYTES:
                return f"was {int(size) >> 10} KB, too big to diff on the glass"
        return ""

    def diff(self, ctx: Context, data, values: dict) -> Result:
        row = str(values.get("row") or "")
        hit = self.chosen_file(data, row)
        if hit is None:
            return Result(False, "That file isn't changed any more. Pick it again.")
        repo, f = hit
        name = label(f["rel"], 60)
        if f["code"] == "?":
            # Untracked: git reads the whole file to diff it, so it is held to
            # the same bar as Preview first.
            path = safe_path(repo["root"], f["rel"])
            if path is None:
                return Result(False, f"{name} isn't a plain file inside {repo['name']}, so it isn't drawn.")
            problem = text_problem(path)
            if problem:
                return Result(False, f"{name} is new and {problem}.",
                              updates={self.p("file"): row, self.p("diff"): "", self.p("path"): ""})
        else:
            problem = self.too_big(ctx, repo, f)
            if problem:
                return Result(False, f"{name} {problem}.",
                              updates={self.p("file"): row, self.p("diff"): "", self.p("path"): ""})
        # Listed again at the press: the config may have changed since the fetch.
        guard = filter_guard(ctx, repo["root"])
        if guard is None:
            return Result(False, f"{repo['name']}'s git config can't be read safely, so nothing is diffed.")
        argv, ok_codes = self.diff_argv(repo, f, guard)
        code, out, err = run_git(ctx, argv)
        if code not in ok_codes:
            return Result(False, f"git diff failed: {label(err or out, 80)}")
        text = render_diff(out)
        if not text:
            return Result(False, f"{name} has no difference any more.", refetch=True)
        return Result(True, f"Diff of {name}.",
                      updates={self.p("file"): row, self.p("diff"): text, self.p("path"): "",
                               self.p("repo"): repo["key"]})

    def preview(self, ctx: Context, data, values: dict) -> Result:
        row = str(values.get(self.p("file")) or "")
        if not row:
            return Result(False, "Press Diff on a file first; Preview shows that file.")
        hit = self.chosen_file(data, row)
        if hit is None:
            return Result(False, "That file isn't changed any more. Pick it again.")
        repo, f = hit
        name = label(f["rel"], 60)
        if f["code"] == "D":
            return Result(False, f"{name} was deleted; its diff is all there is.")
        # Checked again at the press: the file may have become a link since.
        path = safe_path(repo["root"], f["rel"])
        if path is None:
            return Result(False, f"{name} isn't a plain file inside {repo['name']}, so it isn't drawn.")
        # The path goes to the glass as it is, and the HUD's File view draws
        # its last component uncleaned: a changed file named a<U+202E>txt.js
        # reached the screen with its bidi override (verifier, 2026-10-05).
        # So a path clean() would change is named, never handed over.
        if clean(str(path)) != str(path):
            return Result(False, f"{name} has control or format characters in its path, so it isn't drawn.",
                          updates={self.p("path"): "", self.p("diff"): ""})
        problem = text_problem(path)
        if problem:
            return Result(False, f"{name} {problem}, so it isn't drawn.")
        return Result(True, f"Showing {name}.", updates={self.p("path"): str(path), self.p("diff"): ""})
