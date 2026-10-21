-- Usernames, connection requests, and confirmed connections.
-- Idempotent — all statements use IF NOT EXISTS or ADD COLUMN IF NOT EXISTS.

ALTER TABLE users ADD COLUMN IF NOT EXISTS username text;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uidx
  ON users (lower(username))
  WHERE username IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS connection_requests (
  id                  bigserial   PRIMARY KEY,
  requester_amber_id  uuid        NOT NULL,
  addressee_amber_id  uuid        NOT NULL,
  status              text        NOT NULL DEFAULT 'pending',
  message             text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  responded_at        timestamptz,
  deleted_at          timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS conn_req_pending_uidx
  ON connection_requests (requester_amber_id, addressee_amber_id)
  WHERE status = 'pending' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS conn_req_addressee_idx
  ON connection_requests (addressee_amber_id, status);

CREATE TABLE IF NOT EXISTS connections (
  id          bigserial   PRIMARY KEY,
  user_a      uuid        NOT NULL,
  user_b      uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CHECK (user_a < user_b)
);

CREATE UNIQUE INDEX IF NOT EXISTS connections_pair_uidx
  ON connections (user_a, user_b);

CREATE INDEX IF NOT EXISTS connections_user_a_idx ON connections (user_a);
CREATE INDEX IF NOT EXISTS connections_user_b_idx ON connections (user_b);
