"""The agent card's History: checkpoints and ships, restore, and pull requests.

Realm's space page has a History tab that "interleaves" the durable ship log
with checkpoints (rpc.ts, ships.list), and a checkpoints sheet whose restore
says what it costs before it runs (CheckpointsSheet.tsx, read 2026-10-11).
This is that, on the open card, through the engine's own RPCs:

    checkpoints.list      the session's turns' checkpoints (a read)
    checkpoints.preview   what restoring one would cost (git, so exec)
    checkpoints.restore   put the checkout back; a write, only from a press
    ships.list            what Commit and push actually did (a read)
    workspace.ship        with commit off and openPr on: Open PR (a write)

RESTORE. A press on a checkpoint row only previews it: the card then says
how many files and commits restoring rewrites, whether the conversation
rewinds with them, and that realm saves what is there now as an undo point
first. The Restore row's id carries the checkpoint and both counts, and the
press asks for the preview again and refuses if either count moved, which is
realm's own acknowledgement contract (RestoreAckSchema) kept on the glass
side too. Nothing restores while the agent is working.

PULL REQUESTS. Open PR is offered for a branch that is not the default
(main or master) with nothing staged, as realm's ship with the commit leg
off: it pushes the branch if it has to and opens the pull request with the
GitHub CLI, or hands back a compare URL when it can't. A ship row with a
pull request opens that page in the card, http and https only.
"""
from __future__ import annotations


import realm_client

from . import ACTION_PREFIX, Bind, Context, Result, comp

# History rows drawn, newest first, checkpoints and ships together. Realm's
# own list pages by 100; a card shows what was just done. Guessed.
HISTORY_SHOWN = 6
# ships.list asked for this many: enough to fill the rows above after the
# checkpoints take their share. Guessed.
SHIPS_READ = 10
# Branches a pull request is never offered from. Realm reads the remote's
# default branch inside its PR leg; the card only needs to not offer the
# obvious wrong one.
DEFAULT_BRANCHES = frozenset({"main", "master"})
KIND_WORDS = {"turn": "before a turn", "pre-restore": "undo point", "manual": "saved by hand"}
PUSH_STATE = {"pushed": "pushed", "up-to-date": "pushed", "skipped": "not pushed", "rejected": "push refused",
              "no-upstream": "not pushed", "no-remote": "no remote", "detached": "not pushed",
              "failed": "push failed"}


def counted(n: int, word: str) -> str:
    return f"1 {word}" if n == 1 else f"{n} {word}s"


def restore_words(p: dict) -> str:
    """What restoring costs, in one line: the files and commits it rewrites,
    then the truth that it can be undone (realm captures the state first)."""
    files, commits = int(p.get("filesChanged") or 0), int(p.get("commitsRolledBack") or 0)
    parts = [counted(files, "file")] if files else []
    if commits:
        parts.append(counted(commits, "commit"))
    if not parts:
        return "The checkout already matches it, so restoring changes nothing."
    talk = ("The conversation rewinds to it too." if p.get("rewindsConversation")
            else "Files only: the agent keeps its memory of those turns.")
    return f"Rewrites {' and '.join(parts)} to match it. What's there now is saved first as an undo point. {talk}"


class History:
    """Mixed into surfaces.agents.Agents after Ide. Uses the host's connect,
    _lock, pinned, p, cid, clean, ago, _claim, _release, _fresh, _git_press,
    _shipped_result, _environment_at and repo_of."""

    def _history_init(self) -> None:
        # (sid, read at, {"checkpoints": [...], "ships": [...]})
        self._history: tuple | None = None
        # (sid, checkpoint id, preview) after a press on a checkpoint row.
        self._preview: tuple | None = None
        # (sid, url) of a pull request opened in the card.
        self._pr: tuple | None = None
        p = ACTION_PREFIX
        self.actions.update({f"{p}hist": self.pick_history, f"{p}restore": self.restore,
                             f"{p}pr": self.open_pr, f"{p}prclose": self.close_pr})

    # ── reading ──────────────────────────────────────────────────────────

    def read_history(self, conn, row: dict, every: float) -> None:
        """The session's checkpoints and its space's ships, every `every`
        seconds while its card is open. Both are reads of realm's records."""
        with self._lock:
            fresh = self._history and self._history[0] == row["id"] and self.clock() - self._history[1] < every
        if fresh:
            return
        checkpoints, ships = [], []
        if row.get("environment"):
            got = conn.call("checkpoints.list", {"environmentId": row["environment"], "sessionId": row["id"]},
                            timeout=10.0)
            checkpoints = [c for c in got if isinstance(c, dict) and isinstance(c.get("id"), str)] \
                if isinstance(got, list) else []
        if row.get("space_id"):
            try:
                got = conn.call("ships.list", {"spaceId": row["space_id"], "limit": SHIPS_READ}, timeout=10.0)
            except realm_client.RealmRpcError:
                got = None  # an engine older than the ship log: no ships, not a dead card
            ships = [s for s in (got.get("ships") or [] if isinstance(got, dict) else [])
                     if isinstance(s, dict) and isinstance(s.get("id"), str)
                     and s.get("environmentId") == row.get("environment")]
        with self._lock:
            self._history = (row["id"], self.clock(), {"checkpoints": checkpoints, "ships": ships})

    # ── drawing ──────────────────────────────────────────────────────────

    def history_model(self, shown: dict, changes: dict, now_ms: float, values: dict, out: dict) -> None:
        p, clean = self.p, self._clean
        busy = shown["status"] in ("running", "waiting_permission")
        with self._lock:
            hist = self._history[2] if self._history and self._history[0] == shown["id"] else None
            preview = self._preview if self._preview and self._preview[0] == shown["id"] else None
            pr = self._pr[1] if self._pr and self._pr[0] == shown["id"] else ""
        rows = []
        for c in (hist or {}).get("checkpoints") or []:
            at = c.get("createdAt") if isinstance(c.get("createdAt"), (int, float)) else 0
            rows.append((at, {"id": f"c:{c['id']}", "kind": "checkpoint", "selected": bool(
                preview and preview[1] == c["id"]), "segments": [{"text": clean(c.get("label"), 80) or "Checkpoint",
                                                                 "match": False}],
                "where": " · ".join(x for x in (KIND_WORDS.get(str(c.get("kind")), ""), self._ago(at, now_ms)) if x)}))
        for s in (hist or {}).get("ships") or []:
            at = s.get("createdAt") if isinstance(s.get("createdAt"), (int, float)) else 0
            sha = clean(s.get("sha"), 40)[:7]
            branch = clean(s.get("branch"), 40)
            where = " · ".join(x for x in (f"{sha} on {branch}" if branch else sha,
                                           PUSH_STATE.get(str(s.get("pushState")), ""),
                                           "pull request" if s.get("prUrl") else "", self._ago(at, now_ms)) if x)
            rows.append((at, {"id": f"s:{s['id']}", "kind": "pr" if s.get("prUrl") else "ship",
                              "selected": bool(pr and pr == s.get("prUrl")),
                              "segments": [{"text": clean(s.get("subject"), 80) or sha, "match": False}],
                              "where": where}))
        rows.sort(key=lambda r: -r[0])
        out[p("history")] = [r for _, r in rows[:HISTORY_SHOWN]]
        if out[p("history")]:
            out[p("historyCap")] = "History"
        if preview:
            prev = preview[2]
            if not prev.get("intact", True):
                out[p("restoreNote")] = "That checkpoint's git objects are gone, so there's nothing to restore."
            else:
                out[p("restoreNote")] = clean(restore_words(prev), 240)
                if busy:
                    out[p("restoreNote")] += " Stop the agent first: nothing restores mid-turn."
                elif int(prev.get("filesChanged") or 0) or int(prev.get("commitsRolledBack") or 0):
                    out[p("restore")] = [{"id": f"restore:{preview[1]}:{int(prev.get('filesChanged') or 0)}:"
                                                f"{int(prev.get('commitsRolledBack') or 0)}", "accent": True,
                                          "text": clean(f"{shown['folder'] or 'Its folder'} back to "
                                                        f"“{clean(prev.get('label'), 50)}”", 100)}]
        branch = clean(changes.get("branch"), 60) if isinstance(changes, dict) else ""
        staged = any(f.get("staged") for f in (changes or {}).get("files") or [] if isinstance(f, dict)) \
            if isinstance(changes, dict) else False
        if branch and branch not in DEFAULT_BRANCHES and not staged and not busy and self.repo_of(shown):
            out[p("pr")] = [{"id": f"pr:{branch}", "text": clean(
                f"{branch} as a pull request on GitHub · pushes the branch first if it has to", 100)}]
        if pr:
            out[p("prWeb")] = pr
            out[p("prClose")] = [{"id": "prclose", "text": "The pull request's page, in the card"}]

    def history_parts(self, plan: dict) -> tuple[list[str], list[str]]:
        p, c = self.p, self.cid
        parts, order = [], []
        if plan.get("history"):
            parts.append(comp(c("history"), "Hits", caption=Bind(p("historyCap")), items=Bind(p("history")),
                              action=f"{ACTION_PREFIX}hist"))
            order.append("history")
        if plan.get("restoreNote"):
            parts.append(comp(c("restorenote"), "Text", value=Bind(p("restoreNote")), tone="muted"))
            order.append("restorenote")
        if plan.get("restore"):
            parts.append(comp(c("restore"), "Events", caption="", items=Bind(p("restore")),
                              action=f"{ACTION_PREFIX}restore", actionLabel="Restore"))
            order.append("restore")
        if plan.get("pr"):
            parts.append(comp(c("pr"), "Events", caption="", items=Bind(p("pr")), action=f"{ACTION_PREFIX}pr",
                              actionLabel="Open PR"))
            order.append("pr")
        if plan.get("prWeb"):
            parts += [comp(c("prweb"), "Web", url=Bind(p("prWeb"))),
                      comp(c("prclose"), "Events", caption="", items=Bind(p("prClose")),
                           action=f"{ACTION_PREFIX}prclose", actionLabel="Close")]
            order += ["prweb", "prclose"]
        return parts, order

    def history_plan(self, out: dict) -> dict:
        p = self.p
        return {k: bool(out.get(p(k))) for k in ("history", "restoreNote", "restore", "pr", "prWeb")}

    def history_blank(self) -> dict:
        p = self.p
        return {p("history"): [], p("historyCap"): "", p("restoreNote"): "", p("restore"): [], p("pr"): [],
                p("prWeb"): "", p("prClose"): []}

    # ── presses ──────────────────────────────────────────────────────────

    def _history_row(self, data) -> dict | None:
        with self._lock:
            sid = self.pinned
        return next((r for r in (data or {}).get("rows") or [] if r["id"] == sid), None)

    def pick_history(self, ctx: Context, data, values: dict) -> Result:
        """A checkpoint row previews its restore; a ship row with a pull
        request opens that page in the card. Both only read."""
        key = str(values.get("row") or "")
        row = self._history_row(data)
        with self._lock:
            hist = self._history[2] if row and self._history and self._history[0] == row["id"] else None
        if row is None or hist is None:
            return Result(False, "That history isn't the open agent's any more.")
        if key.startswith("c:"):
            cp = next((c for c in hist["checkpoints"] if c["id"] == key[2:]), None)
            if cp is None:
                return Result(False, "That checkpoint isn't there any more.", refetch=True)
            try:
                with self.connect(ctx) as conn:
                    prev = conn.call("checkpoints.preview", {"id": cp["id"]}, timeout=30.0, allow_exec=True)
            except realm_client.RealmError as err:
                return Result(False, f"Couldn't read what restoring costs: {self._rpc_words(err)}")
            if not isinstance(prev, dict):
                return Result(False, "The engine didn't say what restoring costs.")
            with self._lock:
                self._preview = (row["id"], cp["id"], prev)
            return Result(True, "Here's what restoring it would do.")
        if key.startswith("s:"):
            ship = next((s for s in hist["ships"] if s["id"] == key[2:]), None)
            url = self._web(ship.get("prUrl")) if ship else ""
            if not url:
                return Result(False, "That commit has no pull request to open.")
            with self._lock:
                self._pr = (row["id"], url)
            return Result(True, "Its pull request, in the card.")
        return Result(False, "That row isn't one of the open agent's.")

    def restore(self, ctx: Context, data, values: dict) -> Result:
        """checkpoints.restore with the counts the person was shown, after
        asking realm again: a checkout that changed since refuses."""
        key = str(values.get("row") or "")
        bad = {self.p("level"): "error"}
        row = self._history_row(data)
        parts = key.split(":")
        with self._lock:
            preview = self._preview if row and self._preview and self._preview[0] == row["id"] else None
        if (row is None or preview is None or len(parts) != 4 or parts[0] != "restore" or parts[1] != preview[1]
                or not parts[2].isdigit() or not parts[3].isdigit()):
            return Result(False, "That restore isn't the one on the card any more.", updates=bad)
        files, commits = int(parts[2]), int(parts[3])
        if not self._claim("restore", row["id"]):
            return Result(False, "Still restoring the last press.")
        try:
            with self.connect(ctx) as conn:
                if self._fresh(conn, row["id"]).get("status") in ("running", "waiting_permission"):
                    return Result(False, "Nothing was restored: the agent is working. Stop it first.", updates=bad)
                now = conn.call("checkpoints.preview", {"id": preview[1]}, timeout=30.0, allow_exec=True)
                if not isinstance(now, dict) or not now.get("intact", True) \
                        or int(now.get("filesChanged") or 0) != files \
                        or int(now.get("commitsRolledBack") or 0) != commits:
                    with self._lock:
                        self._preview = (row["id"], preview[1], now if isinstance(now, dict) else preview[2])
                    return Result(False, "Nothing was restored: the checkout changed since that was drawn. The "
                                         "card shows the new cost.", updates=bad)
                got = conn.call("checkpoints.restore", {"id": preview[1], "acknowledge": {
                    "filesChanged": files, "commitsRolledBack": commits}}, timeout=60.0, write=True)
        except realm_client.RealmError as err:
            if err.maybe_applied:
                return Result(False, "It may have restored; the engine didn't confirm. Check its changes before "
                                     "pressing again.", updates={self.p("level"): "warning"}, refetch=True)
            return Result(False, f"Nothing was restored: {self._rpc_words(err)}", updates=bad, refetch=True)
        finally:
            self._release("restore", row["id"])
        with self._lock:
            self._preview = None
            self._history = None
        self._stale_changes()
        got = got if isinstance(got, dict) else {}
        removed = int(got.get("filesRemoved") or 0)
        line = f"Restored {counted(int(got.get('filesChanged') or files), 'file')}" + (
            f", removing {counted(removed, 'newer file')}" if removed else "") + ". What it replaced is the " \
            "newest undo point in History."
        return Result(True, line, updates={self.p("level"): "success"}, refetch=True)

    def open_pr(self, ctx: Context, data, values: dict) -> Result:
        """realm's ship with the commit leg off and the PR leg on, for the
        branch the row named, only while that is still the branch."""
        key = str(values.get("row") or "")
        got = self._git_press(ctx, data, values, "pushed")
        if isinstance(got, Result):
            return got
        row, conn, changes = got
        bad = {self.p("level"): "error"}
        with conn:
            branch = self._clean(changes.get("branch"), 60)
            if key != f"pr:{branch}" or branch in DEFAULT_BRANCHES:
                return Result(False, "No pull request was opened: a different branch is checked out now.",
                              updates=bad, refetch=True)
            if any(f.get("staged") for f in changes.get("files") or [] if isinstance(f, dict)):
                return Result(False, "No pull request was opened: something is staged. Commit it first.",
                              updates=bad, refetch=True)
            if not self._claim("ship", row["id"]):
                return Result(False, "Still pushing the last press.")
            try:
                result = conn.call("workspace.ship", {
                    "cwd": self.repo_of(row), "commit": False, "message": "", "push": True, "setUpstream": False,
                    "openPr": True, "environmentId": self._environment_at(conn, row)}, timeout=180.0, write=True)
            except realm_client.RealmError as err:
                if err.maybe_applied:
                    return Result(False, "It may have pushed or opened it; the engine didn't confirm.",
                                  updates={self.p("level"): "warning"}, refetch=True)
                return Result(False, f"No pull request was opened: {self._rpc_words(err)}", updates=bad,
                              refetch=True)
            finally:
                self._release("ship", row["id"])
        pr = result.get("pr") if isinstance(result, dict) and isinstance(result.get("pr"), dict) else {}
        url = self._web(pr.get("url"))
        with self._lock:
            self._history = None
            if url:
                self._pr = (row["id"], url)
        shipped = self._shipped_result(row, result)
        word = {"created": "Opened the pull request.", "existing": "It already had a pull request; it's open below.",
                "compare": "GitHub's compare page is open below: the CLI couldn't open it for you.",
                "unavailable": "No pull request: GitHub isn't reachable from this repo."}.get(str(pr.get("state")))
        if word and url:
            return Result(True, word, updates={self.p("level"): "success"}, refetch=True)
        return shipped

    def close_pr(self, ctx: Context, data, values: dict) -> Result:
        with self._lock:
            self._pr = None
        return Result(True, "")
