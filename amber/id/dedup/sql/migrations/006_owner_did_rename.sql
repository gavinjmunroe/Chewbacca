-- Migration 006: rename owner_id -> owner_did across togari_dnc tables.
--
-- amber-id is Privy-native and treats `did:privy:...` as the canonical
-- tenant identifier (the "DID-first" model). Renaming owner_id to
-- owner_did everywhere keeps the column name truthful and matches the
-- type contracts in dedup/types/index.ts (which use ownerDid in TS land).
--
-- Existing legacy rows tagged 'env-default' are untouched (column rename
-- preserves data, only the label changes).
--
-- Touches: contacts, social_connections, api_keys + the unified view.

ALTER TABLE `midyear-glazing-485303-u3.togari_dnc.contacts`
  RENAME COLUMN owner_id TO owner_did;

ALTER TABLE `midyear-glazing-485303-u3.togari_dnc.social_connections`
  RENAME COLUMN owner_id TO owner_did;

ALTER TABLE `midyear-glazing-485303-u3.togari_dnc.api_keys`
  RENAME COLUMN owner_id TO owner_did;

-- Recreate the unified view so its column list and JOIN stay in sync
-- with the renamed source columns.
CREATE OR REPLACE VIEW `midyear-glazing-485303-u3.togari_dnc.v_dnc_unified_by_owner` AS
SELECT
  sc.owner_did,
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
  ON sc.dnc_contact_id = c.contact_id AND sc.owner_did = c.owner_did;
