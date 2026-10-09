"""The Clay page, driven through `chewie web eval`.

Every touch is one eval: the finder (clay_find.js) plus a few lines that call
it. The eval runs in Chewie's own debug-port Chrome (mac/bridge/web.js), never
the person's everyday window, and never with a URL argument, which opens a new
tab instead of using the one they are watching.

Each eval is a subprocess this module polls rather than waits on, so a Stop
kills it within one poll instead of after Clay's 90 second search.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from clay_geometry import Rect, Window

ROOT = Path(__file__).resolve().parents[2]
CHEWIE = shutil.which("chewie") or str(ROOT / "mac" / "bin" / "chewie")
FIND_JS = Path(__file__).with_name("clay_find.js").read_text()
CLAY_HOST = "app.clay.com"

# web.js:86-95 gives the Default profile port 9333 and hashes any other
# profile to its own port.
DEFAULT_PORT = 9333

# Locating or pressing one control is a single DOM query. Guessed, never
# measured: the dry run records how long these really take.
QUICK_S = 20.0

# How long past its own in-page timeout an eval may run before it is killed.
# Guessed, never measured: covers the CDP connect web.js makes on every call.
GRACE_S = 5.0


class PageError(Exception):
    """Its message is a sentence for the person; `tried` is what the finder
    looked for, for the log."""

    def __init__(self, message: str, tried=()):
        super().__init__(message)
        self.tried = list(tried)


class Paused(Exception):
    """The person clicked, typed or scrolled in Clay, or left the tab."""


class Stopped(Exception):
    """Stop was pressed while an eval was running."""


@dataclass(frozen=True)
class Found:
    rect: Rect
    window: Window
    href: str
    text: str


def cdp_port(env=None) -> int:
    """The debug port the eval and the tab count share. Pinned in the eval's
    environment so both always talk to the same Chrome."""
    env = os.environ if env is None else env
    if env.get("CHEWIE_CDP_PORT"):
        try:
            return int(env["CHEWIE_CDP_PORT"])
        except ValueError:
            raise PageError("CHEWIE_CDP_PORT is not a port number.") from None
    if env.get("CHEWIE_CHROME_PROFILE", "Default") not in ("", "Default"):
        raise PageError("CHEWIE_CHROME_PROFILE picks another Chrome window. "
                        "Set CHEWIE_CDP_PORT to that window's port, then run it again.")
    return DEFAULT_PORT


def clay_targets(port: int, fetch=urllib.request.urlopen, frame: str = CLAY_HOST) -> list[dict]:
    """Every target the eval could land in, by chewie's own rule (web.js:223-227:
    the first page or iframe whose url contains `frame`). Counting by a stricter
    rule than the one that picks would let a look-alike url or a Clay iframe
    pass as the one tab. No Chrome on the port means none."""
    try:
        with fetch(f"http://127.0.0.1:{port}/json/list", timeout=2) as resp:
            targets = json.load(resp)
    except OSError:
        return []
    return [t for t in targets
            if t.get("type") in ("page", "iframe") and frame in (t.get("url") or "")]


def _never() -> bool:
    return False


def _words(pattern: str) -> str:
    """`^Save and run \\d+ rows$` as a person would say it."""
    return re.sub(r"\\d\+?", "N", pattern).strip("^$").replace("\\", "")


def _label(tried: dict) -> str:
    return _words(tried.get("text") or "") or tried.get("css") or "the control"


def _not_found(tried: list) -> PageError:
    for entry in tried:
        if entry.get("result") == "ambiguous":
            return PageError(f"Found {entry.get('count') or 2} matches for {_label(entry)}, "
                             "so it stopped instead of guessing.", tried)
    return PageError(f"Couldn't find {_label(tried[0] if tried else {})} on the page.", tried)


_DID_NOT_TAKE = {
    "did not tick": "The box did not tick, so it stopped.",
    "value did not stick": "The text did not stay in the box, so it stopped.",
}


def _expect_label(expect: dict) -> str:
    if "url" in expect:
        return "the next page"
    if "text" in expect:
        return json.dumps(expect["text"])
    return "the next step"


class Page:
    def __init__(self, spawn=subprocess.Popen, chewie: str = CHEWIE, frame: str = CLAY_HOST,
                 poll_s: float = 0.1, port: int | None = None):
        self.spawn = spawn
        self.chewie = chewie
        self.frame = frame
        self.poll_s = poll_s
        self.port = port or cdp_port()

    def _eval(self, body: str, timeout_s: float, should_stop) -> dict:
        # The guard runs in the page before anything else: whatever target
        # chewie picked, nothing is read or pressed unless it is Clay's own
        # top-level document.
        expr = (f"(async () => {{\n{FIND_JS}\n"
                f"if (location.hostname !== {json.dumps(CLAY_HOST)} || window.top !== window) "
                "return JSON.stringify({ok: false, reason: \"not clay\"});\n"
                f"return JSON.stringify(await (async () => {{ {body} }})());\n}})()")
        env = {**os.environ, "CHEWIE_WEB_FRAME": self.frame, "CHEWIE_CDP_PORT": str(self.port)}
        # Answers are a few hundred bytes, so polling before reading never
        # fills the pipe and stalls the child.
        proc = self.spawn([self.chewie, "web", "eval", expr], env=env,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        deadline = time.monotonic() + timeout_s + GRACE_S
        while proc.poll() is None:
            if should_stop():
                self._kill(proc)
                raise Stopped()
            if time.monotonic() > deadline:
                self._kill(proc)
                raise PageError("Chrome stopped answering.")
            time.sleep(self.poll_s)
        out, err = proc.communicate()
        if proc.poll():
            raise PageError(err.strip().removeprefix("chewie web: ") or "chewie web eval failed.")
        try:
            data = json.loads(out)
        except ValueError:
            data = None
        if not isinstance(data, dict):
            raise PageError("Chrome answered with something that was not a result.")
        if data.get("reason") == "not clay":
            raise PageError("The tab Chewie's Chrome picked is not Clay, so nothing was pressed.")
        return data

    @staticmethod
    def _kill(proc) -> None:
        proc.kill()
        proc.wait(timeout=2)

    @staticmethod
    def _found(data: dict) -> Found:
        try:
            rect = Rect(*(float(data["rect"][key]) for key in ("x", "y", "w", "h")))
            frame = data["frame"]
            return Found(rect, Window.from_page(frame), str(frame.get("href", "")), str(data.get("text") or ""))
        except (KeyError, TypeError, ValueError) as err:
            raise PageError("Chrome answered without the control's position.") from err

    def window(self, should_stop=_never) -> tuple[Window, str]:
        data = self._eval("return frame();", QUICK_S, should_stop)
        try:
            return Window.from_page(data), str(data.get("href", ""))
        except (KeyError, TypeError, ValueError) as err:
            raise PageError("Chrome answered without the window's size.") from err

    def locate(self, alts, should_stop=_never) -> Found:
        body = (f"const f = locate({json.dumps(list(alts))}); "
                "return {ok: f.ok, rect: f.rect, text: f.text, tried: f.tried, frame: frame()};")
        data = self._eval(body, QUICK_S, should_stop)
        if not data.get("ok"):
            raise _not_found(data.get("tried") or [])
        return self._found(data)

    def act(self, action, should_stop=_never) -> Found:
        """Locate again and press, in one eval, so nothing moves in between.
        A hand already on the page stops the press before it happens."""
        payload = json.dumps({"do": action.do, "value": action.value, "enter": action.enter})
        body = ("const s = armTakeover(); "
                "if (s.took || document.visibilityState === \"hidden\") return {ok: false, reason: \"takeover\"}; "
                f"const f = locate({json.dumps(list(action.find))}); "
                "if (!f.ok) return {ok: false, tried: f.tried}; "
                f"const r = act(f, {payload}); "
                "return Object.assign(r, {rect: f.rect, text: f.text, frame: frame()});")
        data = self._eval(body, QUICK_S, should_stop)
        if data.get("ok"):
            return self._found(data)
        if data.get("reason") == "takeover":
            raise Paused()
        if "tried" in data:
            raise _not_found(data["tried"] or [])
        raise PageError(_DID_NOT_TAKE.get(data.get("reason"), f"The page did not take the {action.do}."))

    def wait(self, expect: dict, timeout_s: float, should_stop) -> str | None:
        body = f"return await waitFor({json.dumps(expect)}, {int(timeout_s * 1000)});"
        data = self._eval(body, timeout_s, should_stop)
        if data.get("ok"):
            return data.get("captured")
        if data.get("reason") == "takeover":
            raise Paused()
        raise PageError(f"Clay did not show {_expect_label(expect)} within {timeout_s:g} seconds.")

    def resume(self, should_stop=_never) -> None:
        self._eval("armTakeover().took = false; return {ok: true};", QUICK_S, should_stop)
