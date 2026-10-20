-- Migration 005: Tenant isolation — owner_id on contacts + social_connections
-- Dataset: togari_dnc
-- Project: midyear-glazing-485303-u3
--
-- WS-6: per-user data isolation audit. Every row in contacts and
-- social_connections must carry the Togari/Auth0 owner_id so all BQ queries
-- can filter `WHERE owner_id = @owner_id`. Without this, one user's match
-- can return another user's contacts.
--
-- Note: social_connections already has owner_account_id and owner_username,
-- but those are platform-side identifiers (e.g. Kevin's LinkedIn account ID).
-- owner_id is the Togari tenant key (Auth0 sub). Different concept.
--
-- Backfill strategy: legacy rows pre-dating per-user secret storage all came
-- from env-var creds (Karthik's account). Assign them owner_id = 'env-default',
-- which matches the sentinel userId used in user-sync.ts:172/175/178 for the
-- env fallback path.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add owner_id to contacts
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE `midyear-glazing-485303-u3.togari_dnc.contacts`
  ADD COLUMN IF NOT EXISTS owner_id STRING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Add owner_id to social_connections
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE `midyear-glazing-485303-u3.togari_dnc.social_connections`
  ADD COLUMN IF NOT EXISTS owner_id STRING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Backfill — every existing row gets 'env-default' (the legacy single-tenant
--    sentinel). Going forward, new rows must set owner_id explicitly.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE `midyear-glazing-485303-u3.togari_dnc.contacts`
SET owner_id = 'env-default'
WHERE owner_id IS NULL;

UPDATE `midyear-glazing-485303-u3.togari_dnc.social_connections`
SET owner_id = 'env-default'
WHERE owner_id IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Tenant-scoped view: drop-in replacement for v_dnc_unified that filters
--    by owner. Callers should switch to this view OR include owner_id in WHERE.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW `midyear-glazing-485303-u3.togari_dnc.v_dnc_unified_by_owner` AS
SELECT
  sc.owner_id,
  sc.connection_id,
  sc.platform,
  sc.username,
  sc.full_name,
  sc.profile_url,
  sc.work_email,
  sc.current_title,
  sc.current_company,
  sc.connection_type,
  sc.connected_at,
  sc.is_dnc,
  sc.dnc_reason,
  sc.dnc_added_at,
  sc.synced_at,
  c.contact_id  AS dnc_contact_id,
  c.email       AS dnc_email
FROM `midyear-glazing-485303-u3.togari_dnc.social_connections` sc
LEFT JOIN `midyear-glazing-485303-u3.togari_dnc.contacts` c
  ON sc.dnc_contact_id = c.contact_id AND sc.owner_id = c.owner_id;
