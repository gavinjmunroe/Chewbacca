"""music: what is playing, and play/pause, back and skip.

Replaces switching to Spotify or Music for the three things a person does there
mid-task. Everything goes through `hud-music`, the same player the voice drives,
so a song started by voice shows here and a press here is what the voice would
have done. Play/Pause is the primary action; back and skip sit beside it.
"""
from __future__ import annotations

import re
from pathlib import Path

from . import ACTION_PREFIX, Bind, Context, Provider, Result, SurfaceError, clip, comp, note_for

# "make heaven crowded by Josiah Queen, on Spotify, paused." is what
# `hud-music now` printed on 2026-10-04; the three sources word it differently.
NOW = re.compile(r"^(?P<track>.+?), (?:on (?P<spotify>Spotify)|from (?P<youtube>YouTube)|in (?P<music>Music))"
                 r"(?P<paused>, paused)?\.?$")
NOTHING = "Nothing's playing."


def hud_music(ctx: Context) -> str:
    """bin/hud-music beside this package, so a checkout uses its own player."""
    here = Path(__file__).resolve().parents[2] / "hud-music"
    return str(here) if here.exists() else "hud-music"


def parse_now(line: str) -> dict | None:
    line = (line or "").strip()
    if not line or line == NOTHING:
        return None
    m = NOW.match(line)
    if not m:
        return {"track": clip(line, 60), "artist": "", "source": "", "paused": False}
    track, artist = m.group("track"), ""
    if " by " in track:
        track, artist = track.rsplit(" by ", 1)
    source = "Spotify" if m.group("spotify") else "YouTube" if m.group("youtube") else "Music"
    return {"track": clip(track, 60), "artist": clip(artist, 60), "source": source,
            "paused": bool(m.group("paused"))}


class Music(Provider):
    name = "music"
    title = "NOW PLAYING"
    region = "bottomRight"
    width = 320
    refresh = 5.0
    replaces = "Spotify and Music"

    def __init__(self) -> None:
        super().__init__()
        self.actions = {
            f"{ACTION_PREFIX}toggle": self.toggle,
            f"{ACTION_PREFIX}next": lambda ctx, data, values: self.command(ctx, "next"),
            f"{ACTION_PREFIX}previous": lambda ctx, data, values: self.command(ctx, "previous"),
        }

    def fetch(self, ctx: Context) -> dict:
        code, out, err = ctx.run([hud_music(ctx), "now"])
        if code != 0 and (out or "").strip() != NOTHING:
            raise SurfaceError(f"Player didn't answer: {clip(err or out, 80)}")
        return {"now": parse_now(out)}

    def layout(self) -> list[str]:
        return [
            comp(self.cid("s"), "Screen", title=self.title),
            comp(self.cid("track"), "Heading", text=Bind(self.p("track")), level=2),
            comp(self.cid("by"), "Text", value=Bind(self.p("by")), tone="muted"),
            comp(self.cid("row"), "Stack", direction="grid", cols=3, gap=2),
            comp(self.cid("prev"), "Button", label="Back", action=f"{ACTION_PREFIX}previous"),
            comp(self.cid("toggle"), "Button", label=Bind(self.p("toggle")), action=f"{ACTION_PREFIX}toggle",
                 variant="primary"),
            comp(self.cid("next"), "Button", label="Skip", action=f"{ACTION_PREFIX}next"),
            comp(self.cid("status"), "Text", value=Bind(self.p("status")), tone="muted"),
            f"> {self.cid('row')} {self.cid('prev')} {self.cid('toggle')} {self.cid('next')}",
            f"> {self.cid('s')} {self.cid('track')} {self.cid('by')} {self.cid('row')} {self.cid('status')}",
            f"r {self.cid('s')}",
        ]

    def initial(self) -> dict:
        return {self.p("status"): ""}

    def model(self, data, error, values, ctx) -> dict:
        if data is None:
            return {self.p("track"): note_for(None, error, ""), self.p("by"): "", self.p("toggle"): "Play"}
        now = data.get("now")
        if error and now is None:
            return {self.p("track"): "Player unavailable", self.p("by"): error, self.p("toggle"): "Play"}
        if now is None:
            return {self.p("track"): "Nothing playing", self.p("by"): "Say \"play\" and a song",
                    self.p("toggle"): "Play"}
        by = " · ".join(x for x in (now["artist"], now["source"] + (", paused" if now["paused"] else "")) if x)
        if error:
            # The last song stays up; the line under it says it may be stale.
            by = note_for(data, error, "", data.get("_at"))
        return {self.p("track"): now["track"], self.p("by"): by,
                self.p("toggle"): "Play" if now["paused"] else "Pause"}

    def command(self, ctx: Context, verb: str) -> Result:
        code, out, err = ctx.run([hud_music(ctx), verb])
        line = (out or err or "").strip().splitlines()
        text = clip(line[-1] if line else verb.capitalize(), 80)
        return Result(code == 0, text, refetch=True)

    def toggle(self, ctx: Context, data, values: dict) -> Result:
        now = (data or {}).get("now")
        return self.command(ctx, "resume" if (now is None or now["paused"]) else "pause")
