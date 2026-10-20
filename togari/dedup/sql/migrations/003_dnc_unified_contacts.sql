-- Migration 003: togari_dnc.contacts — unified deduped contact schema
-- Replaces or extends the existing contacts table with source-tagged fields.
-- Project: midyear-glazing-485303-u3  Dataset: togari_dnc
-- Run each statement individually in BigQuery Console.

-- Drop and recreate with full schema (or ALTER if you want to preserve data)
-- Uncomment DROP only if you want a clean slate:
-- DROP TABLE IF EXISTS `midyear-glazing-485303-u3.togari_dnc.contacts`;

CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_dnc.contacts` (
  -- Identity
  contact_id           STRING    NOT NULL,   -- stable UUID, never changes
  full_name            STRING,
  first_name           STRING,
  last_name            STRING,

  -- Contact info
  email                STRING,               -- lowercase normalized
  phone                STRING,               -- E.164 (+13105551234)

  -- Social handles
  linkedin_url         STRING,
  linkedin_username    STRING,
  instagram_username   STRING,
  twitter_username     STRING,
  facebook_username    STRING,
  tiktok_username      STRING,

  -- Professional
  current_title        STRING,
  current_company      STRING,
  company_domain       STRING,

  -- Source tagging — the key field Karthik described
  sources              STRING,               -- comma-separated: 'linkedin,instagram,email'
  source_detail        JSON,                 -- per-source metadata: connected_at, platform_user_id etc.

  -- DNC
  is_dnc               BOOL    DEFAULT FALSE,
  dnc_reason           STRING,
  dnc_added_at         TIMESTAMP,

  -- Dedup metadata
  confidence_score     INT64,               -- 0-100: how confident this is one person
  merge_count          INT64  DEFAULT 1,    -- how many raw records were merged in
  first_seen_at        TIMESTAMP,
  last_updated_at      TIMESTAMP
)
PARTITION BY DATE(first_seen_at)
CLUSTER BY is_dnc, confidence_score
OPTIONS (description = 'Unified deduplicated contacts — one row per person, source-tagged across LinkedIn/Instagram/Twitter/email');

-- Add new columns to existing table (idempotent if table already exists)
ALTER TABLE `midyear-glazing-485303-u3.togari_dnc.contacts`
  ADD COLUMN IF NOT EXISTS linkedin_username   STRING,
  ADD COLUMN IF NOT EXISTS instagram_username  STRING,
  ADD COLUMN IF NOT EXISTS twitter_username    STRING,
  ADD COLUMN IF NOT EXISTS facebook_username   STRING,
  ADD COLUMN IF NOT EXISTS tiktok_username     STRING,
  ADD COLUMN IF NOT EXISTS sources             STRING,
  ADD COLUMN IF NOT EXISTS source_detail       JSON,
  ADD COLUMN IF NOT EXISTS confidence_score    INT64,
  ADD COLUMN IF NOT EXISTS merge_count         INT64,
  ADD COLUMN IF NOT EXISTS first_seen_at       TIMESTAMP,
  ADD COLUMN IF NOT EXISTS last_updated_at     TIMESTAMP;

-- View: contacts with source counts and DNC status (easy dashboard query)
CREATE OR REPLACE VIEW `midyear-glazing-485303-u3.togari_dnc.v_contacts_enriched` AS
SELECT
  c.contact_id,
  c.full_name,
  c.email,
  c.phone,
  c.linkedin_url,
  c.linkedin_username,
  c.instagram_username,
  c.twitter_username,
  c.current_title,
  c.current_company,
  c.sources,
  ARRAY_LENGTH(SPLIT(c.sources, ',')) AS source_count,
  c.is_dnc,
  c.dnc_reason,
  c.confidence_score,
  c.merge_count,
  c.first_seen_at,
  c.last_updated_at
FROM `midyear-glazing-485303-u3.togari_dnc.contacts` c
ORDER BY source_count DESC, c.last_updated_at DESC;

-- View: DNC list only (what Maggie's original project needed)
CREATE OR REPLACE VIEW `midyear-glazing-485303-u3.togari_dnc.v_dnc_only` AS
SELECT contact_id, full_name, email, phone, linkedin_url, sources, dnc_reason, dnc_added_at
FROM `midyear-glazing-485303-u3.togari_dnc.contacts`
WHERE is_dnc = TRUE
ORDER BY dnc_added_at DESC;
