#!/usr/bin/env python3
"""The apps launcher lists only real surfaces, opens only real ones, and
"show me the built in hud apps" reaches it instead of a model.

On 2026-10-05 that sentence went to genui, which drew six unpressable boxes
including Grades and Campaigns, neither of which is a surface.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bin" / "lib"))

import surface_intent  # noqa: E402
from surfaces import KINDS, make  # noqa: E402
from surfaces.apps import NOT_LISTED  # noqa: E402

failed = 0


def check(name: str, ok: bool, got: object = "") -> None:
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += 0 if ok else 1


def main() -> int:
    p = make("apps")
    lines = p.layout()
    rail = next((ln for ln in lines if " Rail " in ln), "")
    ids = re.findall(r'"id":"([^"]+)"', rail.replace('": "', '":"'))
    check("the launcher is a Rail, not a table", bool(rail) and "Table" not in " ".join(lines), lines)
    check("every rail item is a real surface kind", ids and all(i in KINDS for i in ids), ids)
    check("every openable kind is on the rail", sorted(ids) == sorted(k for k in KINDS if k not in NOT_LISTED), ids)
    check("the newest surfaces are on it", {"code", "notes", "github", "whatsapp"} <= set(ids), ids)
    check("a press on a real item opens it", p.opens("code") == "code")
    check("a press naming something that is not a surface opens nothing", p.opens("campaigns") is None)
    check("a press never opens a parametric kind bare", p.opens("person") is None)
    check("the rail draws its own glass", getattr(p, "chrome", "") == "bare" and p.width == 52)
    for said in ("Show me the built in hud apps now", "show me the hud apps", "what can kyber do",
                 "open the launcher"):
        cmd = surface_intent.parse(said, resolve_person=lambda _n: None)
        check(f"{said!r} opens the launcher, not genui", cmd is not None and cmd.name == "apps", cmd)
    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
