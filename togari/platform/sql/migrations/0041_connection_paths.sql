-- 0041_connection_paths.sql
--
-- Warm-intro paths waiting for, or already in, the daily Slack digest.
--
-- Clay's results table posts each finished path to POST /connections/paths:
-- customer contact -> bridge -> target account -> buyer. Togari keeps it here
-- until the next digest (src/connections/digest.ts) posts it to the client's
-- channel, then records what people did with it: Good path or Not a fit, and
-- the intro draft a Good path produces.
--
-- path_id is a hash of client + champion + bridge + target + buyer, not of a
-- Clay row id. Researching the same person twice, or Clay resending a row,
-- produces the same path and changes nothing — so a path marked Not a fit
-- never comes back, and nothing is posted twice. Uniqueness is enforced by
-- the MERGE in src/connections/paths.ts, as for reply_items.
--
-- A digest claims its paths by stamping digest_id and posted_at BEFORE
-- posting, so two runs cannot post the same path; a failed post clears both
-- and the paths wait for the next run.
--
-- Apply: bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < this_file
-- Net-new empty table; nothing existing is altered.

CREATE TABLE IF NOT EXISTS `togari_data_lake.connection_paths` (
  path_id          STRING    NOT NULL,
  client_id        STRING    NOT NULL,
  person_row_id    STRING,               -- the connection_items row it came from
  created_at       TIMESTAMP NOT NULL,
  updated_at       TIMESTAMP NOT NULL,

  -- ── The path ────────────────────────────────────────────────────────
  champion_name    STRING    NOT NULL,   -- the customer contact Clay sent
  champion_title   STRING,
  champion_company STRING,
  bridge_name      STRING    NOT NULL,
  bridge_title     STRING,
  bridge_relation  STRING,               -- self | colleague
  bridge_linkedin  STRING,
  former_employer  STRING,
  former_title     STRING,
  start_year       INT64,
  end_year         INT64,
  role_source_url  STRING,
  target_account   STRING    NOT NULL,
  target_segment   STRING,
  match            STRING,               -- domain | name | parent_domain
  buyer_name       STRING    NOT NULL,
  buyer_title      STRING,
  buyer_persona    STRING,
  buyer_linkedin   STRING,
  buyer_source_url STRING,
  buyer_joined_year INT64,
  tenure_overlap   STRING,               -- yes | possible | no | unknown
  overlap_years    INT64,

  -- ── The digest ──────────────────────────────────────────────────────
  digest_id        STRING,               -- which run claimed it
  posted_at        TIMESTAMP,
  slack_channel    STRING,
  slack_ts         STRING,               -- the message the path's block is in
  thread_ts        STRING,               -- the digest's top message, for drafts

  -- ── What people did with it ─────────────────────────────────────────
  verdict          STRING,               -- good | not_a_fit
  verdict_by       STRING,               -- Slack user id
  verdict_at       TIMESTAMP,
  draft            STRING,               -- the intro ask, as last saved
  draft_ts         STRING                -- the thread reply holding the draft
)
CLUSTER BY client_id, posted_at;
