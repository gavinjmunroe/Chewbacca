"""
g_events/pubsub.py
Tasks 57–62: Pub/Sub topic, subscriber dispatch, idempotency, DLQ, manual refresh.
"""

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Callable

from google.cloud import pubsub_v1
from google.api_core.exceptions import AlreadyExists

logger = logging.getLogger(__name__)

PROJECT_ID      = os.environ["GCP_PROJECT_ID"]
TOPIC_ID        = "connection.events.v1"      # Task 57
DLQ_TOPIC_ID    = "connection.events.v1.dlq"  # Task 60
REFRESH_TOPIC_ID = "connection.refresh.v1"    # Task 62


# ---------------------------------------------------------------------------
# Task 57 — Create Pub/Sub topics (idempotent)
# ---------------------------------------------------------------------------

def ensure_topics() -> None:
    """Create topics if they don't exist. Safe to re-run."""
    publisher = pubsub_v1.PublisherClient()

    for topic_id in [TOPIC_ID, DLQ_TOPIC_ID, REFRESH_TOPIC_ID]:
        topic_path = publisher.topic_path(PROJECT_ID, topic_id)
        try:
            publisher.create_topic(request={"name": topic_path})
            logger.info("Created topic: %s", topic_path)
        except AlreadyExists:
            logger.debug("Topic already exists: %s", topic_path)


# ---------------------------------------------------------------------------
# Task 57 — Publish an event to the main topic
# ---------------------------------------------------------------------------

def publish_event(event_type: str, tenant_id: str, payload: dict) -> str:
    """
    All ingestion workers publish here after writing to BigQuery.
    Returns the message ID.
    """
    publisher   = pubsub_v1.PublisherClient()
    topic_path  = publisher.topic_path(PROJECT_ID, TOPIC_ID)

    message = {
        "event_id":        str(uuid.uuid4()),
        "event_type":      event_type,
        "tenant_id":       tenant_id,
        "published_at":    datetime.now(timezone.utc).isoformat(),
        "payload":         payload,
    }
    data    = json.dumps(message).encode("utf-8")
    future  = publisher.publish(
        topic_path, data,
        event_type=event_type,
        tenant_id=tenant_id,
    )
    msg_id = future.result()
    logger.debug("Published event %s → %s", event_type, msg_id)
    return msg_id


# ---------------------------------------------------------------------------
# Task 58 — Subscriber dispatch
# ---------------------------------------------------------------------------

# Task 58: Registered subscribers
SUBSCRIBERS: list[Callable[[dict], None]] = []


def register_subscriber(fn: Callable[[dict], None]) -> None:
    SUBSCRIBERS.append(fn)


def dispatch_message(message: pubsub_v1.subscriber.message.Message) -> None:
    """
    Task 59: Idempotent dispatch. Pub/Sub is at-least-once, so each
    subscriber must be idempotent (check event_id before processing).
    """
    try:
        payload = json.loads(message.data.decode("utf-8"))
        event_id = payload.get("event_id", "")

        for subscriber_fn in SUBSCRIBERS:
            try:
                subscriber_fn(payload)
            except Exception as exc:
                logger.error(
                    "Subscriber %s failed for event %s: %s",
                    subscriber_fn.__name__, event_id, exc,
                )
                raise  # re-raise → Pub/Sub will nack and retry

        message.ack()

    except Exception as exc:
        logger.error("Fatal dispatch error, sending to DLQ: %s", exc)
        message.nack()
        _send_to_dlq(message.data, str(exc))


def _send_to_dlq(raw_data: bytes, error: str) -> None:
    """Task 60: Send poison messages to DLQ."""
    publisher  = pubsub_v1.PublisherClient()
    dlq_path   = publisher.topic_path(PROJECT_ID, DLQ_TOPIC_ID)
    publisher.publish(dlq_path, raw_data, error=error[:200])


# ---------------------------------------------------------------------------
# Task 59 — Idempotency helper for subscribers
# ---------------------------------------------------------------------------

class SeenEventsCache:
    """In-memory dedup for the current Cloud Run instance lifetime."""

    def __init__(self, max_size: int = 10_000):
        self._seen: set[str] = set()
        self._max  = max_size

    def is_duplicate(self, event_id: str) -> bool:
        if event_id in self._seen:
            return True
        if len(self._seen) >= self._max:
            self._seen.clear()  # evict all (simple strategy)
        self._seen.add(event_id)
        return False


_SEEN = SeenEventsCache()


# ---------------------------------------------------------------------------
# Task 58 — Example built-in subscribers
# ---------------------------------------------------------------------------

def identity_resolution_subscriber(event: dict) -> None:
    """Run identity matcher for new platform_handle events."""
    if _SEEN.is_duplicate(event["event_id"]):
        return
    if event["event_type"] in ("connection_accepted", "mutual_follow", "dm_exchange"):
        # Trigger async identity resolution for the handle in the event
        logger.info("Identity resolution triggered for event %s", event["event_id"])


def classifier_subscriber(event: dict) -> None:
    """Re-run relationship classifier when a new handle is attached."""
    if _SEEN.is_duplicate(event["event_id"]):
        return
    logger.info("Classifier triggered for event %s", event["event_id"])


def audit_logger_subscriber(event: dict) -> None:
    """Write every published event to the audit log."""
    if _SEEN.is_duplicate(event["event_id"]):
        return
    logger.info(
        json.dumps({
            "severity":  "INFO",
            "event_type": event["event_type"],
            "tenant_id":  event["tenant_id"],
            "event_id":   event["event_id"],
        })
    )


# Register built-in subscribers
register_subscriber(identity_resolution_subscriber)
register_subscriber(classifier_subscriber)
register_subscriber(audit_logger_subscriber)


# ---------------------------------------------------------------------------
# Task 60 — DLQ depth alert (Cloud Monitoring metric filter handles the alert;
# this logs the structured metric for the Monitoring sink)
# ---------------------------------------------------------------------------

def log_dlq_depth(depth: int) -> None:
    if depth > 0:
        logger.error(
            json.dumps({
                "severity":  "ERROR",
                "metric":    "dlq_depth",
                "depth":     depth,
                "alert":     True,
                "message":   f"DLQ has {depth} unprocessed messages. Investigate immediately.",
            })
        )


# ---------------------------------------------------------------------------
# Task 61 — Cloud Run ephemeral: min-instances=0
# (enforced in Terraform; documented here for traceability)
# CLOUD_RUN_MIN_INSTANCES = 0
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Task 62 — Manual refresh: enqueue immediate ingestion job
# ---------------------------------------------------------------------------

def enqueue_manual_refresh(tenant_id: str, platform: str, actor_user_id: str) -> str:
    """
    Task 62: Called by the UI "Refresh" button.
    Publishes a refresh message; a Cloud Run job picks it up and runs ingestion immediately.
    """
    publisher   = pubsub_v1.PublisherClient()
    topic_path  = publisher.topic_path(PROJECT_ID, REFRESH_TOPIC_ID)

    message = {
        "refresh_id":     str(uuid.uuid4()),
        "tenant_id":      tenant_id,
        "platform":       platform,
        "actor_user_id":  actor_user_id,
        "requested_at":   datetime.now(timezone.utc).isoformat(),
    }
    data   = json.dumps(message).encode("utf-8")
    future = publisher.publish(topic_path, data, platform=platform, tenant_id=tenant_id)
    return future.result()
