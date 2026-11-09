"""The HUD talk key, to the agent that has the glass.

When Realm is up on the glass (Carlton Aikins' Realm, github.com/31Carlton7/realm,
with our layer over it: bin/lib/realm_ui/glass), a sentence said to the HUD
goes to the focused agent instead of the assistant: hud-listen hands it to
realm-ui's /glass/voice, and the page puts it in that agent's reply, or opens
the palette, or names a file with @. Nothing is sent: Return is the press.

Answers None whenever the glass is not up, not listening, or the server is
not there, so hud-listen carries on to its other paths. Stdlib only, and
stock /usr/bin/python3 is 3.9, so Optional rather than `X | None`.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable, Optional

# How long hud-listen waits on the local server before carrying on. It
# answered in under 5 ms on loopback (2026-10-11); a wedged server must not
# cost the person their request. Guessed ceiling.
TIMEOUT_S = 0.6

# Sentences that open something on the glass rather than go to the agent.
# They mirror voiceIntent in bin/lib/realm_ui/glass/model.mjs.
_OPENS = re.compile(r"^(?:(?:open |show )?(?:the )?(?:command )?palette\b|find |search |grep |open |go to )", re.I)


def state_file() -> Path:
    home = os.environ.get("CHEWBACCA_REALM_UI_HOME") or str(Path.home() / ".chewbacca" / "realm-ui")
    return Path(home).expanduser() / "server.json"


def _server(path: Path) -> Optional[dict]:
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("port"), int) or not data.get("token"):
        return None
    return data


def send(said: str, path: Optional[Path] = None, opener: Callable = urllib.request.urlopen) -> Optional[dict]:
    """Hand `said` to the page that has the glass. Returns {"to", "mode"}, or None."""
    text = (said or "").strip()
    server = _server(path or state_file())
    if not text or server is None:
        return None
    req = urllib.request.Request(
        f"http://127.0.0.1:{server['port']}/glass/voice",
        data=json.dumps({"text": text}).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Glass-Token": str(server["token"])},
        method="POST",
    )
    try:
        with opener(req, timeout=TIMEOUT_S) as res:
            body = json.loads(res.read().decode("utf-8") or "{}")
    except (urllib.error.URLError, OSError, ValueError):
        return None
    if not isinstance(body, dict) or not body.get("ok"):
        return None
    return {"to": str(body.get("to") or ""), "mode": str(body.get("mode") or "")}


def pill_line(said: str, to: str) -> str:
    """What the pill says after: one short line, never over 140 characters."""
    if _OPENS.match((said or "").strip()):
        return "It's up on the glass."
    name = to.strip() or "the agent"
    if len(name) > 60:
        name = name[:59] + "…"
    return f"In {name}'s reply. Return sends it."
