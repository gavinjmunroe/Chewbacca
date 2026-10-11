"""The rest of what Realm gives a space, on the open agent's card.

Code review, scheduled tasks and their runs, MCP connections and the space's
memory are what Realm's sidebar and space pages hold besides sessions
(rpc.ts at 59afd9e4, read 2026-10-11). Each is one row in a "This space"
list, kind by its glyph, and a press on a row only selects it; the one verb
that row can take then appears under the list, naming what it changes
(hud/CLAUDE.md, Past the window 3: at most one verb, and only where it acts).

    review.get / review.request   the last read-only review of this checkout,
                                  and asking for one (a reviewer in plan mode
                                  that can never ship; realm's own recipe)
    runs.list / runs.approve      a run blocked on approval, approved or not
    schedules.list / runNow       a scheduled task, run once now without
                                  moving its own clock
    mcp.list / mcp.setEnabled     a connection, switched on or off
    memory.get                    the space's memory file, opened in the
                                  card's File editor (FileSafety saves it)

Every write is a press on the verb row, whose id names the thing and the
state it was drawn in; the press reads it again and refuses if it moved.
"""
from __future__ import annotations

import os
from pathlib import Path

import realm_client
import session_tree

from . import ACTION_PREFIX, Bind, Context, Result, comp
from .agent_history import counted

# How often the space's records are read while a card is open. They change
# on a person's or a schedule's time, not a turn's. Guessed, never measured.
SPACE_EVERY = 30.0
# Rows of each kind shown. Guessed: a space with more schedules than this is
# a Scheduled page, which the glass doesn't try to be.
EACH = 3
REVIEW_WORDS = {"done": "reviewed", "stopped": "review stopped", "interrupted": "review interrupted",
                "timeout": "review timed out", "failed": "review failed", "gone": "reviewer gone"}
MCP_WORDS = {"connected": "connected", "idle": "idle", "error": "error", "circuit_open": "failing, paused"}


class Space:
    """Mixed into surfaces.agents.Agents. Uses connect, _lock, pinned, p,
    cid, clock, _clean, _ago, _rpc_words, _claim, _release, _file."""

    def _space_init(self) -> None:
        # (sid, read at, {review, runs, schedules, mcp, memory})
        self._space: tuple | None = None
        # (sid, row id) the person selected.
        self._space_pick: tuple | None = None
        p = ACTION_PREFIX
        self.actions.update({f"{p}space": self.pick_space, f"{p}spacedo": self.space_do})

    def read_space(self, conn, row: dict, ctx: Context) -> None:
        with self._lock:
            fresh = self._space and self._space[0] == row["id"] and self.clock() - self._space[1] < SPACE_EVERY
        if fresh or not row.get("space_id"):
            return
        got: dict = {"review": None, "runs": [], "schedules": [], "mcp": [], "memory": ""}

        def ask(method, params):
            try:
                return conn.call(method, params, timeout=10.0)
            except realm_client.RealmRpcError:
                return None  # an engine without that page: the row just isn't drawn

        if row.get("environment"):
            review = ask("review.get", {"environmentId": row["environment"]})
            got["review"] = review.get("review") if isinstance(review, dict) and isinstance(
                review.get("review"), dict) else None
        runs = ask("runs.list", {"spaceId": row["space_id"], "states": ["blocked"], "limit": EACH})
        got["runs"] = [r for r in (runs.get("runs") or [] if isinstance(runs, dict) else [])
                       if isinstance(r, dict) and isinstance(r.get("id"), str)][:EACH]
        schedules = ask("schedules.list", {"spaceId": row["space_id"]})
        got["schedules"] = [s for s in schedules if isinstance(s, dict) and isinstance(s.get("id"), str)][:EACH] \
            if isinstance(schedules, list) else []
        mcp = ask("mcp.list", {"spaceId": row["space_id"]})
        got["mcp"] = [m for m in (mcp.get("servers") or [] if isinstance(mcp, dict) else [])
                      if isinstance(m, dict) and isinstance(m.get("id"), str)][:EACH * 2]
        memory = ask("memory.get", {"spaceId": row["space_id"]})
        path = memory.get("path") if isinstance(memory, dict) else ""
        home = Path(self.engine_home(ctx)).resolve()
        if isinstance(path, str) and path and session_tree.editable(path, str(home)):
            got["memory"] = str(Path(path).resolve())
        with self._lock:
            self._space = (row["id"], self.clock(), got)

    def engine_home(self, ctx: Context) -> str:
        """Where realm keeps its own files: CHEWBACCA_REALM_HOME's realm, the
        folder the memory file must be inside to be opened."""
        env = ctx.env if isinstance(ctx.env, dict) else os.environ
        return str(Path(env.get("CHEWBACCA_REALM_HOME") or Path(ctx.home) / ".chewbacca" / "realm").expanduser())

    # ── drawing ──────────────────────────────────────────────────────────

    def space_model(self, shown: dict, changes: dict, now_ms: float, out: dict) -> None:
        p, clean = self.p, self._clean
        with self._lock:
            got = self._space[2] if self._space and self._space[0] == shown["id"] else None
            pick = self._space_pick[1] if self._space_pick and self._space_pick[0] == shown["id"] else ""
        if got is None:
            return
        busy = shown["status"] in ("running", "waiting_permission")
        rows: list[dict] = []

        def add(rid, kind, text, where):
            rows.append({"id": rid, "kind": kind, "segments": [{"text": clean(text, 70), "match": False}],
                         "where": clean(where, 90), "selected": rid == pick})

        review = got["review"]
        dirty = bool((changes or {}).get("files")) if isinstance(changes, dict) else False
        if review:
            first = clean(str(review.get("text") or "").strip().split("\n", 1)[0], 70)
            add("review", "review", first or REVIEW_WORDS.get(str(review.get("outcome")), "Review"),
                " · ".join(x for x in (REVIEW_WORDS.get(str(review.get("outcome")), ""),
                                       self._ago(review.get("createdAt") or 0, now_ms)) if x))
        elif dirty and shown.get("environment"):
            add("review", "review", "Ask for a code review", "a read-only reviewer reads these changes")
        for r in got["runs"]:
            add(f"run:{r['id']}", "run", r.get("title") or "A run", "waiting for your approval")
        for s in got["schedules"]:
            nxt = s.get("nextRunAt") if isinstance(s.get("nextRunAt"), (int, float)) else 0
            add(f"sch:{s['id']}", "schedule", s.get("title") or "Scheduled task",
                " · ".join(x for x in (clean(s.get("cron"), 30), "on" if s.get("enabled") else "off",
                                       f"last ran {self._ago(s.get('lastRunAt') or 0, now_ms)}"
                                       if s.get("lastRunAt") else "") if x)
                if nxt or not s.get("enabled") else clean(s.get("cron"), 30))
        for m in got["mcp"]:
            add(f"mcp:{m['id']}", "mcp", m.get("name") or "A connection",
                "off" if not m.get("enabled") else MCP_WORDS.get(str(m.get("status")), "") +
                (f" · {counted(len(m.get('tools') or []), 'tool')}" if m.get("tools") else ""))
        if got["memory"]:
            add("memory", "memory", "Memory", "what every agent in this space is told first")
        out[p("space")] = rows
        if rows:
            out[p("spaceCap")] = "This space"
        out[p("spaceDo")] = self._space_verb(shown, got, pick, dirty, busy)
        label = {"review": "Review", "run": "Approve", "sch": "Run now", "mcp": "Switch"}
        out[p("spaceDoLabel")] = label.get(pick.split(":", 1)[0], "Go")

    def _space_verb(self, shown: dict, got: dict, pick: str, dirty: bool, busy: bool) -> list[dict]:
        """The one verb row for the selected thing, naming what it changes."""
        clean = self._clean
        if pick == "review" and dirty and shown.get("environment") and not busy:
            return [{"id": f"review:{shown['environment']}", "accent": True, "text": clean(
                f"A reviewer reads {shown['folder'] or 'these'} changes in plan mode · it can't edit or ship", 100)}]
        kind, _, rid = pick.partition(":")
        if kind == "run":
            run = next((r for r in got["runs"] if r["id"] == rid), None)
            if run:
                return [{"id": f"run:{rid}:{run.get('attempt')}", "accent": True, "text": clean(
                    f"Lets “{clean(run.get('title'), 40)}” carry on", 100)}]
        if kind == "sch":
            sch = next((s for s in got["schedules"] if s["id"] == rid), None)
            if sch:
                return [{"id": f"sch:{rid}", "accent": True, "text": clean(
                    f"Runs “{clean(sch.get('title'), 40)}” once now · its own schedule doesn't move", 100)}]
        if kind == "mcp":
            m = next((x for x in got["mcp"] if x["id"] == rid), None)
            if m:
                on = bool(m.get("enabled"))
                return [{"id": f"mcp:{rid}:{'off' if on else 'on'}", "text": clean(
                    f"{'Turns off' if on else 'Turns on'} {clean(m.get('name'), 30)} for agents in this space", 100)}]
        return []

    def space_parts(self, plan: dict) -> tuple[list[str], list[str]]:
        p, c = self.p, self.cid
        parts, order = [], []
        if plan.get("space"):
            parts.append(comp(c("space"), "Hits", caption=Bind(p("spaceCap")), items=Bind(p("space")),
                              action=f"{ACTION_PREFIX}space"))
            order.append("space")
        if plan.get("spaceDo"):
            parts.append(comp(c("spacedo"), "Events", caption="", items=Bind(p("spaceDo")),
                              action=f"{ACTION_PREFIX}spacedo", actionLabel=Bind(p("spaceDoLabel"))))
            order.append("spacedo")
        return parts, order

    def space_plan(self, out: dict) -> dict:
        p = self.p
        return {"space": bool(out.get(p("space"))), "spaceDo": bool(out.get(p("spaceDo")))}

    def space_blank(self) -> dict:
        p = self.p
        return {p("space"): [], p("spaceCap"): "", p("spaceDo"): [], p("spaceDoLabel"): "Go"}

    # ── presses ──────────────────────────────────────────────────────────

    def pick_space(self, ctx: Context, data, values: dict) -> Result:
        """Select a row; memory opens its file in the card at once (a read,
        and the editor's own save is the person's)."""
        key = str(values.get("row") or "")
        with self._lock:
            sid = self.pinned
            got = self._space[2] if self._space and self._space[0] == sid else None
        if got is None:
            return Result(False, "That isn't the open agent's space any more.")
        if key == "memory":
            if not got["memory"]:
                return Result(False, "This space has no memory file yet.")
            with self._lock:
                self._file = (sid, got["memory"], 0, str(Path(got["memory"]).parent))
            return Result(True, "The space's memory, in the editor.")
        known = {"review"} | {f"run:{r['id']}" for r in got["runs"]} | {f"sch:{s['id']}" for s in got["schedules"]} \
            | {f"mcp:{m['id']}" for m in got["mcp"]}
        if key not in known:
            return Result(False, "That row isn't there any more.")
        with self._lock:
            self._space_pick = None if self._space_pick == (sid, key) else (sid, key)
        if key == "review" and got["review"]:
            text = self._clean(str(got["review"].get("text") or ""), 2000, one_line=False)
            return Result(True, "", updates={self.p("patch"): text, self.p("patchPath"): ""})
        return Result(True, "")

    def space_do(self, ctx: Context, data, values: dict) -> Result:
        """The selected row's one verb. Each re-reads its thing first."""
        key = str(values.get("row") or "")
        bad = {self.p("level"): "error"}
        with self._lock:
            sid = self.pinned
            got = self._space[2] if self._space and self._space[0] == sid else None
            pick = self._space_pick[1] if self._space_pick and self._space_pick[0] == sid else ""
        row = next((r for r in (data or {}).get("rows") or [] if r["id"] == sid), None)
        if row is None or got is None or not pick or not key.startswith(pick.split(":", 1)[0]):
            return Result(False, "That isn't the selected row any more.", updates=bad)
        if not self._claim("space", sid):
            return Result(False, "Still doing the last press.")
        try:
            with self.connect(ctx) as conn:
                return self._space_write(conn, row, got, pick, key)
        except realm_client.RealmError as err:
            if err.maybe_applied:
                return Result(False, "It may have gone through; the engine didn't confirm.",
                              updates={self.p("level"): "warning"}, refetch=True)
            return Result(False, f"Nothing changed: {self._rpc_words(err)}", updates=bad, refetch=True)
        finally:
            self._release("space", sid)
            # Read again, and the verb goes with the press: what it was drawn
            # from has changed or may have.
            with self._lock:
                self._space = None
                self._space_pick = None

    def _space_write(self, conn, row: dict, got: dict, pick: str, key: str) -> Result:
        bad = {self.p("level"): "error"}
        ok = {self.p("level"): "success"}
        kind, _, rid = pick.partition(":")
        if pick == "review":
            if key != f"review:{row.get('environment')}":
                return Result(False, "That review was for another checkout.", updates=bad)
            if self._fresh(conn, row["id"]).get("status") in ("running", "waiting_permission"):
                return Result(False, "No review asked for: the agent is still working.", updates=bad)
            conn.call("review.request", {"environmentId": row["environment"]}, timeout=30.0, write=True)
            return Result(True, "A reviewer is reading the changes. Its verdict lands here.", updates=ok,
                          refetch=True)
        if kind == "run":
            now = conn.call("runs.get", {"id": rid}, timeout=10.0)
            run = now.get("run") if isinstance(now, dict) and isinstance(now.get("run"), dict) else now
            if not isinstance(run, dict) or run.get("state") != "blocked" or key != f"run:{rid}:{run.get('attempt')}":
                return Result(False, "Not approved: that run isn't waiting any more.", updates=bad, refetch=True)
            conn.call("runs.approve", {"id": rid, "approved": True, "note": None}, timeout=10.0, write=True)
            return Result(True, "Approved. The run carries on.", updates=ok, refetch=True)
        if kind == "sch":
            if key != f"sch:{rid}" or not any(s["id"] == rid for s in got["schedules"]):
                return Result(False, "That task isn't there any more.", updates=bad)
            conn.call("schedules.runNow", {"id": rid}, timeout=30.0, write=True)
            return Result(True, "Started a run of it. Its schedule didn't move.", updates=ok, refetch=True)
        if kind == "mcp":
            m = next((x for x in got["mcp"] if x["id"] == rid), None)
            want = key.rsplit(":", 1)[-1]
            if m is None or key != f"mcp:{rid}:{'off' if m.get('enabled') else 'on'}":
                return Result(False, "That connection changed since it was drawn.", updates=bad, refetch=True)
            conn.call("mcp.setEnabled", {"spaceId": row["space_id"], "id": rid, "enabled": want == "on"},
                      timeout=10.0, write=True)
            return Result(True, f"{self._clean(m.get('name'), 30)} is {want}.", updates=ok, refetch=True)
        return Result(False, "Nothing to do for that row.", updates=bad)
