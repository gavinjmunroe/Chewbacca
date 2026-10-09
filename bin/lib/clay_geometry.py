"""Page rectangles to screen points, for drawing on Clay.

Chrome reports a control's place in CSS pixels inside the page. Kyber draws in
screen points from the top-left of the main display, the space every `m`, `a`
and `near=` line uses. The two differ by the window's position, the toolbar
above the page, and page zoom. This is the one place that conversion happens;
everything downstream works in screen points.
"""
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass

# Chrome's toolbar on macOS, tabs plus omnibox, with or without the bookmarks
# bar. Guessed, never measured: the dry run replaces this with what it read.
# Outside it, something is docked in the window (DevTools at the bottom) and
# every y would be off by its height.
TOOLBAR_RANGE = (40.0, 160.0)

# How far the page may be narrower than the window, in points. Chrome on macOS
# draws no side frame, so the page fills the window's width unless DevTools or
# a side panel is docked left or right, which shifts every x. Guessed, never
# measured: rounding at 125% zoom is at most 1.25 pt, and the dry run reads
# the real gap.
SIDE_SLACK = 8.0


@dataclass(frozen=True)
class Rect:
    x: float
    y: float
    w: float
    h: float


@dataclass(frozen=True)
class Window:
    """What the page reports about its own window, from one eval."""

    screen_x: float
    screen_y: float
    outer_w: float
    outer_h: float
    inner_w: float
    inner_h: float
    dpr: float

    @classmethod
    def from_page(cls, page: dict) -> "Window":
        """From `frame()` in clay_find.js, whose keys these are."""
        return cls(*(float(page[key]) for key in (
            "screen_x", "screen_y", "outer_w", "outer_h", "inner_w", "inner_h", "dpr")))


@dataclass(frozen=True)
class Display:
    width: float
    height: float
    scale: float


def _zoom(win: Window, display: Display) -> float:
    return win.dpr / display.scale


def _toolbar(win: Window, display: Display) -> float:
    return win.outer_h - win.inner_h * _zoom(win, display)


def to_screen(rect: Rect, win: Window, display: Display) -> Rect:
    zoom = _zoom(win, display)
    return Rect(win.screen_x + rect.x * zoom, win.screen_y + _toolbar(win, display) + rect.y * zoom,
                rect.w * zoom, rect.h * zoom)


def problem(win: Window, display: Display) -> str | None:
    """Why drawing now would land in the wrong place, as a sentence for the
    person, or None."""
    if (win.screen_x < 0 or win.screen_y < 0
            or win.screen_x + win.outer_w > display.width + 1
            or win.screen_y + win.outer_h > display.height + 1):
        return "Move the Clay window onto the main display, then press Try again."
    low, high = TOOLBAR_RANGE
    if (not low <= _toolbar(win, display) <= high
            or abs(win.outer_w - win.inner_w * _zoom(win, display)) > SIDE_SLACK):
        return "Close DevTools or any panel docked in the Clay window, then press Try again."
    return None


_JXA = ('ObjC.import("AppKit"); var s = $.NSScreen.screens.objectAtIndex(0);'
        'JSON.stringify([s.frame.size.width, s.frame.size.height, s.backingScaleFactor])')


def read_display(run=subprocess.run) -> Display:
    """The main display's size in points and its backing scale. JXA reads
    NSScreen without any permission."""
    proc = run(["osascript", "-l", "JavaScript", "-e", _JXA],
               capture_output=True, text=True, timeout=10)
    if proc.returncode != 0:
        raise RuntimeError(f"could not read the display: {proc.stderr.strip()}")
    width, height, scale = json.loads(proc.stdout)
    return Display(float(width), float(height), float(scale))
