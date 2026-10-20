"""Tiny content-addressed disk cache for scores and rationales.

The PeopleRank surfaces re-run the same work constantly: the Amber middle tab
re-ranks the same synced contacts, and UC1/UC3 event matching retries the same
roster after a client timeout. Both pay full Claude + OpenAI cost every time.

This module gives those callers a JSON-on-disk cache keyed by a SHA-256 of the
exact inputs (model id + prompt text, or model id + serialized people set). A
hit returns instantly with zero API spend. Keys are content hashes, so any
change to the inputs naturally misses and recomputes. Writes are best-effort:
a cache that cannot be read or written never breaks the request, it just falls
back to recomputing.

Caches are opt-out via PEOPLERANK_CACHE_DISABLED=1 so a deploy can force fresh
work without a code change.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Optional

_DEFAULT_DIR = Path(os.environ.get("PEOPLERANK_CACHE_DIR", ".peoplerank_cache"))


def _disabled() -> bool:
    return os.environ.get("PEOPLERANK_CACHE_DISABLED", "").strip() in ("1", "true", "True")


def make_key(*parts: str) -> str:
    """Stable SHA-256 over the given string parts, separated by NULs."""
    h = hashlib.sha256()
    for p in parts:
        h.update((p or "").encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()


def _path(namespace: str, key: str) -> Path:
    return _DEFAULT_DIR / namespace / f"{key}.json"


def get(namespace: str, key: str) -> Optional[Any]:
    """Return the cached value for (namespace, key), or None on miss/error."""
    if _disabled():
        return None
    path = _path(namespace, key)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError, ValueError):
        return None


def set(namespace: str, key: str, value: Any) -> None:
    """Persist value as JSON. Best-effort: failures are swallowed."""
    if _disabled():
        return
    path = _path(namespace, key)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        # Write to a temp file then rename so a crashed write never leaves a
        # half-written JSON file that would poison future reads.
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(value))
        tmp.replace(path)
    except (OSError, TypeError, ValueError):
        # Unserializable value or unwritable disk: skip caching, never raise.
        pass
