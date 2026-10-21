-- user_api_keys — programmatic access keys a user mints for their own Amber data.
--
-- Previously created only by the lazy ensureTable() in user-api-keys-store.js.
--
-- THE PLAINTEXT KEY IS RETURNED EXACTLY ONCE, at creation, and is never stored.
-- key_hash is a sha256 of it; key_prefix and last4 exist purely so a person can
-- recognise which key a row is without the key being recoverable from the row.
-- A leaked dump of this table therefore grants nothing.

CREATE TABLE IF NOT EXISTS user_api_keys (
  id           bigserial   PRIMARY KEY,
  -- Public identifier, safe to show and to log.
  key_id       text        NOT NULL UNIQUE,
  owner_id     text        NOT NULL,
  -- sha256 of the plaintext key. UNIQUE so the same key cannot be registered twice.
  key_hash     text        NOT NULL UNIQUE,
  key_prefix   text        NOT NULL,
  last4        text        NOT NULL,
  name         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_user_api_keys_owner ON user_api_keys(owner_id);
-- The auth hot path: hash the presented key, look it up here.
CREATE INDEX IF NOT EXISTS idx_user_api_keys_hash  ON user_api_keys(key_hash);
