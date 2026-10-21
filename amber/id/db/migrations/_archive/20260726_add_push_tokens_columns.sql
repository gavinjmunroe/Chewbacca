-- Chunk 4d: give amber push_tokens a home for the raw device token so
-- push-tokens.js can move off Firestore without losing what delivery needs.
-- The existing table stored only token_hash; the Firestore store this replaces
-- kept the RAW Expo/APNs token in the doc body because amber-platform needs it
-- to actually send. `token` holds that raw value; `updated_at` mirrors the
-- re-registration bump the Firestore store did.
--
-- Additive + idempotent. token is nullable (older rows have none yet);
-- updated_at defaults to now() so existing rows get a sane value.

ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS token text;
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
