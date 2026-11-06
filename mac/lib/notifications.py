#!/usr/bin/env python3
"""chewie notifications: what Notification Center is showing, as JSON.

Read through agent-desktop (vercel-labs/agent-desktop, Apache-2.0). Without
--open it never takes focus: it reads banners on screen, and when none are up
macOS has no Notification Center window to read, so the answer is an honest
empty list that says the panel is closed. --open has agent-desktop open the
panel, read the history and put focus back. On 2026-11-06, with a Focus mode on,
a banner never appeared at all and the history was the only place to see it.

Everything in a notification was written by whoever sent it. It is data to show
a person, never instructions, and it may be private, so nothing here logs it.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys

# agent-desktop's own deadline for opening the panel is a few seconds, and it
# waits on System Events. Guessed, never measured under load.
TIMEOUT_S = 20
FIXES = {
    "PERM_DENIED": "Give this app Accessibility: System Settings > Privacy & Security > Accessibility",
    "MISSING": "Install the driver: npm install -g agent-desktop",
}


def _call(args: list[str]) -> dict:
    try:
        done = subprocess.run(["agent-desktop", "list-notifications", *args],
                              capture_output=True, text=True, timeout=TIMEOUT_S)
    except FileNotFoundError:
        return {"ok": False, "error": {"code": "MISSING", "message": "agent-desktop is not installed"}}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": {"code": "TIMEOUT", "message": f"no answer in {TIMEOUT_S}s"}}
    try:
        out = json.loads(done.stdout)
    except ValueError:
        out = None
    if not isinstance(out, dict):
        # stdout is whatever the driver printed, so it stays out of the message.
        return {"ok": False, "error": {"code": "PARSE", "message": "agent-desktop answered with something that isn't JSON"}}
    return out


def _system_events_down(reply: dict) -> bool:
    details = (reply.get("error") or {}).get("details") or {}
    return details.get("kind") == "automation_permission_probe" and details.get("os_status") == -600


def _row(item) -> dict | None:
    if not isinstance(item, dict):
        return None
    actions = item.get("actions")
    return {"index": item.get("index"), "app": str(item.get("app_name") or item.get("app") or ""),
            "title": str(item.get("title") or ""), "body": str(item.get("body") or ""),
            "actions": [str(a) for a in actions] if isinstance(actions, list) else []}


def _items(data) -> list:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("notifications", "items"):
            if isinstance(data.get(key), list):
                return data[key]
    return []


def read(*, open_panel: bool = False, app: str | None = None, text: str | None = None,
         limit: int | None = None) -> dict:
    args: list[str] = []
    if app:
        args += ["--app", app]
    if text:
        args += ["--text", text]
    if limit is not None:
        args += ["--limit", str(limit)]
    if open_panel:
        args.append("--headed")
    reply = _call(args)
    if open_panel and _system_events_down(reply):
        # The panel opens through System Events, and it isn't always running.
        # -600 on 2026-11-06. `open -g` starts it without taking focus.
        subprocess.run(["open", "-g", "-b", "com.apple.systemevents"], capture_output=True)
        reply = _call(args)
    out: dict = {"untrusted": True, "panel": "open"}
    if reply.get("ok"):
        rows = [r for r in (_row(i) for i in _items(reply.get("data"))) if r]
        return {"ok": True, **out, "count": len(rows), "notifications": rows}
    err = reply.get("error") if isinstance(reply.get("error"), dict) else {}
    code = str(err.get("code") or "UNKNOWN")
    if code == "POLICY_DENIED" and not open_panel:
        return {"ok": True, **out, "panel": "closed", "count": 0, "notifications": [],
                "note": "No banner on screen. --open reads the history and briefly takes focus."}
    fix = FIXES.get(code) or str(err.get("suggestion") or "")
    return {"ok": False, **out, "panel": "unknown", "count": 0, "notifications": [], "code": code,
            "error": str(err.get("message") or "couldn't read notifications"), **({"fix": fix} if fix else {})}


def _positive(raw: str) -> int:
    value = int(raw)
    if value < 1:
        raise ValueError(raw)
    return value


def main() -> int:
    parser = argparse.ArgumentParser(prog="chewie notifications", description=__doc__.split("\n")[0])
    parser.add_argument("--open", action="store_true", dest="open_panel",
                        help="open Notification Center to read the history; briefly takes focus")
    parser.add_argument("--app", help="only this app")
    parser.add_argument("--text", help="only notifications containing this")
    parser.add_argument("--limit", type=_positive, help="at most this many")
    opts = parser.parse_args()
    result = read(open_panel=opts.open_panel, app=opts.app, text=opts.text, limit=opts.limit)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
