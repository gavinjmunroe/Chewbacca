"""notifications: what's on the banners, drawn on the glass.

Rows come from `chewie notifications` (mac/lib/notifications.py), so the glass
and the command can't disagree. A notification was written by whoever sent it,
so its text is cleaned of control characters, cut to one row and only ever
drawn. Nothing here passes it to a model, runs it or presses anything in it.

Each refresh reads without taking focus. Read all is the only thing that opens
Notification Center, because it takes focus for a moment, and only a press may
do that.
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

from . import ACTION_PREFIX, Bind, Context, Provider, Result, SurfaceError, clip, comp, note_for

READER = Path(__file__).resolve().parents[3] / "mac" / "lib" / "notifications.py"
# Miller's ceiling in this repo's UX check: no more than 9 items in a list. Six
# rows at the row limit below stay under surface_lint's 1000 characters.
MOST_ROWS = 6
# surface_lint's ROW_CHARS is 120 for any one string; the whole row stays near it.
TEXT_CHARS = 110
# Read all stays up until banners return or this passes, or the next quiet
# refresh would wipe what the person just asked to see. Guessed, never measured.
KEEP_S = 60
CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f  ]+")
# surface_lint refuses a raw id on the glass, and a sender can put one in.
RAW_ID = re.compile(r"\b[0-9a-fA-F]{12,}\b")


def clean(value) -> str:
    return RAW_ID.sub("(id)", " ".join(CONTROL.sub(" ", str(value or "")).split()))


def row(item: dict) -> dict:
    title, body = clean(item.get("title")), clean(item.get("body"))
    text = clip(f"{title}: {body}" if title and body else title or body or "No preview", TEXT_CHARS)
    return {"id": f"n{item.get('index')}", "time": clip(clean(item.get("app")) or "Notification", 24), "text": text}


class Notifications(Provider):
    name = "notifications"
    title = "NOTIFICATIONS"
    region = "topRight"
    width = 380
    refresh = 15.0
    replaces = "Notification Center"

    def __init__(self) -> None:
        super().__init__()
        self.open_next = False
        self.kept: tuple[float, list] | None = None
        self.actions = {f"{ACTION_PREFIX}read-all": self.read_all}

    def fetch(self, ctx: Context) -> dict:
        opening, self.open_next = self.open_next, False
        code, out, err = ctx.run([sys.executable, str(READER), *(["--open"] if opening else [])])
        try:
            reply = json.loads(out)
        except (TypeError, ValueError):
            raise SurfaceError("Couldn't read notifications.") from None
        if code != 0 or not reply.get("ok"):
            raise SurfaceError(clip(f"Couldn't read notifications: {clean(reply.get('fix') or reply.get('error'))}", 110))
        items = reply.get("notifications") or []
        if opening:
            self.kept = (time.monotonic(), items)
        elif not items and self.kept and time.monotonic() - self.kept[0] < KEEP_S:
            items = self.kept[1]
        return {"items": items, "closed": reply.get("panel") == "closed"}

    def layout(self) -> list[str]:
        c = self.cid
        return [
            comp(c("s"), "Screen", title=self.title),
            comp(c("note"), "Text", value=Bind(self.p("note")), tone="muted"),
            comp(c("list"), "Events", caption="", items=Bind(self.p("list"))),
            comp(c("all"), "Button", label="Read all", action=f"{ACTION_PREFIX}read-all"),
            comp(c("status"), "Text", value=Bind(self.p("status")), tone="muted"),
            f"> {c('s')} {c('note')} {c('list')} {c('all')} {c('status')}",
            f"r {c('s')}",
        ]

    def initial(self) -> dict:
        return {self.p("status"): ""}

    def model(self, data, error, values, ctx) -> dict:
        items = (data or {}).get("items") or []
        rows = [row(i) for i in items[:MOST_ROWS] if isinstance(i, dict)]
        more = len(items) - len(rows)
        empty = "No banners right now." if not rows else (f"{more} more in Notification Center." if more > 0 else "")
        return {self.p("note"): note_for(data, error, empty), self.p("list"): rows}

    def read_all(self, ctx: Context, data, values: dict) -> Result:
        self.open_next = True
        return Result(True, "Reading Notification Center.", refetch=True)
