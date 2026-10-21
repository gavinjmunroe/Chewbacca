-- =============================================================================
-- A. Foundation & Multi-Tenant Data Model (BigQuery)
-- Tasks 1-10: All table definitions, partitioning, clustering
-- =============================================================================

-- Task 1: Dataset is created via Terraform (see terraform/main.tf)
-- Region is locked to match togari_data_lake region

-- Task 2: Tenants table
CREATE TABLE IF NOT EXISTS `connection_graph.tenants` (
  tenant_id     STRING NOT NULL,
  name          STRING NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  status        STRING NOT NULL,   -- 'active' | 'suspended' | 'deleted'
  kms_key_ref   STRING NOT NULL    -- full KMS key resource name
)
OPTIONS (
  description = 'One row per tenant (organization). KMS key ref used for CMEK encryption.'
);

-- Task 3: Internal users of the product
CREATE TABLE IF NOT EXISTS `connection_graph.users` (
  user_id    STRING NOT NULL,
  tenant_id  STRING NOT NULL,
  email      STRING NOT NULL,   -- encrypted at rest via CMEK
  role       STRING NOT NULL,   -- 'admin' | 'member' | 'viewer'
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(created_at)
CLUSTER BY tenant_id
OPTIONS (
  description = 'Internal users. tenant_id FK → tenants.tenant_id.'
);

-- Task 4: Resolved identities (one row per person, not per handle)
CREATE TABLE IF NOT EXISTS `connection_graph.identities` (
  identity_id        STRING NOT NULL,
  tenant_id          STRING NOT NULL,
  display_name       STRING,           -- encrypted
  normalized_name    STRING,           -- lowercase, no diacritics, no suffixes
  primary_email_hash STRING,           -- HMAC-SHA256 with tenant-scoped salt
  confidence_score   FLOAT64,          -- 0.0–1.0
  relationship_type  STRING,           -- 'personal' | 'professional' | 'mixed' | 'unknown'
  do_not_merge       BOOL NOT NULL DEFAULT FALSE,
  is_tombstone       BOOL NOT NULL DEFAULT FALSE,   -- soft-deleted via "delete me"
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(created_at)
CLUSTER BY tenant_id
OPTIONS (
  description = 'One row per resolved person. Many platform_handles may map to one identity.'
);

-- Task 5: Platform handles (many per identity)
CREATE TABLE IF NOT EXISTS `connection_graph.platform_handles` (
  handle_id     STRING NOT NULL,
  tenant_id     STRING NOT NULL,
  identity_id   STRING NOT NULL,   -- FK → identities.identity_id
  platform      STRING NOT NULL,   -- 'linkedin' | 'instagram' | 'twitter' | 'email' | 'github' | ...
  handle_value  STRING NOT NULL,   -- username, email address, or numeric ID
  profile_url   STRING,
  raw_metadata  JSON,              -- platform-specific JSON blob
  last_seen_at  TIMESTAMP,
  status        STRING NOT NULL DEFAULT 'active'  -- 'active' | 'quarantine' | 'dismissed'
)
PARTITION BY DATE(last_seen_at)
CLUSTER BY tenant_id, platform
OPTIONS (
  description = 'Many handles per identity. Platform + handle_value is a unique key per tenant.'
);

-- Task 6: Append-only connection events (source of truth)
CREATE TABLE IF NOT EXISTS `connection_graph.connection_events` (
  event_id          STRING NOT NULL,
  tenant_id         STRING NOT NULL,
  handle_id         STRING NOT NULL,   -- FK → platform_handles.handle_id
  event_type        STRING NOT NULL,   -- 'connection_accepted' | 'message_sent' | 'message_received' | 'mutual_follow' | 'dm_exchange' | ...
  event_timestamp   TIMESTAMP NOT NULL,
  source            STRING NOT NULL,   -- platform name
  idempotency_key   STRING NOT NULL,   -- platform + platform_event_id; deduplicate on this
  payload           JSON              -- raw platform event payload (PII stripped or encrypted)
)
PARTITION BY DATE(event_timestamp)
CLUSTER BY tenant_id, source
OPTIONS (
  description = 'Append-only event log. This is the source of truth. Never delete rows.'
);

-- Task 7: Derived connections view (materialized from events)
CREATE TABLE IF NOT EXISTS `connection_graph.connections` (
  connection_id      STRING NOT NULL,
  tenant_id          STRING NOT NULL,
  identity_id        STRING NOT NULL,   -- FK → identities.identity_id
  channel            STRING NOT NULL,   -- platform name
  status             STRING NOT NULL,   -- 'active' | 'quarantine' | 'dismissed' | 'deleted'
  first_connected_at TIMESTAMP,
  last_signal_at     TIMESTAMP,
  signal_count       INT64 NOT NULL DEFAULT 0
)
PARTITION BY DATE(first_connected_at)
CLUSTER BY tenant_id, channel
OPTIONS (
  description = 'Derived from connection_events. Rebuilt by the threshold promotion job.'
);

-- Task 8: Match review queue for borderline identity matches (0.6–0.85 score)
CREATE TABLE IF NOT EXISTS `connection_graph.match_review_queue` (
  review_id              STRING NOT NULL,
  tenant_id              STRING NOT NULL,
  candidate_identity_id  STRING NOT NULL,
  candidate_handle_id    STRING NOT NULL,
  score                  FLOAT64 NOT NULL,
  signals                JSON,             -- breakdown of signals that drove the score
  status                 STRING NOT NULL DEFAULT 'pending',  -- 'pending' | 'merged' | 'kept_separate' | 'unsure'
  reviewer_user_id       STRING,
  reviewed_at            TIMESTAMP,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(created_at)
CLUSTER BY tenant_id, status
OPTIONS (
  description = 'Borderline (0.6–0.85) identity matches awaiting human review.'
);

-- Task 9: Audit log (every read AND write of identity data)
CREATE TABLE IF NOT EXISTS `connection_graph.audit_log` (
  audit_id     STRING NOT NULL,
  tenant_id    STRING NOT NULL,
  actor_user_id STRING NOT NULL,
  action       STRING NOT NULL,   -- 'read' | 'merge' | 'unmerge' | 'delete' | 'export' | 'update' | ...
  target_type  STRING NOT NULL,   -- 'identity' | 'handle' | 'connection' | 'event' | ...
  target_id    STRING NOT NULL,
  timestamp    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  ip           STRING,
  request_id   STRING
)
PARTITION BY DATE(timestamp)
CLUSTER BY tenant_id, action
OPTIONS (
  description = 'Immutable audit trail. Every read and write. Required for DSAR and breach investigation.'
);

-- Task 10: do_not_merge override table (B.21)
CREATE TABLE IF NOT EXISTS `connection_graph.do_not_merge_overrides` (
  override_id   STRING NOT NULL,
  tenant_id     STRING NOT NULL,
  identity_id_a STRING NOT NULL,
  identity_id_b STRING NOT NULL,
  set_by_user   STRING NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
CLUSTER BY tenant_id
OPTIONS (
  description = 'If a user declares two identities are different people, they are never auto-merged again.'
);

-- Task 10: Inclusion rules table (C.24 - configurable per tenant)
CREATE TABLE IF NOT EXISTS `connection_graph.inclusion_rules` (
  rule_id        STRING NOT NULL,
  tenant_id      STRING NOT NULL,
  platform       STRING NOT NULL,
  rule_type      STRING NOT NULL,   -- 'outbound_reply_count' | 'accepted_connection' | 'mutual_follow' | 'dm_exchange'
  threshold      INT64  NOT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
CLUSTER BY tenant_id, platform
OPTIONS (
  description = 'Per-tenant inclusion thresholds. Configurable without redeployment.'
);

-- Task 10: Platform kill switches (H.74)
CREATE TABLE IF NOT EXISTS `connection_graph.platform_kill_switches` (
  platform      STRING NOT NULL,
  tenant_id     STRING,           -- NULL = global kill
  is_killed     BOOL NOT NULL DEFAULT FALSE,
  killed_at     TIMESTAMP,
  killed_by     STRING,
  reason        STRING,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
OPTIONS (
  description = 'Per-platform emergency stop. If is_killed=TRUE ingestion halts in <1 min.'
);
