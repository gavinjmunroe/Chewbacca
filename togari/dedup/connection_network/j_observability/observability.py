"""
j_observability/observability.py
Tasks 84–90: Structured logging, Cloud Monitoring metrics, alerts,
runbooks, synthetic test tenant, quarterly checklist.
"""

import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from google.cloud import monitoring_v3

logger     = logging.getLogger(__name__)
PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "your-project")


# ---------------------------------------------------------------------------
# Task 84 — Structured JSON logging for all ingestion workers
# ---------------------------------------------------------------------------

class StructuredLogger:
    """
    Task 84: Every ingestion worker logs structured JSON with the required fields:
    tenant_id, platform, event_type, duration_ms, outcome.
    Usage: logger = StructuredLogger("linkedin", "tenant_abc")
    """

    def __init__(self, platform: str, tenant_id: str):
        self.platform  = platform
        self.tenant_id = tenant_id

    def log(
        self,
        event_type: str,
        outcome: str,         # 'success' | 'error' | 'skipped' | 'duplicate'
        duration_ms: float,
        extra: Optional[dict] = None,
        severity: str = "INFO",
    ) -> None:
        record = {
            "severity":   severity,
            "timestamp":  datetime.now(timezone.utc).isoformat(),
            "tenant_id":  self.tenant_id,
            "platform":   self.platform,
            "event_type": event_type,
            "duration_ms": round(duration_ms, 2),
            "outcome":    outcome,
        }
        if extra:
            record.update(extra)
        print(json.dumps(record))  # Cloud Run captures stdout → Cloud Logging


def timed(fn):
    """Decorator that wraps any function call and returns (result, duration_ms)."""
    def wrapper(*args, **kwargs):
        start  = time.monotonic()
        result = fn(*args, **kwargs)
        return result, (time.monotonic() - start) * 1000
    return wrapper


# ---------------------------------------------------------------------------
# Task 85 — Cloud Monitoring custom metrics
# ---------------------------------------------------------------------------

def write_metric(
    metric_type: str,
    value: float,
    labels: dict[str, str],
) -> None:
    """
    Write a custom metric to Cloud Monitoring.
    metric_type examples:
      custom.googleapis.com/connection_graph/events_per_day
      custom.googleapis.com/connection_graph/review_queue_depth
      custom.googleapis.com/connection_graph/dlq_depth
      custom.googleapis.com/connection_graph/token_expiry_days
    """
    client = monitoring_v3.MetricServiceClient()
    project_name = f"projects/{PROJECT_ID}"

    series = monitoring_v3.TimeSeries()
    series.metric.type = metric_type
    for k, v in labels.items():
        series.metric.labels[k] = v

    series.resource.type = "global"
    series.resource.labels["project_id"] = PROJECT_ID

    now    = time.time()
    point  = monitoring_v3.Point()
    point.interval.end_time.seconds   = int(now)
    point.interval.end_time.nanos     = 0
    point.value.double_value = value

    series.points.append(point)
    client.create_time_series(name=project_name, time_series=[series])


def emit_events_per_platform(platform: str, tenant_id: str, count: int) -> None:
    """Task 85: Daily events-per-platform metric."""
    write_metric(
        "custom.googleapis.com/connection_graph/events_per_day",
        float(count),
        {"platform": platform, "tenant_id": tenant_id},
    )


def emit_review_queue_depth(tenant_id: str, depth: int) -> None:
    """Task 85: Review queue depth metric."""
    write_metric(
        "custom.googleapis.com/connection_graph/review_queue_depth",
        float(depth),
        {"tenant_id": tenant_id},
    )


def emit_dlq_depth(depth: int) -> None:
    """Task 85 + Task 60: DLQ depth metric. Alert policy fires when > 0."""
    write_metric(
        "custom.googleapis.com/connection_graph/dlq_depth",
        float(depth),
        {"project": PROJECT_ID},
    )
    from g_events.pubsub import log_dlq_depth
    log_dlq_depth(depth)


def emit_token_expiry_days(platform: str, tenant_id: str, days_until_expiry: float) -> None:
    """Task 85: Token expiry countdown per platform."""
    write_metric(
        "custom.googleapis.com/connection_graph/token_expiry_days",
        days_until_expiry,
        {"platform": platform, "tenant_id": tenant_id},
    )


# ---------------------------------------------------------------------------
# Task 86 — Alert definitions (Terraform manages alert policies;
# this documents the conditions)
# ---------------------------------------------------------------------------

ALERT_CONDITIONS = {
    "ingestion_silence_24h": {
        "description": "No events ingested from a platform in >24 hours. Usually a broken token.",
        "metric":      "custom.googleapis.com/connection_graph/events_per_day",
        "condition":   "value == 0 for 86400s",
        "severity":    "WARNING",
        "action":      "Check token expiry. Run admin-cli reingest. Check platform status page.",
    },
    "dlq_depth_nonzero": {
        "description": "Dead-letter queue has unprocessed poison messages.",
        "metric":      "custom.googleapis.com/connection_graph/dlq_depth",
        "condition":   "value > 0 for 60s",
        "severity":    "CRITICAL",
        "action":      "Pull DLQ messages. Identify malformed payloads. Fix and replay.",
    },
    "audit_log_write_failure": {
        "description": "Audit log write failed — critical for compliance.",
        "metric":      "logging/user/audit_log_write_failure",
        "condition":   "count > 0 for 60s",
        "severity":    "CRITICAL",
        "action":      "Check BigQuery quota. Check service account permissions.",
    },
    "matcher_confidence_shift": {
        "description": "Unusual shift in matcher confidence distribution — platform may have changed data shape.",
        "metric":      "custom.googleapis.com/connection_graph/avg_match_confidence",
        "condition":   "value changes >20% week-over-week",
        "severity":    "WARNING",
        "action":      "Audit recent platform API response shapes. Re-calibrate matcher weights.",
    },
}


# ---------------------------------------------------------------------------
# Task 87 — Runbooks
# ---------------------------------------------------------------------------

RUNBOOKS = {
    "token_expired": """
# Runbook: Platform Token Expired

**Symptoms:** Ingestion silence alert fires. Logs show "token_expired" event.

**Steps:**
1. Identify affected platform + tenant from the structured log.
2. In the UI: Settings → Integrations → [Platform] → "Reconnect".
3. User re-authorizes OAuth. New token stored in Secret Manager automatically.
4. Trigger manual refresh: `python -m i_api.admin_cli --tenant-id <id> reingest --platform <platform>`
5. Confirm events start flowing (check Cloud Monitoring dashboard).
6. Mark incident resolved.

**Prevention:** Check token_expiry_days metric weekly. Notify user 14 days before expiry.
""",

    "platform_tos_update": """
# Runbook: Platform Changed Terms of Service

**Symptoms:** Legal / policy team flags a change. Or ingestion returns 403 with new ToS message.

**Steps:**
1. IMMEDIATELY activate kill switch:
   `python -m i_api.admin_cli --tenant-id ALL kill-platform --platform <platform> --reason "ToS change under review"`
2. Quarantine all recently ingested data from that platform.
3. Review the new ToS with legal counsel.
4. Update the ToS compliance matrix (docs/tos_compliance_matrix.md).
5. If compliant: resume ingestion. If not compliant: purge platform data and notify users.
6. All within 48 hours.
""",

    "suspected_data_leak": """
# Runbook: Suspected Data Leak

**Steps:**
1. Immediately revoke all external API tokens (Secret Manager rotation).
2. Enable VPC Service Controls emergency lockdown.
3. Pull audit_log for the affected tenant + time window:
   `python -m i_api.admin_cli --tenant-id <id> audit-log --since <ISO timestamp>`
4. Identify affected identities and scope of exposure.
5. Notify affected tenant(s) within 72 hours (GDPR Article 33).
6. File a security incident report.
7. Pen-test before re-opening access (Task 72).
""",

    "identity_merge_rollback": """
# Runbook: Identity Merge Gone Wrong

**Symptoms:** User reports two people merged incorrectly.

**Steps:**
1. Find the merge event_id from the audit log.
2. Call unmerge:
   `from b_identity.resolver import unmerge_identities`
   `unmerge_identities(bq_client, tenant_id, merge_event_id, actor_user_id='admin')`
3. Add do_not_merge override:
   `python -m i_api.admin_cli --tenant-id <id> resolve-review --review-id <id> --decision kept_separate`
4. Verify both identities are separate and handles are correctly assigned.
5. Run re-score to confirm they stay below auto-merge threshold.
""",
}


# ---------------------------------------------------------------------------
# Task 89 — Synthetic test tenant
# ---------------------------------------------------------------------------

SYNTHETIC_TENANT_ID = "tenant-synthetic-test-001"

SYNTHETIC_FIXTURES = {
    "identities": [
        {
            "identity_id":       "idn-alice-001",
            "tenant_id":         SYNTHETIC_TENANT_ID,
            "display_name":      "Alice Johnson",
            "normalized_name":   "alice johnson",
            "confidence_score":  1.0,
            "relationship_type": "professional",
            "is_tombstone":      False,
        },
        {
            "identity_id":       "idn-bob-001",
            "tenant_id":         SYNTHETIC_TENANT_ID,
            "display_name":      "Bob Smith",
            "normalized_name":   "bob smith",
            "confidence_score":  0.95,
            "relationship_type": "personal",
            "is_tombstone":      False,
        },
        # A same-name pair that must NOT be auto-merged (Task 17)
        {
            "identity_id":       "idn-john-a",
            "tenant_id":         SYNTHETIC_TENANT_ID,
            "display_name":      "John Doe",
            "normalized_name":   "john doe",
            "confidence_score":  0.50,
            "relationship_type": "unknown",
            "is_tombstone":      False,
        },
        {
            "identity_id":       "idn-john-b",
            "tenant_id":         SYNTHETIC_TENANT_ID,
            "display_name":      "John Doe",
            "normalized_name":   "john doe",
            "confidence_score":  0.50,
            "relationship_type": "unknown",
            "is_tombstone":      False,
        },
    ],
    "platform_handles": [
        {"handle_id": "hdl-001", "tenant_id": SYNTHETIC_TENANT_ID, "identity_id": "idn-alice-001", "platform": "linkedin",  "handle_value": "alice-johnson-li",  "status": "active"},
        {"handle_id": "hdl-002", "tenant_id": SYNTHETIC_TENANT_ID, "identity_id": "idn-alice-001", "platform": "email",     "handle_value": "alice@acmecorp.com", "status": "active"},
        {"handle_id": "hdl-003", "tenant_id": SYNTHETIC_TENANT_ID, "identity_id": "idn-bob-001",   "platform": "instagram", "handle_value": "bobsmith_ig",        "status": "active"},
        {"handle_id": "hdl-004", "tenant_id": SYNTHETIC_TENANT_ID, "identity_id": "idn-john-a",   "platform": "email",     "handle_value": "john.doe@gmail.com", "status": "quarantine"},
        {"handle_id": "hdl-005", "tenant_id": SYNTHETIC_TENANT_ID, "identity_id": "idn-john-b",   "platform": "email",     "handle_value": "johnd@othercorp.com","status": "quarantine"},
    ],
}


def seed_synthetic_tenant(bq_client) -> None:
    """Task 89: Seed the synthetic test tenant with known-shape data."""
    from a_foundation.bigquery_setup import PROJECT_ID as PID, DATASET_ID

    for table_name, rows in SYNTHETIC_FIXTURES.items():
        table  = bq_client.get_table(f"{PID}.{DATASET_ID}.{table_name}")
        errors = bq_client.insert_rows_json(table, rows)
        if errors:
            logger.error("Fixture seed failed for %s: %s", table_name, errors)
        else:
            logger.info("Seeded %d rows into %s", len(rows), table_name)


# ---------------------------------------------------------------------------
# Task 90 — Quarterly review checklist
# ---------------------------------------------------------------------------

QUARTERLY_CHECKLIST = """
# Quarterly Connection Graph Review Checklist
(Due: end of each calendar quarter)

## ToS Compliance
[ ] Review docs/tos_compliance_matrix.md — check each platform's last-reviewed date
[ ] Confirm no platform has issued new data-use restrictions
[ ] Update matrix with today's date if all clear

## KMS Key Rotation
[ ] Check if any CMEK keys are >12 months old (Task 64)
[ ] Rotate if due: gcloud kms keys versions create --key=<key> --keyring=<ring>
[ ] Update kms_key_ref in tenants table if new key version is active

## Security
[ ] Re-run pen-test script on retrieval API (IDOR focus, Task 72)
[ ] Review who has production BigQuery / Secret Manager access
[ ] Revoke any stale service accounts

## Observability
[ ] Review Cloud Monitoring dashboards — any anomalous trends?
[ ] Check DLQ depth history — any unresolved poison messages?
[ ] Audit token_expiry_days metric — any tokens expiring next quarter?

## Data Quality
[ ] Check review_queue depth — clear out stale items
[ ] Run matcher on demand for oldest unresolved handles
[ ] Review synthetic test tenant fixtures — still representative?

Sign-off: _____________ Date: _____________
"""
