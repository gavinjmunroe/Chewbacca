-- Chunk 4d Batch B: Cloud SQL homes for the standalone Firestore stores.
-- Idempotent (IF NOT EXISTS). otp-store.js is NOT here — it reuses the existing
-- otp_codes table via csql-otp-store.js (no new table).

-- reminders (was Firestore flat collection "pending_reminders").
-- Filterable fields are real columns; the full canonical row lives in data.
-- owner_id is the amber_id resolved from tenant_did — NULLABLE because a row
-- whose tenant_did does not resolve must still be stored so the global worker
-- (listDueReminders) can fire it. due_at mirrors when.iso for the due scan.
CREATE TABLE IF NOT EXISTS reminders (
  reminder_id text PRIMARY KEY,
  owner_id    uuid,
  status      text NOT NULL,
  due_at      timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  data        jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS reminders_due_idx ON reminders (status, due_at);
CREATE INDEX IF NOT EXISTS reminders_owner_status_idx ON reminders (owner_id, status);

-- slack_links (was Firestore "slack_links", doc id "<team>:<user>").
-- Keyed by (team, slack_user) — NOT amber_id. person_id/phone_e164/status are
-- mirrored as columns for ops; the full doc lives in data.
CREATE TABLE IF NOT EXISTS slack_links (
  team       text NOT NULL,
  slack_user text NOT NULL,
  status     text,
  person_id  text,
  phone_e164 text,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team, slack_user)
);

-- pending_oauth (was Firestore "pending_oauth", doc id = opaque state token).
-- Ephemeral PKCE/state; the whole payload lives in data. No TTL service in
-- Cloud SQL — consume deletes the row, and oauth/state.js enforces expiry on
-- read, so abandoned rows are harmless (a periodic cleanup can prune by
-- created_at if they ever accumulate).
CREATE TABLE IF NOT EXISTS pending_oauth (
  state      text PRIMARY KEY,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
