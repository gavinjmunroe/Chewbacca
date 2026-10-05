"""apps: the launcher rail. One frosted capsule on the right edge, an SF Symbol
per surface Kyber actually has, a badge where something is waiting, and a
press opens that surface.

On 2026-10-05 "show me the built in hud apps" matched no surface, so it fell
through to genui, and the model drew six unpressable boxes, two of them
(Grades, Campaigns) surfaces that do not exist, while code, notes, github and
whatsapp were missing. The first fix was a twelve-row table with an Open
button on each row, and Caleb's verdict was "TS so ugly". Opal's desktop,
the bar in skills/kyber-surfaces, launches from a rail of icons with badges,
and hud/CLAUDE.md already has that component. The items come from the
registry, so the rail can only offer what `make()` can open.

A press arrives as `e action open row=<kind> surface=apps`, which
kyber-surfaces turns into an open of that kind, and only a listed one.
"""
from __future__ import annotations

import json
from pathlib import Path

from . import Context, Provider, comp

BADGES = Path.home() / ".bob" / "badges.json"
# Kinds that are not a destination of their own: person and space need an
# argument, engine needs an id (oss lists the engines), apps is this rail.
NOT_LISTED = ("person", "space", "engine", "apps")
# Order is by what gets opened most: what is waiting first, then the day,
# then the conversations and the work.
ORDER = ("needs-you", "today", "conversations", "whatsapp", "meetings", "tasks", "people", "code", "github",
         "notes", "files", "music", "oss")
SYMBOLS = {
    "needs-you": "bell.badge", "today": "calendar", "conversations": "message", "whatsapp": "phone.bubble",
    "tasks": "checklist", "people": "person.2", "code": "chevron.left.forwardslash.chevron.right",
    "github": "arrow.triangle.branch", "notes": "note.text", "files": "folder", "music": "music.note",
    "oss": "shippingbox", "meetings": "waveform",
}
LABELS = {"needs-you": "Needs you", "oss": "Open source", "github": "GitHub", "whatsapp": "WhatsApp"}


def kinds() -> list[str]:
    """Every openable kind, in rail order; a kind added to the registry and
    not yet ordered here goes on the end rather than going missing."""
    from . import KINDS  # noqa: PLC0415  the registry, read when drawn

    listed = [k for k in KINDS if k not in NOT_LISTED]
    return [k for k in ORDER if k in listed] + [k for k in listed if k not in ORDER]


def item(kind: str) -> dict:
    return {"id": kind, "label": LABELS.get(kind, kind.capitalize()), "symbol": SYMBOLS.get(kind, "square.grid.2x2")}


class Apps(Provider):
    name = "apps"
    title = ""
    region = "right"
    width = 52
    refresh = 30.0
    replaces = "the Dock and Launchpad"
    # Read by kyber-surfaces: a rail keeps its own edge and draws its own glass.
    chrome = "bare"
    pinned = True

    def fetch(self, ctx: Context) -> dict:
        try:
            counts = json.loads(BADGES.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            counts = {}
        return {"needs-you": counts.get("needsYou")}

    def layout(self) -> list[str]:
        return [
            comp(self.cid("s"), "Screen"),
            f"r {self.cid('s')}",
            comp(self.cid("rail"), "Rail", items=[item(k) for k in kinds()]),
            f"> {self.cid('s')} {self.cid('rail')}",
        ]

    def initial(self) -> dict:
        return {}

    def model(self, data, error, values, ctx) -> dict:
        n = (data or {}).get("needs-you")
        # The rail shows a badge only for a whole number above zero.
        return {"/badges/needs-you": n if isinstance(n, int) and n > 0 else 0}

    def opens(self, kind: str) -> str | None:
        """The kind a rail press may open, or None."""
        return kind if kind in kinds() else None
