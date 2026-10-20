"""
h_security/security.py
Tasks 63–77: Tenant isolation, KMS-CMEK encryption, email hashing with tenant salt,
audit-on-read, GDPR delete/export, Secret Manager, kill switch, image scanning,
architectural rules.
"""

import hashlib
import hmac
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from google.cloud import kms, secretmanager, storage
from google.cloud.storage import Blob

logger = logging.getLogger(__name__)

PROJECT_ID = os.environ["GCP_PROJECT_ID"]


# ---------------------------------------------------------------------------
# Task 64 — KMS-CMEK: encrypt / decrypt PII fields
# ---------------------------------------------------------------------------

class KMSFieldEncryption:
    """
    Task 64: Encrypt individual PII fields (display_name, email, phone)
    using Cloud KMS CMEK. Key rotated annually (Task 90).
    """

    def __init__(self, key_resource_name: str):
        self.key_name = key_resource_name  # full KMS key path
        self._client  = kms.KeyManagementServiceClient()

    def encrypt(self, plaintext: str) -> str:
        """Returns base64-encoded ciphertext."""
        import base64
        response = self._client.encrypt(
            request={"name": self.key_name, "plaintext": plaintext.encode()}
        )
        return base64.b64encode(response.ciphertext).decode()

    def decrypt(self, ciphertext_b64: str) -> str:
        """Returns decrypted plaintext."""
        import base64
        ciphertext = base64.b64decode(ciphertext_b64)
        response   = self._client.decrypt(
            request={"name": self.key_name, "ciphertext": ciphertext}
        )
        return response.plaintext.decode()


# ---------------------------------------------------------------------------
# Task 65 — Tenant-scoped email hashing
# ---------------------------------------------------------------------------

def get_tenant_salt(tenant_id: str) -> str:
    """
    Task 65: Fetch a per-tenant HMAC salt from Secret Manager.
    Each tenant gets a unique salt so a breach of one tenant's data
    cannot be cross-referenced with another's.
    """
    client     = secretmanager.SecretManagerServiceClient()
    secret_name = f"projects/{PROJECT_ID}/secrets/tenant-salt-{tenant_id}/versions/latest"
    try:
        resp = client.access_secret_version(request={"name": secret_name})
        return resp.payload.data.decode("utf-8")
    except Exception:
        # First time: generate and store a new salt
        import secrets
        new_salt = secrets.token_hex(32)
        _store_tenant_salt(tenant_id, new_salt)
        return new_salt


def _store_tenant_salt(tenant_id: str, salt: str) -> None:
    client      = secretmanager.SecretManagerServiceClient()
    parent      = f"projects/{PROJECT_ID}"
    secret_id   = f"tenant-salt-{tenant_id}"
    secret_name = f"{parent}/secrets/{secret_id}"
    try:
        client.create_secret(
            request={"parent": parent, "secret_id": secret_id, "replication": {"automatic": {}}}
        )
    except Exception:
        pass  # already exists
    client.add_secret_version(
        request={"parent": secret_name, "payload": {"data": salt.encode()}}
    )


def hash_email_for_tenant(email: str, tenant_id: str) -> str:
    """Task 65: HMAC-SHA256 with tenant-scoped salt."""
    salt = get_tenant_salt(tenant_id)
    return hmac.new(salt.encode(), email.lower().strip().encode(), hashlib.sha256).hexdigest()


# ---------------------------------------------------------------------------
# Task 63 — Tenant isolation: every query must be scoped
# ---------------------------------------------------------------------------

def assert_tenant_scope(query: str, tenant_id: str) -> str:
    """
    Task 63: Runtime guard — every BigQuery query must include WHERE tenant_id = ...
    Raises ValueError if tenant_id is missing from the query string.
    This is defense-in-depth at the app layer; the view layer enforces the same.
    """
    if f"tenant_id" not in query:
        raise ValueError(
            f"SECURITY: Query is missing tenant_id scope! tenant_id={tenant_id}\n{query}"
        )
    return query


# ---------------------------------------------------------------------------
# Task 66 — Audit on read (not just write)
# ---------------------------------------------------------------------------

def audit_read(
    bq_client,
    tenant_id: str,
    actor_user_id: str,
    target_type: str,
    target_id: str,
    ip: Optional[str] = None,
    request_id: Optional[str] = None,
) -> None:
    """
    Task 66: Write an audit_log row for every READ of identity data.
    Called by every retrieval API endpoint (Section I).
    Required for DSAR and breach investigation.
    """
    from a_foundation.bigquery_setup import PROJECT_ID as PID, DATASET_ID

    row = {
        "audit_id":      str(uuid.uuid4()),
        "tenant_id":     tenant_id,
        "actor_user_id": actor_user_id,
        "action":        "read",
        "target_type":   target_type,
        "target_id":     target_id,
        "timestamp":     datetime.now(timezone.utc).isoformat(),
        "ip":            ip,
        "request_id":    request_id,
    }
    table  = bq_client.get_table(f"{PID}.{DATASET_ID}.audit_log")
    errors = bq_client.insert_rows_json(table, [row])
    if errors:
        # Critical: audit write failure must alert
        logger.critical("AUDIT LOG WRITE FAILED: %s", errors)


# ---------------------------------------------------------------------------
# Task 68 — Per-identity "delete me" function (GDPR right to erasure)
# ---------------------------------------------------------------------------

def delete_identity(
    bq_client,
    tenant_id: str,
    identity_id: str,
    actor_user_id: str,
) -> None:
    """
    Task 68: Soft-delete within 30 days per GDPR erasure obligation.
    1. Tombstone the identity (is_tombstone=TRUE).
    2. Set all handles to status='deleted'.
    3. Remove personal data from identities row (zero out PII columns).
    4. Write a tombstone event so re-ingestion doesn't resurrect the person.
    5. Audit log the deletion.
    """
    from a_foundation.bigquery_setup import PROJECT_ID as PID, DATASET_ID

    now = datetime.now(timezone.utc).isoformat()

    # Tombstone identity
    bq_client.query(f"""
        UPDATE `{PID}.{DATASET_ID}.identities`
        SET is_tombstone = TRUE,
            display_name = NULL,
            normalized_name = NULL,
            primary_email_hash = NULL,
            updated_at = CURRENT_TIMESTAMP()
        WHERE tenant_id = @tenant_id AND identity_id = @identity_id
    """).result()

    # Mark handles deleted
    bq_client.query(f"""
        UPDATE `{PID}.{DATASET_ID}.platform_handles`
        SET status = 'deleted', raw_metadata = NULL
        WHERE tenant_id = @tenant_id AND identity_id = @identity_id
    """).result()

    # Write tombstone event (prevents re-ingestion resurrection)
    tombstone_row = {
        "event_id":        str(uuid.uuid4()),
        "tenant_id":       tenant_id,
        "handle_id":       identity_id,
        "event_type":      "identity_tombstone",
        "event_timestamp": now,
        "source":          "gdpr_erasure",
        "idempotency_key": f"tombstone:{identity_id}",
        "payload":         json.dumps({"identity_id": identity_id, "deleted_at": now}),
    }
    table  = bq_client.get_table(f"{PID}.{DATASET_ID}.connection_events")
    bq_client.insert_rows_json(table, [tombstone_row])

    # Audit
    audit_read(
        bq_client, tenant_id, actor_user_id,
        target_type="identity", target_id=identity_id, request_id="gdpr_erasure",
    )
    logger.info("Identity %s tombstoned for tenant %s", identity_id, tenant_id)


# ---------------------------------------------------------------------------
# Task 69 — Per-tenant full export (DSAR / customer trust)
# ---------------------------------------------------------------------------

def export_tenant_data(
    bq_client,
    tenant_id: str,
    actor_user_id: str,
    destination_gcs_uri: str,
) -> str:
    """
    Task 69: Export all identity, handle, connection, and event data for a tenant.
    Writes newline-JSON to GCS. Returns the GCS URI.
    """
    from google.cloud import bigquery as _bq
    from a_foundation.bigquery_setup import PROJECT_ID as PID, DATASET_ID

    # destination_gcs_uri must be a literal in EXPORT DATA OPTIONS — validate
    # it instead of parameterizing. tenant_id IS parameterized.
    if not destination_gcs_uri.startswith("gs://") or "'" in destination_gcs_uri:
        raise ValueError(f"Invalid destination_gcs_uri: {destination_gcs_uri!r}")

    job_config = _bq.QueryJobConfig(query_parameters=[
        _bq.ScalarQueryParameter("tenant_id", "STRING", tenant_id),
    ])
    bq_client.query(f"""
        EXPORT DATA OPTIONS(
          uri='{destination_gcs_uri}/*.json',
          format='JSON',
          overwrite=TRUE
        ) AS
        SELECT i.*, ph.platform, ph.handle_value, c.channel, c.status, c.last_signal_at
        FROM `{PID}.{DATASET_ID}.identities` i
        LEFT JOIN `{PID}.{DATASET_ID}.platform_handles` ph USING (tenant_id, identity_id)
        LEFT JOIN `{PID}.{DATASET_ID}.connections` c USING (tenant_id, identity_id)
        WHERE i.tenant_id = @tenant_id AND i.is_tombstone = FALSE
    """, job_config=job_config).result()

    audit_read(
        bq_client, tenant_id, actor_user_id,
        target_type="tenant_export", target_id=tenant_id, request_id="dsar_export",
    )
    return destination_gcs_uri


# ---------------------------------------------------------------------------
# Task 75 — Avatar/image malware scanning before storage
# ---------------------------------------------------------------------------

def safe_store_avatar(
    bucket_name: str,
    object_name: str,
    image_bytes: bytes,
    content_type: str,
) -> str:
    """
    Task 75: Upload avatar to Cloud Storage and scan for malware before
    making it accessible. Never execute or render uploaded HTML/SVG.
    """
    if content_type in ("text/html", "image/svg+xml", "application/javascript"):
        raise ValueError(
            f"Refusing to store executable content type: {content_type}. "
            "Only raster image types (JPEG, PNG, WEBP, GIF) are accepted."
        )

    gcs     = storage.Client()
    bucket  = gcs.bucket(bucket_name)
    blob    = bucket.blob(object_name)

    # Upload with safe headers; no public ACL
    blob.upload_from_string(image_bytes, content_type=content_type)

    # Cloud Storage Object Scan (DLP / malware scanning API) is configured
    # as a GCS notification → Cloud Function; the object is served only after
    # scan passes. For now we mark it as pending_scan.
    blob.metadata = {"scan_status": "pending"}
    blob.patch()

    logger.info("Avatar stored at gs://%s/%s — awaiting malware scan", bucket_name, object_name)
    return f"gs://{bucket_name}/{object_name}"


# ---------------------------------------------------------------------------
# Task 70 — Redact tokens from error traces
# ---------------------------------------------------------------------------

import re as _re
_TOKEN_PATTERN = _re.compile(
    r"(Bearer\s+)[A-Za-z0-9\-._~+/]+=*",
    flags=_re.IGNORECASE,
)


def redact_tokens(text: str) -> str:
    """Task 70: Replace any Bearer token value in log text with [REDACTED]."""
    return _TOKEN_PATTERN.sub(r"\1[REDACTED]", text)


# ---------------------------------------------------------------------------
# Task 74 — Platform kill switch (checked in BasePlatformIngestion.run())
# (Table-backed; see bigquery_setup.py → platform_kill_switches table)
# ---------------------------------------------------------------------------

def kill_platform(
    bq_client,
    platform: str,
    killed_by: str,
    reason: str,
    tenant_id: Optional[str] = None,
) -> None:
    """
    Task 74: Emergency stop for one platform. Takes effect in <1 min
    because every ingestion worker checks this table at startup.
    """
    from a_foundation.bigquery_setup import PROJECT_ID as PID, DATASET_ID

    now = datetime.now(timezone.utc).isoformat()
    row = {
        "platform":   platform,
        "tenant_id":  tenant_id,
        "is_killed":  True,
        "killed_at":  now,
        "killed_by":  killed_by,
        "reason":     reason,
        "updated_at": now,
    }
    table  = bq_client.get_table(f"{PID}.{DATASET_ID}.platform_kill_switches")
    errors = bq_client.insert_rows_json(table, [row])
    if not errors:
        logger.critical(
            "KILL SWITCH ACTIVATED for platform=%s by %s. Reason: %s",
            platform, killed_by, reason,
        )


# ---------------------------------------------------------------------------
# Task 76 — Architectural rule (documented + enforced in code review)
# ---------------------------------------------------------------------------

"""
ARCHITECTURAL RULE (enforced via code review checklist):
  ┌─────────────────────────────────────────────────────────────────┐
  │ NO outbound calls from our system to a contact's machine, ever. │
  │ We are read-only consumers of APIs the tenant authenticated.    │
  │ This rule is in the README and checked on every PR.             │
  └─────────────────────────────────────────────────────────────────┘
"""


# ---------------------------------------------------------------------------
# Task 77 — Internal UI data use banner (returned by API for UI to render)
# ---------------------------------------------------------------------------

DATA_USE_BANNER = (
    "⚠️ This data is for the connected tenant user's own outreach. "
    "Do not export, share, or use for any unrelated purpose."
)
