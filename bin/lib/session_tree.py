"""The tree beside a session card: what the session touched, plus one level.

docs/plans/NO-APPS.md, "The HUD IDE": the tree is the session's folder "collapsed
to what the session touched plus one level of context, never the whole repo
by default". So the rows are:

- every file the session read or edited (from its transcript's tool calls)
  and every file git says changed, marked as such;
- the folders on the way down to them, from the repo root;
- the other entries of each of those folders, one level only, so a touched
  file sits among its neighbours. A sub-folder there is one collapsed row.

READ ONLY, and it runs nothing a repo can configure. The only git call is
`ls-files`, which never runs a clean or smudge filter, with fsmonitor off
and `--no-optional-locks`, the same switches as surfaces/code.py.

UNTRUSTED. Paths come out of a transcript, which anyone's text can write
into. A path counts only when it resolves inside the repo root and outside
`.git`; names are cleaned before they reach the glass. A row's id is an
index (`t3`), never a path, and the daemon maps it back to a path this
module produced, so a press can only name a row that was drawn.
"""
from __future__ import annotations

import os
import stat
import subprocess
import unicodedata
from pathlib import Path, PurePosixPath

# The most rows the tree draws. A tree of the whole repo is the thing this
# replaces; past this the session touched too much to scan, and the rows
# after it are named as a count. Guessed, never measured.
MAX_ROWS = 60
# Neighbours shown per folder. A folder like hud/Sources/KyberKit has 50
# files; the touched ones always show, and this many of the rest. Guessed.
SIBLINGS = 12
# Tools whose `file_path` means the session looked at or changed that file.
READ_TOOLS = frozenset({"Read"})
EDIT_TOOLS = frozenset({"Edit", "Write", "MultiEdit", "NotebookEdit"})

GIT = ["git", "--no-pager", "--no-optional-locks", "--literal-pathspecs",
       "-c", "core.fsmonitor=false", "-c", "color.ui=never",
       # Only rev-parse and ls-files run here, which read no file content, so
       # no filter driver runs. Never add status or diff without the
       # filter_guard bin/lib/surfaces/code.py uses: attributes from
       # .git/info/attributes ignore this flag (shown 2026-10-09).
       "--attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904"]


def clean(text: str) -> str:
    """Control, format and separator characters out (Trojan Source, CVE-2021-42574)."""
    return "".join(ch for ch in str(text or "")
                   if not (unicodedata.category(ch)[0] == "C" or unicodedata.category(ch) in ("Zl", "Zp")))


def touched(entries: list[dict]) -> dict[str, str]:
    """Absolute path -> "edited" or "read", from the transcript's tool calls.
    An edit outranks a read of the same file."""
    out: dict[str, str] = {}
    for e in entries:
        content = (e.get("message") or {}).get("content") if isinstance(e.get("message"), dict) else None
        if not isinstance(content, list):
            continue
        for b in content:
            if not isinstance(b, dict) or b.get("type") != "tool_use":
                continue
            name = str(b.get("name") or "")
            args = b.get("input") if isinstance(b.get("input"), dict) else {}
            path = str(args.get("file_path") or args.get("notebook_path") or "")
            if not path:
                continue
            if name in EDIT_TOOLS:
                out[path] = "edited"
            elif name in READ_TOOLS:
                out.setdefault(path, "read")
    return out


def repo_root(cwd: str, run=subprocess.run) -> Path | None:
    try:
        res = run(GIT + ["-C", cwd, "rev-parse", "--show-toplevel"], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    top = res.stdout.strip() if res.returncode == 0 else ""
    return Path(top).resolve() if top else None


def inside(root: Path, path: str) -> str | None:
    """`path` relative to `root`, only when it resolves inside it and outside .git."""
    try:
        real = Path(path).expanduser()
        real = (real if real.is_absolute() else root / real).resolve()
    except (OSError, RuntimeError):
        return None
    if not real.is_relative_to(root):
        return None
    rel = real.relative_to(root).as_posix()
    if not rel or rel == "." or rel.split("/", 1)[0] == ".git":
        return None
    return rel


def listed(root: Path, folders: list[str], run=subprocess.run) -> list[str]:
    """Tracked and untracked-but-not-ignored files under `folders`, as repo paths."""
    specs = [f"{d}/" if d else "." for d in folders]
    try:
        res = run(GIT + ["-C", str(root), "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--"] + specs,
                  capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return []
    if res.returncode != 0:
        return []
    return [p for p in res.stdout.split("\0") if p]


def build(cwd: str, entries: list[dict], changes: dict[str, str] | None = None,
          run=subprocess.run) -> tuple[list[dict], dict[str, str], str]:
    """(rows, id -> absolute path, root) for the Tree component.

    `changes` is repo path -> git's two-letter status, from the card's own
    `git status`, so the tree and the card's Changed list never disagree."""
    root = repo_root(cwd, run) if cwd else None
    if root is None:
        return [], {}, ""
    marks: dict[str, str] = {}
    for path, how in touched(entries).items():
        rel = inside(root, path)
        if rel:
            marks[rel] = how
    for rel, code in (changes or {}).items():
        r = inside(root, str(root / rel))
        if r:
            marks[r] = code.strip() or "?"
    if not marks:
        return [], {}, str(root)

    folders = sorted({str(PurePosixPath(rel).parent) if "/" in rel else "" for rel in marks})
    # Each touched folder's direct entries: its files and its first-level
    # sub-folders, collapsed.
    children: dict[str, set[tuple[str, bool]]] = {}
    for rel in listed(root, folders, run):
        for folder in folders:
            prefix = f"{folder}/" if folder else ""
            if not rel.startswith(prefix):
                continue
            rest = rel[len(prefix):]
            head, sep, _ = rest.partition("/")
            children.setdefault(folder, set()).add((prefix + head, bool(sep)))
    for rel in marks:
        folder = str(PurePosixPath(rel).parent) if "/" in rel else ""
        children.setdefault(folder, set()).add((rel, False))

    # Every folder on the way down to a touched one is drawn, open.
    open_dirs = {""}
    for folder in folders:
        parts = folder.split("/") if folder else []
        for i in range(1, len(parts) + 1):
            open_dirs.add("/".join(parts[:i]))
    for d in open_dirs:
        if d:
            parent = str(PurePosixPath(d).parent) if "/" in d else ""
            children.setdefault(parent, set()).add((d, True))

    rows: list[dict] = []
    ids: dict[str, str] = {}
    hidden = 0

    def walk(folder: str, depth: int) -> None:
        nonlocal hidden
        kids = sorted(children.get(folder, set()), key=lambda k: (not k[1], k[0].lower()))
        # Touched entries and open folders always show; neighbours up to SIBLINGS.
        shown_plain = 0
        for path, is_dir in kids:
            keep = path in marks or path in open_dirs
            if not keep:
                if shown_plain >= SIBLINGS:
                    hidden += 1
                    continue
                shown_plain += 1
            if len(rows) >= MAX_ROWS:
                hidden += 1
                continue
            row = {"id": f"t{len(rows)}", "name": clean(PurePosixPath(path).name), "depth": depth,
                   "dir": is_dir}
            if path in marks:
                row["mark"] = marks[path]
            if is_dir and path not in open_dirs:
                row["collapsed"] = True
            if not is_dir:
                ids[row["id"]] = str(root / path)
            rows.append(row)
            if is_dir and path in open_dirs:
                walk(path, depth + 1)

    walk("", 0)
    if hidden:
        rows.append({"id": f"t{len(rows)}", "name": f"{hidden} more not shown", "depth": 0, "dir": False,
                     "note": True})
    return rows, ids, str(root)


def text_lines(rows: list[dict]) -> str:
    """The tree as indented text, for `kyber-sessions tree <id>` with no HUD."""
    out = []
    for r in rows:
        mark = f"  [{r['mark']}]" if r.get("mark") else ""
        tail = "/" if r.get("dir") else ""
        fold = " +" if r.get("collapsed") else ""
        out.append(f"{'  ' * int(r.get('depth') or 0)}{r['name']}{tail}{fold}{mark}")
    return "\n".join(out)


def editable(path: str, root: str) -> bool:
    """A file row opens editable only when it is a regular text-sized file
    whose resolved path is still inside the repo and outside .git."""
    try:
        real = Path(path).resolve()
        st = os.stat(real)
    except (OSError, RuntimeError):
        return False
    return (stat.S_ISREG(st.st_mode) and st.st_size <= (1 << 20) and bool(root)
            and real.is_relative_to(Path(root)) and ".git" not in real.relative_to(Path(root)).parts)
