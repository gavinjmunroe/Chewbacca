"""Simple in-memory TTL cache for idempotency keys."""
from __future__ import annotations

import threading
import time
from typing import Any, Dict, Optional, Tuple

DEFAULT_TTL_SECONDS = 24 * 60 * 60  # 24h


class TTLCache:
    def __init__(self, ttl_seconds: int = DEFAULT_TTL_SECONDS):
        self.ttl = ttl_seconds
        self._store: Dict[str, Tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[Any]:
        now = time.time()
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            ts, value = entry
            if now - ts > self.ttl:
                # expired
                self._store.pop(key, None)
                return None
            return value

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._store[key] = (time.time(), value)

    def purge_expired(self) -> None:
        now = time.time()
        with self._lock:
            dead = [k for k, (ts, _) in self._store.items() if now - ts > self.ttl]
            for k in dead:
                self._store.pop(k, None)


# Single process-wide cache used by the FastAPI app.
idempotency_cache = TTLCache()
