"""The agent card's own writes to a checkout: one hunk, a replace, a branch.

Realm's git write path stops at a whole file on purpose ("`git add` for
exactly these paths, per file, not per hunk", rpc.ts at 59afd9e4), and it has
no branch switch and no replace. Cursor's loop needs all three, so the card
does them here, each the smallest write that does the job, each checked
against what was drawn, each with a way back:

- a hunk is kept by `git apply --cached` of exactly that hunk (the index
  only, the file is untouched), and taken back by the same patch reversed;
- a hunk is rejected by rewriting only its lines in the file, after checking
  the file still holds the agent's lines at that place and copying the file
  aside first; Undo writes the copy back only while the file is still what
  the reject wrote;
- a replace writes each file only if its digest is still the one previewed,
  copying each aside first, and Undo puts each back the same way;
- a branch switch is `git switch`, and a dirty tree is refused unless the
  press said what happens to the changes.

HARDENED GIT. A repo's own config can name programs git runs (fsmonitor, an
external diff, a filter driver). Every call here carries the same switches
bin/lib/surfaces/code.py uses for its reads, plus filter_guard's blanking of
every filter the repo defines, so pressing Keep on a hunk runs nothing the
repo wrote. Hooks are not run by any command used here.

BACKUPS go where the File editor's saves put theirs (FileSafety.swift):
~/.bob/backups/<name>.<yyyyMMdd-HHmmss>.<6 hex>, KYBER_FILE_SAFETY_DIR to
move it, so a person looking for "the version before" finds one folder.
"""
from __future__ import annotations

import hashlib
import os
import re
import secrets
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

GIT = ["git", "--no-pager", "--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false",
       "-c", "color.ui=never", "-c", "diff.external=", "-c", "core.hooksPath=/dev/null",
       # The empty tree's attributes: a repo's .gitattributes can't name a
       # filter or a textconv for these calls (code.py, shown 2026-10-09).
       "--attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904"]
# The same flags realm's fileDiff passes (git-exec.ts GIT_DIFF_FLAGS), so the
# hunks read here are the hunks realm drew.
DIFF_FLAGS = ["--no-ext-diff", "--no-textconv", "--no-color"]
# Git calls here are local and small; a hung one (a lock held by another
# git) shouldn't hold a press. Guessed, never measured.
GIT_TIMEOUT = 20.0
# The largest file a hunk reject or a replace rewrites: the File editor's
# own ceiling for an editable file (session_tree.editable, 1 MiB).
MAX_BYTES = 1 << 20
# Backups kept per file name, as FileSafety.keptBackups.
KEPT_BACKUPS = 10
HUNK = re.compile(rb"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$")
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
# Repo-local config scopes, whose filter drivers are blanked. A driver in
# the person's own ~/.gitconfig (git-lfs) stays on, as in code.py.
TRUSTED_SCOPES = frozenset({"global", "system"})


def run_bytes(argv: list, data: bytes | None = None, cwd: str | None = None,
              timeout: float = GIT_TIMEOUT) -> tuple[int, bytes, str]:
    try:
        done = subprocess.run(argv, input=data, capture_output=True, timeout=timeout, cwd=cwd,
                              env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0",
                                   # A partial clone's missing blob is never fetched (git 2.45+): a
                                   # fetch runs the remote's transport the repo's config names.
                                   "GIT_NO_LAZY_FETCH": "1"})
    except subprocess.TimeoutExpired:
        return 124, b"", f"{argv[0]} took longer than {timeout:.0f}s"
    except OSError as err:
        return 126, b"", str(err)
    return done.returncode, done.stdout, done.stderr.decode("utf-8", "replace")


class Git:
    """git in one checkout with the switches above. `run` is a seam."""

    def __init__(self, root: str, run=run_bytes, attrs: bool = False) -> None:
        self.root = str(Path(root).resolve())
        self.run = run
        self._guard: list[str] | None = None
        # A checkout (git switch) needs the repo's own eol and text
        # attributes to write files right; every other call reads none. It
        # also drops --literal-pathspecs, which names no path in a switch or
        # a stash, and with which `git stash push --include-untracked` (git
        # 2.50.1) saved the edits but left the untracked files in place, so
        # the switch carried them (found 2026-10-11, tests/test_surface_agents.py).
        # Submodules never recurse: a checkout that recursed would run git in
        # repos the press never named (security review, 2026-10-11).
        self.base = [x for x in GIT if not x.startswith("--attr-source") and x != "--literal-pathspecs"] \
            + ["-c", "submodule.recurse=false"] if attrs else GIT
        self.attrs = attrs

    def guard(self) -> list[str] | None:
        """filter_guard's switches (code.py), read once per Git."""
        if self._guard is None:
            code, out, _ = self.run(GIT + ["-C", self.root, "config", "--list", "--show-scope", "-z"])
            if code != 0:
                return None
            tokens = out.decode("utf-8", "replace").split("\0")
            names: set[str] = set()
            for scope, entry in zip(tokens[0::2], tokens[1::2]):
                key = entry.split("\n", 1)[0]
                low = key.lower()
                if scope not in TRUSTED_SCOPES and self.attrs and low.startswith("merge.") \
                        and low.endswith(".driver"):
                    # With the repo's attributes on, a stash apply would run
                    # a merge driver the repo names; a -c line can't make one
                    # safe, so this checkout gets no switch (security review,
                    # 2026-10-11).
                    return None
                if scope in TRUSTED_SCOPES or not low.startswith("filter."):
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
                guard += [x for var in ("clean", "smudge", "process") for x in ("-c", f"filter.{name}.{var}=")]
                guard += ["-c", f"filter.{name}.required=false"]
            self._guard = guard
        return self._guard

    def __call__(self, *args: str, data: bytes | None = None) -> tuple[int, bytes, str]:
        guard = self.guard()
        if guard is None:
            return 1, b"", "couldn't read the repo's git config"
        return self.run(self.base + guard + ["-C", self.root, *args], data)

    def text(self, *args: str) -> tuple[int, str, str]:
        code, out, err = self(*args)
        return code, out.decode("utf-8", "replace"), err


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def split_lines(data: bytes) -> list[bytes]:
    """Lines with their own endings, split only at \\n, as git counts them
    (bytes.splitlines would also split at a lone \\r)."""
    return re.findall(rb"[^\n]*\n|[^\n]+$", data)


# ── hunks ────────────────────────────────────────────────────────────────


@dataclass
class Hunk:
    old_start: int
    old_lines: int
    new_start: int
    new_lines: int
    header: bytes
    body: list[bytes] = field(default_factory=list)

    @property
    def key(self) -> str:
        """Which change this is, by its lines and not its place: rejecting
        the hunk above moves this one's numbers, not what it changes."""
        return digest(b"".join(self.body))[:16]

    @property
    def added(self) -> int:
        return sum(1 for b in self.body if b[:1] == b"+")

    @property
    def removed(self) -> int:
        return sum(1 for b in self.body if b[:1] == b"-")

    def side(self, keep: bytes) -> bytes:
        """The hunk's old (keep=b"-") or new (keep=b"+") lines as bytes,
        honouring git's `\\ No newline at end of file` on the line before."""
        out: list[bytes] = []
        last_kept = False
        for line in self.body:
            mark = line[:1]
            if mark == b"\\":
                if last_kept and out and out[-1].endswith(b"\n"):
                    out[-1] = out[-1][:-1]
                continue
            last_kept = mark in (b" ", keep)
            if last_kept:
                text = line[1:]
                out.append(text if text.endswith(b"\n") else text + b"\n")
        return b"".join(out)

    def patch_lines(self) -> bytes:
        tail = self.header
        head = f"@@ -{self.old_start},{self.old_lines} +{self.new_start},{self.new_lines} @@".encode()
        body = b"".join(x if x.endswith(b"\n") else x + b"\n" for x in self.body)
        return head + tail + b"\n" + body


def parse_diff(raw: bytes) -> tuple[bytes, list[Hunk]]:
    """One file's `git diff` as (its header, already quoted by git; its hunks)."""
    lines = split_lines(raw)
    head: list[bytes] = []
    hunks: list[Hunk] = []
    for line in lines:
        m = HUNK.match(line.rstrip(b"\n"))
        if m:
            hunks.append(Hunk(int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1),
                              int(m.group(3)), int(m.group(4) if m.group(4) is not None else 1), m.group(5)))
        elif hunks:
            if line[:1] in (b" ", b"+", b"-", b"\\"):
                hunks[-1].body.append(line)
        else:
            head.append(line)
    return b"".join(head), hunks


def file_hunks(git: Git, rel: str) -> tuple[bytes, list[Hunk]] | None:
    """The unstaged hunks of one tracked file, or None when git can't say."""
    code, out, _ = git("diff", *DIFF_FLAGS, "-M", "--", rel)
    if code != 0:
        return None
    if b"\nBinary files " in b"\n" + out or b"GIT binary patch" in out:
        return None
    return parse_diff(out)


def same_ranges(mine: list[Hunk], realm_hunks: list) -> bool:
    """Realm drew the hunks this read found, range for range: only then do
    the hunk verbs line up with the `@@` lines on the glass."""
    if len(mine) != len(realm_hunks):
        return False
    for h, r in zip(mine, realm_hunks):
        if not isinstance(r, dict):
            return False
        if (h.old_start, h.old_lines, h.new_start, h.new_lines) != (
                r.get("oldStart"), r.get("oldLines"), r.get("newStart"), r.get("newLines")):
            return False
    return True


def stage_hunk(git: Git, head: bytes, hunk: Hunk, reverse: bool = False) -> tuple[bool, str]:
    """`git apply --cached` of one hunk: the index moves, the file doesn't.
    git checks every context line, so a hunk that no longer applies fails
    whole rather than half."""
    args = ["apply", "--cached", "--whitespace=nowarn"] + (["-R"] if reverse else []) + ["-"]
    code, _, err = git(*args, data=head + hunk.patch_lines())
    return code == 0, err.strip().splitlines()[0] if err.strip() else ""


# ── file writes with a copy aside ────────────────────────────────────────


def backups_dir(env: dict | None = None) -> Path:
    env = os.environ if env is None else env
    base = env.get("KYBER_FILE_SAFETY_DIR")
    return (Path(base) if base else Path.home() / ".bob") / "backups"


def keep_copy(path: Path, data: bytes, folder: Path, now: float | None = None) -> Path:
    """Copy `data` (what `path` holds) into `folder`, named as FileSafety
    names its backups, and drop that name's oldest past KEPT_BACKUPS."""
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(now))
    dest = folder / f"{path.name}.{stamp}.{secrets.token_hex(3)}"
    fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    mine = sorted((p for p in folder.iterdir() if p.name.startswith(path.name + ".")
                   and p.name[len(path.name) + 1:][:1].isdigit()), key=lambda p: p.name, reverse=True)
    for old in mine[KEPT_BACKUPS:]:
        try:
            old.unlink()
        except OSError:
            pass
    return dest


def write_atomic(path: Path, data: bytes) -> None:
    """Write beside, then rename over, keeping the file's mode."""
    mode = path.stat().st_mode & 0o7777
    tmp = path.with_name(f".{path.name}.kyber-{secrets.token_hex(3)}")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise


@dataclass
class Written:
    """One file a press rewrote: where it is, the copy of what it held, and
    the digest of what the press wrote, which Undo checks first."""
    path: str
    backup: str
    after: str


def read_regular(path: Path) -> bytes | None:
    """The bytes of a regular file no larger than MAX_BYTES, read without
    following a link at the last step, or None."""
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError:
        return None
    with os.fdopen(fd, "rb") as f:
        st = os.fstat(f.fileno())
        import stat as _stat  # noqa: PLC0415
        if not _stat.S_ISREG(st.st_mode) or st.st_size > MAX_BYTES:
            return None
        return f.read(MAX_BYTES + 1)


def reject_hunk(path: Path, hunk: Hunk, folder: Path) -> tuple[Written | None, str]:
    """Put one hunk's lines back as they were before the agent's edit. The
    file must still hold the hunk's new lines at its new place, exactly."""
    data = read_regular(path)
    if data is None:
        return None, "it isn't a regular text file this can rewrite"
    lines = split_lines(data)
    start = hunk.new_start if hunk.new_lines == 0 else hunk.new_start - 1
    now = b"".join(lines[start:start + hunk.new_lines])
    if start < 0 or now != hunk.side(b"+"):
        return None, "the file changed under it"
    out = b"".join(lines[:start]) + hunk.side(b"-") + b"".join(lines[start + hunk.new_lines:])
    try:
        backup = keep_copy(path, data, folder)
        write_atomic(path, out)
    except OSError as err:
        return None, f"it couldn't be written ({err.strerror or err})"
    return Written(str(path), str(backup), digest(out)), ""


def put_back(w: Written) -> tuple[bool, str]:
    """Undo one Written: the copy goes back only while the file is still
    exactly what the press wrote."""
    path = Path(w.path)
    data = read_regular(path)
    if data is None or digest(data) != w.after:
        return False, f"{path.name} changed since, so it was left alone (the copy is at {w.backup})"
    try:
        old = Path(w.backup).read_bytes()
        keep_copy(path, data, Path(w.backup).parent)
        write_atomic(path, old)
    except OSError as err:
        return False, f"{path.name} couldn't be written ({err.strerror or err})"
    return True, ""
