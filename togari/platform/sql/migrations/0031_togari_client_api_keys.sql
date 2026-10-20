-- 0031_togari_client_api_keys.sql
--
-- Per-client portal API keys. Backs the portal-auth middleware so an external
-- client (e.g. Joe at AIJ) can call /api/v1/portal/* with a key scoped to their
-- own client_id, instead of sharing the internal TOGARI_API_KEY.
--
-- Security: we store ONLY the SHA-256 hash of each key (key_hash), never the
-- plaintext. The raw key ("tgc_..." prefix) is shown to the admin exactly once
-- at issue time and is unrecoverable afterwards. Revocation flips is_active to
-- FALSE (keys are never deleted, so the audit trail is preserved).
--
-- Tenancy key is client_id (the decided canonical key), matching the rest of
-- togari_data_lake. Net-new empty table; nothing existing is altered.
--
-- Apply: bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < this_file

CREATE TABLE IF NOT EXISTS `togari_data_lake.client_api_keys` (
  key_id        STRING    NOT NULL,   -- opaque id for revocation / audit
  client_id     STRING    NOT NULL,   -- tenant this key is scoped to
  key_hash      STRING    NOT NULL,   -- SHA-256 hex of the raw key (never plaintext)
  label         STRING,               -- human label, e.g. "AIJ portal - Joe"
  scopes        STRING,               -- comma-separated scopes, e.g. "portal:dnc"
  is_active     BOOL,                 -- FALSE once revoked
  created_at    TIMESTAMP NOT NULL,
  last_used_at  TIMESTAMP             -- best-effort touch on each successful auth
)
CLUSTER BY client_id;
