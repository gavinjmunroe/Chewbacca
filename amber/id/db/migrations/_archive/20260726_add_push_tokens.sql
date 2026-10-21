-- push_tokens — the device tokens Amber pushes to.
--
-- WHY THIS FILE IS BACKDATED TO 07-26
-- 20260726_add_push_tokens_columns.sql has always ALTERed this table, but no
-- migration ever CREATEd it: the table only existed because push-tokens.js built
-- it lazily on first use. A fresh database therefore ran the ALTER against a
-- relation that did not exist and failed. This file sorts immediately before that
-- ALTER ("." < "_" at the byte level), so the create now precedes the alter and a
-- fresh database builds in one pass.
--
-- The shape below is the CURRENT shape, `token` and `updated_at` included, which
-- makes the following ALTER an intentional no-op rather than a required step.
--
-- THE UNIQUE INDEX IS NOT DECORATION. The upsert in push-tokens.js uses
-- ON CONFLICT (owner_id, token_hash). Without a matching unique constraint
-- Postgres raises 42P10, the route 500s, and the client only console.warns — so
-- every device registration fails silently and the app looks healthy.

CREATE TABLE IF NOT EXISTS push_tokens (
  id          bigserial   PRIMARY KEY,
  owner_id    text        NOT NULL,
  -- sha256 of the raw token, hex, TRUNCATED TO 24 CHARS (see hashToken in
  -- push-tokens.js). Same value the Firestore store used as the device doc id,
  -- so re-registration stays idempotent. The identity used for dedupe.
  token_hash  text        NOT NULL,
  -- The RAW Expo/APNs token. Delivery needs the plaintext, so unlike a refresh
  -- token this cannot be stored as a hash alone.
  token       text        NOT NULL,
  platform    text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_push_tokens_owner_token
  ON push_tokens (owner_id, token_hash);
