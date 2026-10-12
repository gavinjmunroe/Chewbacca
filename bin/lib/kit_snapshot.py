"""Whether a long-running tool is still on the kit snapshot that is current.

The kit runtime (tools/kit_runtime.py) lays each update down as
<base>/snapshots/<sha>/ and swaps <base>/current to it. A tool started from
~/.local/bin resolves through `current` once, at start, and runs that
snapshot's code for as long as it lives.

hud-listen lives for hours. On 2026-10-11 it started at 17:44 on 9edc7a8f, a
snapshot from before Realm's interface landed (0710ec15, 17:42 on main, first
in a snapshot at 17:47). At 17:55 "Show my agents" was routed by that old
code to the Swift `agents` card instead of the `realm` surface, and the card's
loading shape (a title and an empty status line) is what Caleb saw: an AGENTS
panel about 90 points tall with nothing in it. The same staleness broke
"show my agents" on 2026-10-10 (tools/kit_runtime.py, in_use).

Stdlib only, Python 3.9: the hooks and the tests run on /usr/bin/python3.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional


def snapshot_of(script: Path) -> Optional[Path]:
    """The snapshot directory `script` runs from, or None when it is not in
    one (a checkout or a worktree, which has no `current` to fall behind)."""
    try:
        code = Path(script).resolve().parent.parent
    except OSError:
        return None
    if code.parent.name != "snapshots":
        return None
    return code


def moved(script: Path) -> bool:
    """True when the kit's `current` now points at a different snapshot than
    the one `script` runs from. False when it cannot tell: no snapshot, or no
    `current` to move to, so a tool never retires into nothing."""
    code = snapshot_of(script)
    if code is None:
        return False
    current = code.parent.parent / "current"
    try:
        live = current.resolve(strict=True)
    except (OSError, RuntimeError):
        return False
    return live != code
