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

# 1000 points, centred. At 1180 the surface ran under the desktop icons on
# Caleb's 1246-point-wide display (10/12 3:38pm, live-test/first-live-1538.png:
# Archive, Forge bros, sagar-demo, Capsule and Screenshots cut by its right
# edge, their labels starting about 1147 points in). 1000 leaves 123 points
# each side there, 24 clear of those labels, and still holds the nav column
# (232) beside a story or Carlton's transcript. Measured on that one display.
WIDTH = 1000


class RealmApp(Provider):
    name = "realm"
    title = ""
    region = "center"
    width = WIDTH
    # Only to notice a server that went away; the page talks to the engine
    # itself and needs no redraw from here.
    refresh = 30.0
    replaces = "Realm's desktop app and VS Code's agent tabs"
    # The page floats its own surfaces (agent tiles, Carlton's panes, the
    # stage) on the desktop and leaves the rest clear; a frosted field the
    # size of the surface behind it read as a window (realm-hud-report.md).
    chrome = "clear"

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
        # something is wrong, and the page only when there is one. Before the
        # first fetch the address is the one the server last wrote, so the
        # opening frame already carries the page Kyber keeps warm instead of
        # waiting a fetch (a `ps` call) for it; the fetch then confirms it.
        if error:
            return {self.p("url"): "", self.p("note"): error}
        url = (data or {}).get("url", "") if data is not None else _last_url()
        return {self.p("url"): url, self.p("note"): ""}


def _last_url() -> str:
    try:
        import realm_ui  # noqa: PLC0415
        return realm_ui.last_url()
    except ImportError:
        return ""


def available() -> bool:
    """Whether Realm's interface is built, so "show my agents" can open it."""
    try:
        import realm_ui  # noqa: PLC0415
    except ImportError:
        return False
    return realm_ui.built()
