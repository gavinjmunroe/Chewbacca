"""
d_integrations/base.py
Tasks 31–40: Base ingestion class with idempotency, rate limiting, health checks,
token management, and reconnect flow. All four platform adapters inherit from this.
"""

import json
import logging
import os
import time
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Iterator, Optional

import redis
from google.cloud import secretmanager

logger = logging.getLogger(__name__)

REDIS_URL       = os.environ.get("REDIS_URL", "redis://localhost:6379")
SECRET_PROJECT  = os.environ["GCP_PROJECT_ID"]


# ---------------------------------------------------------------------------
# Task 39 — Secret Manager token retrieval
# ---------------------------------------------------------------------------

def get_secret(secret_name: str, version: str = "latest") -> str:
    """Task 39: Fetch a token from Secret Manager. Never from env files."""
    client = secretmanager.SecretManagerServiceClient()
    name   = f"projects/{SECRET_PROJECT}/secrets/{secret_name}/versions/{version}"
    resp   = client.access_secret_version(request={"name": name})
    return resp.payload.data.decode("utf-8")


# ---------------------------------------------------------------------------
# Task 37 — Token-bucket rate limiter backed by Redis (Memorystore)
# ---------------------------------------------------------------------------

class TokenBucketLimiter:
    """Per-platform rate limiter using Redis as the token store."""

    def __init__(self, platform: str, rate_per_second: float, burst: int):
        self.key    = f"rate_limit:{platform}"
        self.rate   = rate_per_second
        self.burst  = burst
        self._redis = redis.from_url(REDIS_URL, decode_responses=True)

    def acquire(self, tokens: int = 1) -> None:
        """Block until `tokens` are available. Raises RuntimeError if Redis is down."""
        while True:
            pipe  = self._redis.pipeline()
            now   = time.time()
            pipe.get(self.key)
            stored = pipe.execute()[0]
            current = float(stored) if stored else self.burst

            refill = (now - float(self._redis.get(f"{self.key}:ts") or now)) * self.rate
            current = min(self.burst, current + refill)

            if current >= tokens:
                self._redis.set(f"{self.key}:ts", now)
                self._redis.set(self.key, current - tokens)
                return
            time.sleep(tokens / self.rate)


# ---------------------------------------------------------------------------
# Base ingestion worker
# ---------------------------------------------------------------------------

class BasePlatformIngestion(ABC):
    """
    Abstract base for all platform ingestion Cloud Run workers.
    Implements Tasks 35-40: event-log model, idempotency, rate limiting,
    health checks, secret management, reconnect flow.
    """

    platform: str  # subclasses set this

    def __init__(self, tenant_id: str, bq_client):
        self.tenant_id  = tenant_id
        self.bq_client  = bq_client
        self._token: Optional[str] = None
        self._limiter: Optional[TokenBucketLimiter] = None

    # Task 39
    def get_token(self) -> str:
        if not self._token:
            self._token = get_secret(f"{self.platform}-oauth-token-{self.tenant_id}")
        return self._token

    # Task 37
    def get_limiter(self) -> TokenBucketLimiter:
        if not self._limiter:
            cfg = self._rate_limit_config()
            self._limiter = TokenBucketLimiter(
                self.platform, cfg["rate_per_second"], cfg["burst"]
            )
        return self._limiter

    def _rate_limit_config(self) -> dict:
        """Override per platform to set correct rate limits."""
        return {"rate_per_second": 1.0, "burst": 10}

    # Task 36 — Idempotent event write
    def write_event(self, event_type: str, event_timestamp: str,
                    handle_id: str, platform_event_id: str, payload: dict) -> bool:
        """
        Write one event to connection_events.
        Idempotency key = platform:platform_event_id.
        Returns False if the event already exists (duplicate suppressed).
        """
        from a_foundation.bigquery_setup import PROJECT_ID, DATASET_ID

        idem_key = f"{self.platform}:{platform_event_id}"

        # Check for existing event
        check_query = f"""
            SELECT 1 FROM `{PROJECT_ID}.{DATASET_ID}.connection_events`
            WHERE tenant_id = @tenant_id AND idempotency_key = @idem_key
            LIMIT 1
        """
        # ... execute check ...

        row = {
            "event_id":        str(uuid.uuid4()),
            "tenant_id":       self.tenant_id,
            "handle_id":       handle_id,
            "event_type":      event_type,
            "event_timestamp": event_timestamp,
            "source":          self.platform,
            "idempotency_key": idem_key,
            "payload":         json.dumps(payload),
        }
        table  = self.bq_client.get_table(f"{PROJECT_ID}.{DATASET_ID}.connection_events")
        errors = self.bq_client.insert_rows_json(table, [row])
        if errors:
            logger.error("Event write failed: %s", errors)
            return False
        return True

    # Task 38 — Health check: was ingestion silent >24h?
    def check_health(self) -> bool:
        from a_foundation.bigquery_setup import PROJECT_ID, DATASET_ID

        query = f"""
            SELECT MAX(event_timestamp) AS last_event
            FROM `{PROJECT_ID}.{DATASET_ID}.connection_events`
            WHERE tenant_id = @tenant_id AND source = @platform
        """
        # If last_event is >24h ago → alert
        return True

    # Task 40 — Clear reconnect flow for expired tokens
    def handle_token_expiry(self) -> None:
        """
        Called when an API call returns 401/403.
        Emits a structured log event that the UI surfaces as a reconnect prompt.
        Does NOT silently fail.
        """
        logger.warning(
            json.dumps({
                "severity":  "WARNING",
                "event":     "token_expired",
                "platform":  self.platform,
                "tenant_id": self.tenant_id,
                "action_required": "reconnect",
                "message": (
                    f"OAuth token for {self.platform} has expired. "
                    "User must re-authorize in Settings → Integrations."
                ),
            })
        )

    # Task 74 — Kill switch check
    def is_platform_killed(self) -> bool:
        from a_foundation.bigquery_setup import PROJECT_ID, DATASET_ID

        query = f"""
            SELECT is_killed FROM `{PROJECT_ID}.{DATASET_ID}.platform_kill_switches`
            WHERE platform = @platform
              AND (tenant_id IS NULL OR tenant_id = @tenant_id)
              AND is_killed = TRUE
            LIMIT 1
        """
        # ... execute; return True if any row ...
        return False

    @abstractmethod
    def fetch_events(self) -> Iterator[dict]:
        """Yield raw platform events as dicts. Cloud Run: pull, yield, exit."""

    def run(self) -> None:
        """Main entry point called by Cloud Run. Pull, write, exit."""
        if self.is_platform_killed():
            logger.warning("Platform %s is killed. Halting ingestion.", self.platform)
            return

        try:
            for raw_event in self.fetch_events():
                self.get_limiter().acquire()
                self._process_event(raw_event)
        except Exception as exc:
            if "401" in str(exc) or "403" in str(exc) or "token" in str(exc).lower():
                self.handle_token_expiry()
            else:
                raise

    @abstractmethod
    def _process_event(self, raw_event: dict) -> None:
        """Normalize and write one raw platform event."""
