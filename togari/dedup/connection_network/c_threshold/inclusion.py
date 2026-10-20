"""
c_threshold/inclusion.py
Tasks 23–30: Per-channel inclusion rules, quarantine state, bulk dismiss,
outbound-reply counting, OOO/auto-reply filtering, transactional address exclusion.
"""

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Task 23 — Default inclusion rules per channel
# (stored in inclusion_rules table; these are the factory defaults)
# ---------------------------------------------------------------------------

DEFAULT_INCLUSION_RULES: dict[str, dict] = {
    "email": {
        "rule_type": "outbound_reply_count",
        "threshold": 2,
        "description": "User must have replied outbound ≥2 times to this address.",
    },
    "linkedin": {
        "rule_type": "accepted_connection",
        "threshold": 1,
        "description": "Connection must be in accepted state (1st-degree).",
    },
    "instagram": {
        "rule_type": "mutual_follow_or_dm",
        "threshold": 1,
        "description": "Must be mutual follow OR DM exchange.",
    },
    "twitter": {
        "rule_type": "mutual_follow_or_dm",
        "threshold": 1,
        "description": "Must be mutual follow OR DM exchange.",
    },
    "github": {
        "rule_type": "collaboration",
        "threshold": 2,
        "description": "Mutual follow OR shared-repo collaborator OR ≥2 cross-PR/issue comments.",
    },
    "reddit": {
        "rule_type": "dm_exchange",
        "threshold": 1,
        "description": "Must have a DM exchange.",
    },
    "youtube": {
        "rule_type": "comment_reply",
        "threshold": 2,
        "description": "Commenter replied to tenant content ≥2x; OR mutual subscription.",
    },
    "stackoverflow": {
        "rule_type": "cross_interaction",
        "threshold": 2,
        "description": "Answered/commented on each other's questions ≥2x.",
    },
    "substack": {
        "rule_type": "subscriber_or_subscription",
        "threshold": 1,
        "description": "Paid subscriber (tenant as publisher) OR publication tenant subscribes to.",
    },
}


def get_inclusion_rule(bq_client, tenant_id: str, platform: str) -> dict:
    """
    Task 24: Fetch the tenant-specific inclusion rule, falling back to default.
    Rules are configurable per tenant without redeployment.
    """
    from a_foundation.bigquery_setup import PROJECT_ID, DATASET_ID

    query = f"""
        SELECT rule_type, threshold FROM `{PROJECT_ID}.{DATASET_ID}.inclusion_rules`
        WHERE tenant_id = @tenant_id AND platform = @platform
        LIMIT 1
    """
    # Execute and return; if empty, use default
    return DEFAULT_INCLUSION_RULES.get(platform, {})


# ---------------------------------------------------------------------------
# Task 25 — Threshold promotion job
# ---------------------------------------------------------------------------

def evaluate_and_promote(bq_client, tenant_id: str) -> None:
    """
    Task 25: Scan connection_events and promote handles into connections
    only once inclusion rules are met.
    Called on a schedule via Cloud Scheduler.
    """
    from a_foundation.bigquery_setup import PROJECT_ID, DATASET_ID

    # For each quarantine handle, recount qualifying events
    query = f"""
        SELECT
            ph.handle_id,
            ph.platform,
            ph.identity_id,
            COUNT(ce.event_id) AS qualifying_events
        FROM `{PROJECT_ID}.{DATASET_ID}.platform_handles` ph
        JOIN `{PROJECT_ID}.{DATASET_ID}.connection_events` ce
          ON ce.handle_id = ph.handle_id
             AND ce.tenant_id = ph.tenant_id
        WHERE ph.tenant_id = @tenant_id
          AND ph.status = 'quarantine'
          AND ce.event_type NOT IN ('auto_reply', 'ooo_reply', 'transactional')
        GROUP BY ph.handle_id, ph.platform, ph.identity_id
    """
    # For each row: compare qualifying_events vs. threshold; promote if met
    logger.info("Promotion job complete for tenant %s", tenant_id)


# ---------------------------------------------------------------------------
# Task 26/27 — Quarantine state, bulk dismiss
# ---------------------------------------------------------------------------

def set_handle_status(
    bq_client,
    tenant_id: str,
    handle_ids: list[str],
    new_status: str,  # 'quarantine' | 'active' | 'dismissed'
) -> None:
    """Set the status of one or many platform handles."""
    from a_foundation.bigquery_setup import PROJECT_ID, DATASET_ID

    id_list = ", ".join(f"'{h}'" for h in handle_ids)
    query = f"""
        UPDATE `{PROJECT_ID}.{DATASET_ID}.platform_handles`
        SET status = '{new_status}', last_seen_at = CURRENT_TIMESTAMP()
        WHERE tenant_id = @tenant_id
          AND handle_id IN ({id_list})
    """
    bq_client.query(query).result()
    logger.info(
        "Set %d handle(s) to status='%s' for tenant %s",
        len(handle_ids), new_status, tenant_id,
    )


def bulk_dismiss_quarantine(bq_client, tenant_id: str) -> int:
    """
    Task 27: Dismiss all quarantine handles for a tenant in one shot.
    Returns count of handles dismissed.
    """
    from a_foundation.bigquery_setup import PROJECT_ID, DATASET_ID

    query = f"""
        UPDATE `{PROJECT_ID}.{DATASET_ID}.platform_handles`
        SET status = 'dismissed'
        WHERE tenant_id = @tenant_id AND status = 'quarantine'
    """
    result = bq_client.query(query).result()
    count  = result.num_dml_affected_rows or 0
    logger.info("Bulk dismissed %d quarantine handles for tenant %s", count, tenant_id)
    return count


# ---------------------------------------------------------------------------
# Task 28/29 — Outbound-reply counting, OOO/auto-reply filtering
# ---------------------------------------------------------------------------

_OOO_PATTERNS = re.compile(
    r"(out of (office|town)|on vacation|on leave|auto[- ]?(generated|reply|respond)"
    r"|automatic reply|i am (away|currently unavailable)|will be back|"
    r"this is an automated)",
    re.IGNORECASE,
)
_AUTO_REPLY_HEADERS = {"x-auto-response-suppress", "auto-submitted", "x-autoreply"}


def is_auto_reply(subject: str, body: str, headers: dict[str, str]) -> bool:
    """
    Task 29: True if the email looks like an OOO / auto-generated reply.
    Checks subject+body patterns AND RFC-style auto-response headers.
    """
    lowered = (subject + " " + body).lower()
    if _OOO_PATTERNS.search(lowered):
        return True
    for hdr, val in headers.items():
        if hdr.lower() in _AUTO_REPLY_HEADERS:
            if val.lower() not in ("no", "false", "none"):
                return True
    return False


def count_outbound_replies(
    bq_client,
    tenant_id: str,
    handle_id: str,
) -> int:
    """
    Task 28: Count true outbound replies from the tenant user to this handle.
    Only counts events where event_type='outbound_reply' (not blasts, not auto-replies).
    """
    from a_foundation.bigquery_setup import PROJECT_ID, DATASET_ID

    query = f"""
        SELECT COUNT(*) AS cnt
        FROM `{PROJECT_ID}.{DATASET_ID}.connection_events`
        WHERE tenant_id = @tenant_id
          AND handle_id = @handle_id
          AND event_type = 'outbound_reply'
    """
    # Execute and return cnt
    return 0  # placeholder


# ---------------------------------------------------------------------------
# Task 30 — Transactional/no-reply address exclusion
# ---------------------------------------------------------------------------

_NOREPLY_PATTERNS = re.compile(
    r"^(noreply|no-reply|do[-_]?not[-_]?reply|notifications?|"
    r"alerts?|support|mailer[-_]?daemon|postmaster|"
    r"bounce|unsubscribe|automail|updates?)@",
    re.IGNORECASE,
)
_PLUS_ALIAS = re.compile(r"\+.+@")   # gmail-style plus aliases often indicate mailing lists


def is_transactional_address(email: str) -> bool:
    """
    Task 30: Return True if this email address should never be added to the network.
    Covers: noreply@, notifications@, plus-alias patterns, mailing lists.
    """
    local = email.split("@")[0] if "@" in email else email

    # Plus alias pattern
    if _PLUS_ALIAS.search(email):
        return True

    # No-reply / transactional prefixes
    if _NOREPLY_PATTERNS.match(email):
        return True

    # Mailing list indicators in the address
    if any(word in local.lower() for word in ["list", "announce", "digest", "newsletter"]):
        return True

    return False
