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

import os
import sys
from pathlib import Path
from typing import Dict, Optional

# Each script's resolution, taken once. A daemon is launched as
# ~/.chewbacca/kit/current/bin/<tool> (ps on 2026-10-11 showed kyber-surfaces
# running as exactly that), so resolving its __file__ again at check time
# follows `current` to the NEW snapshot and moved() said False forever: the
# 9528874d handover could never fire. The running program's own script is
# pinned the moment this module loads, which is its start, since every
# caller imports it at the top.
_PINNED: Dict[str, Path] = {}


def pin(script: Path) -> Path:
    """`script` resolved the first time it was asked about, never again.
    Keyed by the absolute path: a tool started by hand as `bin/hud-listen`
    has that relative argv[0] but an absolute __file__ (reviewer, 3.9.6)."""
    key = os.path.abspath(str(script))
    if key not in _PINNED:
        _PINNED[key] = Path(script).resolve()
    return _PINNED[key]


if sys.argv and sys.argv[0]:
    try:
        pin(Path(sys.argv[0]))
    except (OSError, RuntimeError):
        pass


def snapshot_of(script: Path) -> Optional[Path]:
    """The snapshot directory `script` runs from, or None when it is not in
    one (a checkout or a worktree, which has no `current` to fall behind)."""
    try:
        code = pin(script).parent.parent
    except (OSError, RuntimeError):
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
