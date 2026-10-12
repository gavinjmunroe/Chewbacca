"""realm: Carlton's own Realm interface on the glass, in place of the rebuilt card.

Realm (github.com/31Carlton7/realm, Carlton Aikins) draws its sessions list,
session view, editor, diff, terminal and command palette in one React
renderer. bin/realm-ui builds that renderer as written and serves it on
127.0.0.1 with a pipe to the engine Kyber already runs; this surface puts it
on the glass with the `App` component (hud AppPane.swift).

It is a glance: it comes up centred, a click off it or Escape takes it down,
and "show my agents" opens it whenever the bundle is built. The Swift agent
card (agents.py) stays the answer when it is not, and for the parts a web
view cannot do (see bin/lib/realm_ui/bridge.js).

Nothing here acts. Every send, approve, stage and ship is a press inside
Realm's own interface, made by the person, exactly as in Carlton's window.
"""
from __future__ import annotations

from . import Bind, Context, Provider, SurfaceError, comp

# Realm's window refuses to go narrower than 900 points (apps/desktop/src/main/
# index.ts minWidth at 59afd9e4). 1180 is that plus its side pane at a
# comfortable width, and fits the 1512-point default of a 14-inch MacBook Pro
# with the glass's margins; guessed from those two numbers, not measured on
# a smaller display.
WIDTH = 1180


class RealmApp(Provider):
    name = "realm"
    title = ""
    region = "center"
    width = WIDTH
    # Only to notice a server that went away; the page talks to the engine
    # itself and needs no redraw from here.
    refresh = 30.0
    replaces = "Realm's desktop app and VS Code's agent tabs"
    chrome = "glass"

    def __init__(self, start=None) -> None:
        super().__init__()
        self._start = start

    def fetch(self, ctx: Context) -> dict:
        import realm_ui  # noqa: PLC0415  bin/lib, loaded when the surface opens

        try:
            live = (self._start or realm_ui.start)()
        except RuntimeError as err:
            raise SurfaceError(str(err)) from None
        return {"url": live.get("url", "")}

    def layout(self) -> list[str]:
        s = self.cid("s")
        return [
            # A click off it takes it down (OverlayModel.clickedAway).
            f"glance {self.name}",
            comp(s, "Screen"),
            f"r {s}",
            comp(self.cid("app"), "App", url=Bind(self.p("url"))),
            comp(self.cid("note"), "Text", value=Bind(self.p("note")), tone="warn"),
            f"> {s} {self.cid('note')} {self.cid('app')}",
        ]

    def model(self, data, error, values, ctx) -> dict:
        # On glass an empty Text draws nothing, so the note shows only when
        # something is wrong, and the page only when there is one.
        return {self.p("url"): (data or {}).get("url", "") if not error else "",
                self.p("note"): error or ""}


def available() -> bool:
    """Whether Realm's interface is built, so "show my agents" can open it."""
    try:
        import realm_ui  # noqa: PLC0415
    except ImportError:
        return False
    return realm_ui.built()
