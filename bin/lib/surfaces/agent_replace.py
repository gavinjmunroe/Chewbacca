"""Replace across files, from the card's Find field.

VS Code's ⌘⇧H: type a word in Find, a replacement under it, see every hit
with its new text, press once to change them all. Realm's project.grep is a
search that stops at its first few hits, which is right for finding and wrong
for replacing, so the card counts every hit itself.

SCAN. While Find holds a word of GREP_MIN or more and Replace holds anything,
a thread runs `git grep -F` over the checkout's tracked text files (ide_git's
hardened git: no filter, textconv or fsmonitor from the repo runs), reads
each file that matched and keeps its digest. The word is matched as typed:
literal, case-sensitive, never a pattern. Files that exist to hold a secret
(agent_ide.secret_path) are left out and the preview says how many.

PREVIEW. Every file is counted and named in the caption; the first lines are
drawn as Hits rows showing the line as it will read, the new text lit. The
Replace row says how many hits in how many files, that each file is copied
aside first and that Undo puts them back. Its id is a digest of the word,
the replacement and every file's path and digest, so the press re-scans and
refuses if any of that moved.

APPLY writes each file only if its bytes still have the digest the preview
read, copying it aside first (~/.bob/backups, as the File editor's saves).
A file that moved stops the replace there: what was written stays written,
is named, and Undo puts it back. Nothing is replaced while the agent works.

UNDO puts each file back only while it is still what the replace wrote.
"""
from __future__ import annotations

import hashlib
from pathlib import Path, PurePosixPath

import ide_git
import realm_client
import session_tree

from . import ACTION_PREFIX, Bind, Context, Result, comp
from .agent_ide import GREP_MIN, QUERY_CHARS, WHERE_CHARS, _clean, secret_path

# The most files and hits one press replaces. VS Code has no ceiling; a press
# on the glass whose preview can't be read whole is a press nobody checked,
# so past these the card asks for a narrower word. Guessed, never measured.
MAX_FILES = 40
MAX_HITS = 400
# Hit lines drawn in the preview; the caption counts all of them. The same
# bound as the finder's line rows (agent_ide.FIND_LINES), doubled since this
# preview is the thing being approved. Guessed.
PREVIEW_LINES = 16
# A replacement longer than this is a paste, not a word. Guessed.
REPLACE_CHARS = 200
# git grep over a large checkout; past this the scan says it couldn't finish.
SCAN_TIMEOUT = 30.0
# Characters of a hit line shown around the change.
LINE_CHARS = 140


def replace_id(query: str, replacement: str, files: list[dict]) -> str:
    h = hashlib.sha256()
    for part in (query, replacement):
        h.update(part.encode() + b"\0")
    for f in sorted(files, key=lambda f: f["path"]):
        h.update(f"{f['path']}\0{f['digest']}\0".encode())
    return "rep:" + h.hexdigest()[:24]


def scan(git: ide_git.Git, root: str, query: str) -> dict:
    """Every tracked text file holding `query`: {files: [{path, digest,
    hits, lines: [(line, text)]}], secret, why}."""
    code, out, err = git("grep", "-n", "-z", "-I", "-F", "--no-color", "--full-name", "-e", query, "--")
    if code == 1:
        return {"files": [], "secret": 0, "why": ""}
    if code != 0:
        return {"files": [], "secret": 0, "why": "git couldn't search it"}
    by_path: dict[str, list] = {}
    for rec in out.split(b"\n"):
        parts = rec.split(b"\0", 2)
        if len(parts) != 3 or not parts[1].isdigit():
            continue
        path = parts[0].decode("utf-8", "replace")
        by_path.setdefault(path, []).append((int(parts[1]), parts[2]))
    files, secret = [], 0
    base = Path(root).resolve()
    needle = query.encode()
    for path, lines in by_path.items():
        rel = session_tree.inside(base, str(base / path))
        if rel is None:
            continue
        if secret_path(rel):
            secret += 1
            continue
        data = ide_git.read_regular(base / rel)
        if data is None:
            continue
        hits = data.count(needle)
        if hits:
            files.append({"path": rel, "digest": ide_git.digest(data), "hits": hits, "lines": lines})
    files.sort(key=lambda f: f["path"])
    return {"files": files, "secret": secret, "why": ""}


def preview_segments(text: bytes, query: str, replacement: str) -> list[dict]:
    """A hit line as it will read: the text around each hit plain, the new
    text lit, clipped to LINE_CHARS around the first change."""
    line = text.decode("utf-8", "replace").strip()
    first = line.find(query)
    if first > LINE_CHARS // 3:
        line = "…" + line[first - LINE_CHARS // 3:]
    out, used = [], 0
    pieces = line.split(query)
    for i, piece in enumerate(pieces):
        if piece:
            t = _clean(piece, max(0, LINE_CHARS - used))
            if t:
                out.append({"text": t, "match": False})
                used += len(t)
        if i < len(pieces) - 1 and used < LINE_CHARS:
            t = _clean(replacement, REPLACE_CHARS) or "∅"
            out.append({"text": t, "match": True})
            used += len(t)
    return out


class Replace:
    """Mixed into surfaces.agents.Agents after Ide. Uses the host's spawn,
    poke, connect, _lock, pinned, p, cid, _claim, _release, _fresh,
    git_for and backups."""

    def _replace_init(self) -> None:
        # The last scan: {sid, root, query, gen, files, secret, why}.
        self._rep_found: dict | None = None
        self._rep_scanning = False
        self._rep_gen = 0
        # The last replace, for Undo: {sid, id, written: [Written], words}.
        self._rep_undo: dict | None = None
        p = ACTION_PREFIX
        self.actions.update({f"{p}replace": self.replace_all, f"{p}replaceundo": self.replace_undo})

    def _scan_soon(self, sid: str, root: str, query: str) -> None:
        with self._lock:
            if self._rep_scanning:
                return
            self._rep_scanning = True

        def work() -> None:
            try:
                got = scan(self.git_for(root), root, query)
            except Exception as err:  # noqa: BLE001  a scan that dies says so on the card, never kills the daemon
                got = {"files": [], "secret": 0, "why": f"the scan failed ({type(err).__name__})"}
            with self._lock:
                self._rep_gen += 1
                self._rep_found = {"sid": sid, "root": root, "query": query, "gen": self._rep_gen, **got}
                self._rep_scanning = False
            self.poke()

        self.spawn(work)

    def replace_model(self, shown: dict, values: dict, out: dict) -> None:
        p = self.p
        root = self.repo_of(shown)
        query = str(values.get(p("find")) or "").strip()[:QUERY_CHARS]
        with self._lock:
            undo = dict(self._rep_undo) if self._rep_undo else None
        if undo and undo["sid"] == shown["id"]:
            out[p("replaceUndo")] = [{"id": undo["id"], "text": undo["words"]}]
        if not root.startswith("/") or len(query) < GREP_MIN:
            return
        out[p("replaceOn")] = True
        replacement = str(values.get(p("replaceWith")) or "")
        if not replacement or len(replacement) > REPLACE_CHARS or "\n" in replacement:
            return
        with self._lock:
            found = dict(self._rep_found) if self._rep_found else None
            busy = self._rep_scanning
        current = bool(found and found["sid"] == shown["id"] and found["root"] == root and found["query"] == query)
        if not current:
            if not busy:
                self._scan_soon(shown["id"], root, query)
            return
        files = found["files"]
        name = Path(root).name
        if found["why"]:
            out[p("replaceNote")] = f"Couldn't count the hits in {name}: {found['why']}."
            return
        hits = sum(f["hits"] for f in files)
        skipped = f" · {found['secret']} secret file{'s' if found['secret'] != 1 else ''} left out" \
            if found["secret"] else ""
        if not files:
            out[p("replaceNote")] = f"Nothing in {name}'s tracked files holds that{skipped}."
            return
        if len(files) > MAX_FILES or hits > MAX_HITS:
            out[p("replaceNote")] = (f"{hits} hits in {len(files)} files is more than one press should change "
                                     f"(at most {MAX_HITS} in {MAX_FILES}). Narrow the word.")
            return
        rows = []
        for f in files:
            for line, text in f["lines"]:
                if len(rows) >= PREVIEW_LINES:
                    break
                rows.append({"id": f"r{found['gen']}:{len(rows)}", "kind": "line",
                             "segments": preview_segments(text, query, replacement),
                             "where": _clean(f"{f['path']} · {line}", WHERE_CHARS)})
        shown_lines = sum(len(f["lines"]) for f in files)
        more = f", first {len(rows)} lines shown" if shown_lines > len(rows) else ""
        out[p("replaceRows")] = [r for r in rows if r["segments"]]
        out[p("replaceCap")] = _clean(f"As it will read · {hits} hit{'s' if hits != 1 else ''} in "
                                      f"{len(files)} file{'s' if len(files) != 1 else ''}{more}{skipped}", 120)
        out[p("replaceGo")] = [{"id": replace_id(query, replacement, files), "accent": True, "text": _clean(
            f"Replaces {hits} hit{'s' if hits != 1 else ''} in {len(files)} file{'s' if len(files) != 1 else ''}"
            " · each file copied aside first, Undo puts them back", 120)}]

    # ── presses ──────────────────────────────────────────────────────────

    def replace_all(self, ctx: Context, data, values: dict) -> Result:
        key = str(values.get("row") or "")
        bad = {self.p("level"): "error"}
        query = str(values.get(self.p("find")) or "").strip()[:QUERY_CHARS]
        replacement = str(values.get(self.p("replaceWith")) or "")
        with self._lock:
            sid = self.pinned
        row = next((r for r in (data or {}).get("rows") or [] if r["id"] == sid), None)
        root = self.repo_of(row) if row else ""
        if (row is None or not root.startswith("/") or len(query) < GREP_MIN or not replacement
                or len(replacement) > REPLACE_CHARS or "\n" in replacement):
            return Result(False, "Nothing was replaced: type the word in Find and its replacement first.",
                          updates=bad)
        if not self._claim("replace", sid):
            return Result(False, "Still replacing the last press.")
        try:
            try:
                with self.connect(ctx) as conn:
                    busy = self._fresh(conn, sid).get("status") in ("running", "waiting_permission")
            except realm_client.RealmError:
                busy = True
            if busy:
                return Result(False, "Nothing was replaced: the agent is working and may be writing these files. "
                                     "Replace once it stops.", updates=bad)
            got = scan(self.git_for(root), root, query)
            files = got["files"]
            if got["why"] or not files or replace_id(query, replacement, files) != key \
                    or len(files) > MAX_FILES or sum(f["hits"] for f in files) > MAX_HITS:
                with self._lock:
                    self._rep_found = None  # the next draw scans again, so the preview catches up
                return Result(False, "Nothing was replaced: the files changed since the preview. Look again.",
                              updates=bad)
            base = Path(root).resolve()
            folder = self.backups()
            written: list[ide_git.Written] = []
            stopped = ""
            for f in files:
                path = base / f["path"]
                data_now = ide_git.read_regular(path)
                if data_now is None or ide_git.digest(data_now) != f["digest"]:
                    stopped = f"{PurePosixPath(f['path']).name} changed under it"
                    break
                new = data_now.replace(query.encode(), replacement.encode())
                try:
                    backup = ide_git.keep_copy(path, data_now, folder)
                    ide_git.write_atomic(path, new)
                except OSError as err:
                    stopped = f"{PurePosixPath(f['path']).name} couldn't be written ({err.strerror or err})"
                    break
                written.append(ide_git.Written(str(path), str(backup), ide_git.digest(new)))
        finally:
            self._release("replace", sid)
        hits = sum(f["hits"] for f in files[:len(written)])
        if written:
            with self._lock:
                self._rep_undo = {"sid": sid, "id": f"undo:{key}", "written": written, "words": _clean(
                    f"Puts {len(written)} file{'s' if len(written) != 1 else ''} back as they were before "
                    f"the replace", 100)}
                self._rep_found = None
        self._stale_changes()
        if stopped:
            return Result(False, f"Stopped after {len(written)} of {len(files)} files: {stopped}. "
                                 + ("Undo puts back what was written." if written else "Nothing was written."),
                          updates={self.p("level"): "warning"}, refetch=True)
        return Result(True, f"Replaced {hits} hit{'s' if hits != 1 else ''} in {len(written)} "
                            f"file{'s' if len(written) != 1 else ''}. Each file before is in {folder}.",
                      updates={self.p("level"): "success"}, refetch=True)

    def replace_undo(self, ctx: Context, data, values: dict) -> Result:
        key = str(values.get("row") or "")
        with self._lock:
            undo = dict(self._rep_undo) if self._rep_undo else None
            sid = self.pinned
            if undo and undo["sid"] == sid and undo["id"] == key:
                self._rep_undo = None
        if not undo or undo["sid"] != sid or undo["id"] != key:
            return Result(False, "There's nothing to undo there any more.", updates={self.p("level"): "error"})
        back, left = 0, []
        for w in undo["written"]:
            ok, why = ide_git.put_back(w)
            if ok:
                back += 1
            else:
                left.append(why)
        self._stale_changes()
        if left:
            return Result(False, f"Put {back} back; {len(left)} left alone: {left[0]}.",
                          updates={self.p("level"): "warning"}, refetch=True)
        return Result(True, f"Put {back} file{'s' if back != 1 else ''} back.",
                      updates={self.p("level"): "success"}, refetch=True)

    # ── drawing ──────────────────────────────────────────────────────────

    def replace_blank(self) -> dict:
        p = self.p
        return {p("replaceOn"): False, p("replaceNote"): "", p("replaceRows"): [], p("replaceCap"): "",
                p("replaceGo"): [], p("replaceUndo"): []}

    def replace_plan(self, out: dict) -> dict:
        p = self.p
        return {"replace": bool(out.get(p("replaceOn"))), "replaceNote": bool(out.get(p("replaceNote"))),
                "replaceRows": bool(out.get(p("replaceRows"))), "replaceGo": bool(out.get(p("replaceGo"))),
                "replaceUndo": bool(out.get(p("replaceUndo")))}

    def replace_parts(self, plan: dict) -> tuple[list[str], list[str]]:
        p, c = self.p, self.cid
        parts: list[str] = []
        order: list[str] = []
        if plan.get("replace"):
            parts.append(comp(c("replacewith"), "Field", label="Replace", placeholder="Replace every hit with",
                              value=Bind(p("replaceWith"))))
            order.append("replacewith")
        if plan.get("replaceNote"):
            parts.append(comp(c("replacenote"), "Text", value=Bind(p("replaceNote")), tone="muted"))
            order.append("replacenote")
        if plan.get("replaceRows"):
            parts.append(comp(c("replacerows"), "Hits", caption=Bind(p("replaceCap")), items=Bind(p("replaceRows"))))
            order.append("replacerows")
        if plan.get("replaceGo"):
            parts.append(comp(c("replacego"), "Events", caption="", items=Bind(p("replaceGo")),
                              action=f"{ACTION_PREFIX}replace", actionLabel="Replace all"))
            order.append("replacego")
        if plan.get("replaceUndo"):
            parts.append(comp(c("replaceundo"), "Events", caption="", items=Bind(p("replaceUndo")),
                              action=f"{ACTION_PREFIX}replaceundo", actionLabel="Undo"))
            order.append("replaceundo")
        return parts, order
