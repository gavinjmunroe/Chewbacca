-- Chunk 4b: move the generic agent_data / agent_log store off Firestore onto
-- Cloud SQL amber. owner_id is the amber_id resolved from the tenant DID. The
-- full jsonb payload lives in `row` (with tenant_did/table_name/row_key folded
-- in for read parity with the Firestore docs). Idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS agent_data (
  owner_id   uuid NOT NULL,
  table_name text NOT NULL,
  row_key    text NOT NULL,
  row        jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_data_owner_table_key_idx
  ON agent_data (owner_id, table_name, row_key);

CREATE INDEX IF NOT EXISTS agent_data_owner_table_active_idx
  ON agent_data (owner_id, table_name)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS agent_log (
  id         bigserial PRIMARY KEY,
  owner_id   uuid NOT NULL,
  table_name text NOT NULL,
  row        jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_log_owner_table_created_idx
  ON agent_log (owner_id, table_name, created_at DESC);
