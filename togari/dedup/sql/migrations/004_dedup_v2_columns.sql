-- Migration 004: Dedup v2 — realness + Apple write-back + API keys
-- Dataset: togari_dnc
-- Project: midyear-glazing-485303-u3
--
-- Adds:
--   1. is_real_person, realness_score, realness_reason (WS-4)
--   2. apple_contact_id, apple_etag (WS-3)
--   3. api_keys table (WS-2)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend contacts with realness + apple write-back columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE `midyear-glazing-485303-u3.togari_dnc.contacts`
  ADD COLUMN IF NOT EXISTS is_real_person   BOOL,
  ADD COLUMN IF NOT EXISTS realness_score   INT64,
  ADD COLUMN IF NOT EXISTS realness_reason  STRING,
  ADD COLUMN IF NOT EXISTS apple_contact_id STRING,
  ADD COLUMN IF NOT EXISTS apple_etag       STRING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. api_keys — long-lived bearer tokens for Clay integration
--    Raw key never stored. key_hash = SHA-256(raw_key). key_prefix = raw_key[0:12].
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_dnc.api_keys` (
  key_id        STRING NOT NULL,           -- UUID, stable identifier
  owner_id      STRING NOT NULL,           -- Auth0 sub
  key_prefix    STRING NOT NULL,           -- first 12 chars of raw key, for display
  key_hash      STRING NOT NULL,           -- SHA-256 of full raw key
  name          STRING,                    -- user-facing label e.g. "Clay table 1"
  created_at    TIMESTAMP NOT NULL,
  last_used_at  TIMESTAMP,
  revoked_at    TIMESTAMP
)
CLUSTER BY owner_id
OPTIONS (description = 'API keys for Togari dedup v2 (Clay-callable). One row per issued key, never stores raw secret.');
