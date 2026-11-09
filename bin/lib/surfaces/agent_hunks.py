"""The agent card's Keep and Reject, one hunk at a time: Cursor's core loop.

Caleb, 2026-10-11: "we gotta mog every ide". The thing Cursor does that the
card couldn't: the agent's edit, shown hunk by hunk, each one kept or thrown
away with one press, without opening an editor.

WHAT IS DRAWN. When the card's Diff shows a file's unstaged change, every
`@@` line in it carries two lit words at its end, Keep and Reject (DiffView
in hud SessionViews.swift draws them from `hunks`). One caption above says
what each does before any press. They appear only when this module's own
`git diff` of the file found exactly the hunks realm drew, range for range,
so a word can never sit on a hunk it doesn't act on.

KEEP stages that hunk: `git apply --cached` of exactly it, so it goes into
the next Commit and push and the file on disk doesn't change (ide_git). Undo
applies the same patch reversed.

REJECT puts that hunk's lines back as they were before the agent's edit. The
press reads the file again, checks it still holds the agent's lines at that
place byte for byte, copies the whole file aside (~/.bob/backups, where the
File editor's saves go), then rewrites only those lines. Undo writes the copy
back while the file is still what Reject wrote. Nothing is rejected while the
agent is working, since it may be writing the same file.

WHICH HUNK. A word's id is `<gen>:<index>:<key>`, key being a digest of the
hunk's lines. The press re-reads the file's diff and acts on the hunk with
that key (the index only breaks a tie between two identical hunks), so
rejecting the hunk above, which moves this one's line numbers, doesn't make
this one's word act on a neighbour, and a hunk the agent rewrote since it was
drawn refuses.
"""
from __future__ import annotations

from pathlib import Path, PurePosixPath

import ide_git
import realm_client
import session_tree

from . import ACTION_PREFIX, Bind, Context, Result, comp

HUNK_NOTE = "Keep stages a hunk for the commit · Reject puts its lines back as they were, file copied aside first"


def lines_of(h: ide_git.Hunk) -> str:
    """Where a hunk is in the file now, as a person counts lines."""
    if h.new_lines <= 0:
        return f"after line {h.new_start}"
    end = h.new_start + h.new_lines - 1
    return f"line {h.new_start}" if end == h.new_start else f"lines {h.new_start}-{end}"


class Hunks:
    """Mixed into surfaces.agents.Agents. Uses the host's connect, _lock,
    pinned, p, cid, _patch, _fresh and _stale_changes."""

    def _hunks_init(self) -> None:
        # The drawn file's hunks: {sid, path, root, head, hunks, gen} or None.
        self._hunks: dict | None = None
        self._hunk_gen = 0
        # The last Keep or Reject, for Undo: {sid, kind, path, root, ...}.
        self._hunk_undo: dict | None = None
        self.git_for = lambda root: ide_git.Git(root)
        self.backups = lambda: ide_git.backups_dir()
        p = ACTION_PREFIX
        self.actions.update({f"{p}hunkkeep": self.hunk_keep, f"{p}hunkreject": self.hunk_reject,
                             f"{p}hunkundo": self.hunk_undo})

    # ── reading ──────────────────────────────────────────────────────────

    def load_hunks(self, sid: str, root: str, path: str, realm_diff) -> None:
        """Read the file's own hunks beside the patch realm drew, and keep
        them only when they are the same hunks."""
        hunks = None
        if root.startswith("/") and isinstance(realm_diff, dict) and not realm_diff.get("staged") \
                and not realm_diff.get("binary") and not realm_diff.get("truncated"):
            got = ide_git.file_hunks(self.git_for(root), path)
            if got and got[1] and ide_git.same_ranges(got[1], realm_diff.get("hunks") or []):
                hunks = got
        with self._lock:
            self._hunk_gen += 1
            self._hunks = ({"sid": sid, "root": root, "path": path, "head": hunks[0], "hunks": hunks[1],
                            "gen": self._hunk_gen} if hunks else None)

    def hunks_model(self, shown: dict, patch, out: dict) -> None:
        p = self.p
        with self._lock:
            found = dict(self._hunks) if self._hunks else None
            undo = dict(self._hunk_undo) if self._hunk_undo else None
        if patch and found and found["sid"] == shown["id"] and found["path"] == patch[1]:
            out[p("hunks")] = [{"id": f"{found['gen']}:{i}:{h.key}", "keep": "Keep", "reject": "Reject",
                                "where": lines_of(h)} for i, h in enumerate(found["hunks"])]
            out[p("hunkNote")] = HUNK_NOTE
        if undo and undo["sid"] == shown["id"]:
            out[p("hunkUndo")] = [{"id": undo["id"], "text": undo["words"]}]

    # ── presses ──────────────────────────────────────────────────────────

    def _hunk_target(self, ctx: Context, data, values: dict):
        """(row, found, fresh head, the hunk, git) for a Keep or Reject
        press, or a Result saying why not."""
        key = str(values.get("row") or "")
        bad = {self.p("level"): "error"}
        with self._lock:
            sid = self.pinned
            found = dict(self._hunks) if self._hunks else None
        row = next((r for r in (data or {}).get("rows") or [] if r["id"] == sid), None)
        parts = key.split(":")
        if (row is None or not found or found["sid"] != sid or len(parts) != 3
                or parts[0] != str(found["gen"]) or not parts[1].isdigit()):
            return Result(False, "That diff changed under the press. Open the file's diff again.", updates=bad)
        index, want = int(parts[1]), parts[2]
        if index >= len(found["hunks"]) or found["hunks"][index].key != want:
            return Result(False, "That hunk isn't in the drawn diff.", updates=bad)
        root = Path(found["root"])
        if session_tree.inside(root.resolve(), str(root / found["path"])) is None:
            return Result(False, "That path is outside the project, so nothing was changed.", updates=bad)
        git = self.git_for(found["root"])
        got = ide_git.file_hunks(git, found["path"])
        if not got:
            return Result(False, "Couldn't read that file's diff again, so nothing was changed.", updates=bad,
                          refetch=True)
        head, fresh = got
        # The same change, found by its lines: the drawn index breaks a tie
        # between identical hunks and nothing else.
        same = [h for h in fresh if h.key == want]
        if not same:
            return Result(False, "That hunk changed since it was drawn, so nothing was changed. Look again.",
                          updates=bad, refetch=self._reread_patch(ctx, row, found))
        twins = [i for i, h in enumerate(found["hunks"]) if h.key == want]
        hunk = same[min(twins.index(index), len(same) - 1)]
        return row, found, head, hunk, git

    def _reread_patch(self, ctx: Context, row: dict, found: dict) -> bool:
        """Draw the file's diff again after a press: realm's patch, then the
        hunks beside it. A file with nothing left unstaged closes its diff."""
        from .agents import patch_text  # noqa: PLC0415  agents imports this module
        try:
            with self.connect(ctx) as conn:
                got = conn.call("workspace.fileDiff", {"cwd": self.repo_of(row), "path": found["path"],
                                                       "staged": False}, timeout=10.0, allow_exec=True)
        except realm_client.RealmError:
            got = None
        with self._lock:
            if isinstance(got, dict) and got.get("hunks"):
                self._patch = (row["id"], found["path"], patch_text(got))
            elif self._patch and self._patch[1] == found["path"]:
                self._patch = None
        self.load_hunks(row["id"], found["root"], found["path"], got)
        self._stale_changes()
        return True

    def hunk_keep(self, ctx: Context, data, values: dict) -> Result:
        """Stage one hunk. The file on disk is not touched."""
        got = self._hunk_target(ctx, data, values)
        if isinstance(got, Result):
            return got
        row, found, head, hunk, git = got
        name = PurePosixPath(found["path"]).name
        where = lines_of(hunk)
        if not self._claim("hunk", row["id"]):
            return Result(False, "Still doing the last hunk.")
        try:
            ok, why = ide_git.stage_hunk(git, head, hunk)
        finally:
            self._release("hunk", row["id"])
        if not ok:
            return Result(False, f"Nothing was staged: git refused that hunk ({why or 'no reason given'}).",
                          updates={self.p("level"): "error"}, refetch=self._reread_patch(ctx, row, found))
        with self._lock:
            self._hunk_undo = {"sid": row["id"], "kind": "keep", "id": f"keep:{hunk.key}", "root": found["root"],
                               "head": head, "hunk": hunk,
                               "words": f"Takes {where} of {name} back out of the commit"}
        self._reread_patch(ctx, row, found)
        return Result(True, f"Kept {where} of {name}: staged for the commit.",
                      updates={self.p("level"): "success"}, refetch=True)

    def hunk_reject(self, ctx: Context, data, values: dict) -> Result:
        """Put one hunk's lines back as they were, the file copied aside first."""
        got = self._hunk_target(ctx, data, values)
        if isinstance(got, Result):
            return got
        row, found, head, hunk, git = got
        bad = {self.p("level"): "error"}
        name = PurePosixPath(found["path"]).name
        where = lines_of(hunk)
        if not self._claim("hunk", row["id"]):
            return Result(False, "Still doing the last hunk.")
        try:
            try:
                with self.connect(ctx) as conn:
                    busy = self._fresh(conn, row["id"]).get("status") in ("running", "waiting_permission")
            except realm_client.RealmError:
                busy = True
            if busy:
                return Result(False, "Nothing was rejected: the agent is working and may be writing this file. "
                                     "Reject once it stops.", updates=bad)
            path = Path(found["root"]).resolve() / found["path"]
            written, why = ide_git.reject_hunk(path, hunk, self.backups())
        finally:
            self._release("hunk", row["id"])
        if written is None:
            return Result(False, f"Nothing was rejected: {why}.", updates=bad,
                          refetch=self._reread_patch(ctx, row, found))
        with self._lock:
            self._hunk_undo = {"sid": row["id"], "kind": "reject", "id": f"reject:{written.after[:16]}",
                               "written": written,
                               "words": f"Puts {where} of {name} back as the agent wrote them"}
        self._reread_patch(ctx, row, found)
        return Result(True, f"Rejected {where} of {name}. The file before is in {Path(written.backup).parent}.",
                      updates={self.p("level"): "success"}, refetch=True)

    def hunk_undo(self, ctx: Context, data, values: dict) -> Result:
        key = str(values.get("row") or "")
        bad = {self.p("level"): "error"}
        with self._lock:
            undo = dict(self._hunk_undo) if self._hunk_undo else None
            sid = self.pinned
        if not undo or undo["sid"] != sid or undo["id"] != key:
            return Result(False, "There's nothing to undo there any more.", updates=bad)
        if undo["kind"] == "keep":
            ok, why = ide_git.stage_hunk(self.git_for(undo["root"]), undo["head"], undo["hunk"], reverse=True)
            why = why and f"git refused ({why})"
        else:
            ok, why = ide_git.put_back(undo["written"])
        with self._lock:
            if self._hunk_undo and self._hunk_undo["id"] == key:
                self._hunk_undo = None
        row = next((r for r in (data or {}).get("rows") or [] if r["id"] == sid), None)
        with self._lock:
            found = dict(self._hunks) if self._hunks else None
        if row is not None and found:
            self._reread_patch(ctx, row, found)
        else:
            self._stale_changes()
        if not ok:
            return Result(False, f"Nothing was undone: {why or 'no reason given'}.", updates=bad, refetch=True)
        return Result(True, "Undone.", updates={self.p("level"): "success"}, refetch=True)

    # ── drawing ──────────────────────────────────────────────────────────

    def hunks_blank(self) -> dict:
        p = self.p
        return {p("hunks"): [], p("hunkNote"): "", p("hunkUndo"): []}

    def hunks_plan(self, out: dict) -> dict:
        p = self.p
        return {"hunks": bool(out.get(p("hunks"))), "hunkUndo": bool(out.get(p("hunkUndo")))}

    def patch_parts(self, plan: dict) -> tuple[list[str], list[str]]:
        """The Diff, with Keep and Reject on each hunk when they line up."""
        p, c = self.p, self.cid
        parts: list[str] = []
        order: list[str] = []
        if plan.get("hunks"):
            parts.append(comp(c("hunknote"), "Text", value=Bind(p("hunkNote")), tone="muted"))
            order.append("hunknote")
        if plan.get("patch"):
            extra = ({"hunks": Bind(p("hunks")), "keepAction": f"{ACTION_PREFIX}hunkkeep",
                      "rejectAction": f"{ACTION_PREFIX}hunkreject"} if plan.get("hunks") else {})
            parts.append(comp(c("patch"), "Diff", text=Bind(p("patch")), path=Bind(p("patchPath")), **extra))
            order.append("patch")
        if plan.get("hunkUndo"):
            parts.append(comp(c("hunkundo"), "Events", caption="", items=Bind(p("hunkUndo")),
                              action=f"{ACTION_PREFIX}hunkundo", actionLabel="Undo"))
            order.append("hunkundo")
        return parts, order
