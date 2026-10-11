"""setup: the rest of Chewbacca, one press each, on the glass.

The same steps `chewbacca welcome stack` lists (bin/lib/onboard_stack.py):
Google, Granola, meeting recording, the agent engine, the agents and meetings
panels, and Chewbacca inside Claude, Cursor and Codex. Caleb, 2026-10-11: each
piece "one tap or approval in the HUD, permission panes opened for them, no
terminal, no config files".

Two lists, so a row's button always means the same thing: what is left, each
with a Set up button, and what is done, with none. A press runs
`chewbacca welcome connect <id>`, which opens the browser page or the
Settings pane itself, and its one line becomes the status.

Recording records other people, so it ships off. Its row says so, and its
Set up press is the person's yes: the press is the only thing here that passes
--yes, and only for the row pressed, only when the last fetch listed it as
not done.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from . import ACTION_PREFIX, Bind, Context, Provider, Result, SurfaceError, clip, comp, note_for

WELCOME = Path(__file__).resolve().parents[2] / "chewbacca-welcome"

# Each row's words on the glass: the step's full `say` line runs 100 to 260
# characters, and surface_lint's row limit is 120.
SHORT = {
    "mcp": ("Chewbacca in Claude, Cursor and Codex", "Restart the app after"),
    "google": ("Your Google account", "Gmail, Calendar and Drive"),
    "granola": ("Your Granola meetings", "Brought in once, read only"),
    "engine": ("The agent engine", "Agents with no window, a few minutes once"),
    "hud": ("Agents and meetings panels", "Needs the agent engine"),
    "recording": ("Record my meetings", "Off. Everyone on a call has to agree"),
}


def row(step: dict) -> dict:
    title, sub = SHORT.get(step["id"], (step.get("label", step["id"]), ""))
    if step["state"] == "blocked":
        sub = "Needs a step first"
    return {"id": step["id"], "text": title, "time": sub, "accent": step["id"] == "recording"}


class Setup(Provider):
    name = "setup"
    title = "SET UP"
    region = "topRight"
    width = 380
    refresh = 30.0
    replaces = "setup screens and config files"

    def __init__(self) -> None:
        super().__init__()
        self.actions = {f"{ACTION_PREFIX}connect": self.connect}

    def fetch(self, ctx: Context) -> dict:
        body = ctx.json([sys.executable, str(WELCOME), "stack"], "Setup")
        steps = body.get("steps") if isinstance(body, dict) else None
        if not isinstance(steps, list):
            raise SurfaceError("Setup didn't list its steps")
        return {"steps": [s for s in steps if isinstance(s, dict) and s.get("id") in SHORT]}

    def layout(self) -> list[str]:
        c = self.cid
        return [
            comp(c("s"), "Screen", title=self.title),
            comp(c("note"), "Text", value=Bind(self.p("note")), tone="muted"),
            comp(c("todo"), "Events", caption=Bind(self.p("todoCaption")), items=Bind(self.p("todo")),
                 action=f"{ACTION_PREFIX}connect", actionLabel="Set up"),
            comp(c("done"), "Events", caption=Bind(self.p("doneCaption")), items=Bind(self.p("done"))),
            comp(c("status"), "Text", value=Bind(self.p("status")), tone="muted"),
            f"> {c('s')} {c('note')} {c('todo')} {c('done')} {c('status')}",
            f"r {c('s')}",
        ]

    def initial(self) -> dict:
        return {self.p("status"): ""}

    def model(self, data, error, values, ctx) -> dict:
        steps = (data or {}).get("steps") or []
        todo = [row(s) for s in steps if s.get("state") in ("ready", "blocked")]
        done = [row(s) | {"time": "On"} for s in steps if s.get("state") == "done"]
        empty = "All set." if steps and not todo else ""
        return {
            self.p("note"): note_for(data, error, empty, (data or {}).get("_at")),
            self.p("todoCaption"): "Left" if todo else "",
            self.p("todo"): todo,
            self.p("doneCaption"): "Done" if done else "",
            self.p("done"): done,
        }

    def connect(self, ctx: Context, data, values: dict) -> Result:
        step_id = str(values.get("row") or "")
        listed = {s.get("id"): s for s in (data or {}).get("steps") or [] if isinstance(s, dict)}
        step = listed.get(step_id)
        # Only a row the person could see a button on: a press naming a step
        # that is done, absent or not listed runs nothing.
        if not step or step.get("state") not in ("ready", "blocked"):
            return Result(False, "That one is already set up.", refetch=True)
        argv = [sys.executable, str(WELCOME), "connect", step_id]
        if step_id == "recording":
            argv.append("--yes")
        code, out, err = ctx.run(argv)
        try:
            got = json.loads(out or "{}")
        except ValueError:
            got = {}
        said = (err or out or "").strip().splitlines()
        line = got.get("say") or (f"BLOCKED: {got['blocked']}" if got.get("blocked") else "") \
            or (said[-1] if said else "Done.")
        return Result(code == 0 and bool(got.get("ok")), clip(line, 160), refetch=True)
