-- Migration 002: Togari DNC — Social Connections Schema
-- Dataset: togari_dnc
-- Project: midyear-glazing-485303-u3
--
-- Adds social platform fields to the existing contacts table
-- and creates a new social_connections table for real-time sync.
-- Run in BigQuery console (each statement separately).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Expand existing togari_dnc.contacts with social fields
--    (Add only if columns don't already exist — idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE `midyear-glazing-485303-u3.togari_dnc.contacts`
  ADD COLUMN IF NOT EXISTS linkedin_username   STRING,
  ADD COLUMN IF NOT EXISTS instagram_username  STRING,
  ADD COLUMN IF NOT EXISTS twitter_username    STRING,
  ADD COLUMN IF NOT EXISTS facebook_username   STRING,
  ADD COLUMN IF NOT EXISTS tiktok_username     STRING,
  ADD COLUMN IF NOT EXISTS platform_sources    ARRAY<STRING>,   -- which platforms this contact was found on
  ADD COLUMN IF NOT EXISTS last_synced_at      TIMESTAMP,
  ADD COLUMN IF NOT EXISTS sync_status         STRING;          -- active | paused | error

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. social_connections — one row per connection/follower per platform
--    This is the real-time sync table. Webhooks + polling write here.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_dnc.social_connections` (
  -- Identity
  connection_id       STRING    NOT NULL,    -- UUID generated at sync time
  platform            STRING    NOT NULL,    -- linkedin | instagram | twitter | facebook | tiktok

  -- The account being tracked (Kevin's account)
  owner_account_id    STRING,               -- platform-specific account ID for Kevin
  owner_username      STRING,               -- e.g. "kevinbma"

  -- The connection/follower
  platform_user_id    STRING,               -- platform-native user ID
  username            STRING,               -- handle / username
  full_name           STRING,
  profile_url         STRING,
  avatar_url          STRING,
  bio                 STRING,
  follower_count      INT64,
  following_count     INT64,
  is_verified         BOOL,

  -- Connection metadata
  connection_type     STRING,               -- connection | follower | following | friend
  connected_at        TIMESTAMP,            -- when Kevin connected/followed this person
  connection_degree   INT64,                -- 1 = direct, 2 = 2nd degree (LinkedIn)

  -- Cross-platform linkage
  dnc_contact_id      STRING,               -- FK to togari_dnc.contacts.id (if matched)
  work_email          STRING,               -- enriched from platform or external source
  current_title       STRING,
  current_company     STRING,
  company_domain      STRING,

  -- DNC flags
  is_dnc              BOOL    DEFAULT FALSE, -- TRUE = do not contact
  dnc_reason          STRING,               -- unsubscribed | bounced | manual | legal
  dnc_added_at        TIMESTAMP,

  -- Sync metadata
  raw_platform_data   JSON,                 -- full raw API response for this connection
  synced_at           TIMESTAMP,            -- when this row was last synced
  created_at          TIMESTAMP,
  updated_at          TIMESTAMP
)
PARTITION BY DATE(created_at)
CLUSTER BY platform, connection_type, is_dnc
OPTIONS (
  description = 'Real-time social connections from LinkedIn, Instagram, Twitter, Facebook. One row per connection per platform. Partitioned by creation date, clustered for fast DNC lookups.'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. sync_log — audit trail for every sync job run
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_dnc.sync_log` (
  sync_id           STRING    NOT NULL,
  platform          STRING    NOT NULL,
  sync_type         STRING    NOT NULL,   -- full | incremental | webhook
  connections_fetched INT64,
  connections_new     INT64,
  connections_updated INT64,
  errors              INT64,
  error_messages      ARRAY<STRING>,
  duration_ms         INT64,
  status              STRING,             -- success | partial | failed
  started_at          TIMESTAMP,
  completed_at        TIMESTAMP
)
PARTITION BY DATE(started_at)
OPTIONS (
  description = 'Audit log for every social sync job run across all platforms'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Convenience view: unified DNC list across all platforms
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW `midyear-glazing-485303-u3.togari_dnc.v_dnc_unified` AS
SELECT
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
  -- DNC contact fields if matched
  c.id          AS dnc_contact_id,
  c.email       AS dnc_email
FROM `midyear-glazing-485303-u3.togari_dnc.social_connections` sc
LEFT JOIN `midyear-glazing-485303-u3.togari_dnc.contacts` c
  ON sc.dnc_contact_id = c.id
ORDER BY sc.connected_at DESC;
