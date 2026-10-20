-- 0049_network_graph.sql
--
-- The Togari network: every person, organization and job that warm-intro
-- research has found, for every client, in one place.
--
-- connection_items and connection_paths are per client and shaped around one
-- client's target list: a job history sits inside result_json, and a path only
-- exists if it hit that client's sheet. This dataset is the same facts with
-- the client taken out — people, organizations, and who worked where when, each
-- with its source — so that:
--
--   - a second client's targets can be matched against histories already paid
--     for, instead of researching the same people again;
--   - co-workers can be found by joining jobs (network_coworker_overlaps);
--   - the data can be offered as paths-as-a-service or licensed directly.
--
-- Written automatically by POST /connections/result (src/network/), and filled
-- from past research by scripts/backfill-network.ts. Nothing else writes here.
--
-- Everything is pooled, including what a client supplied (their customer
-- contacts and emails). source_client_ids records which clients a fact came
-- through and `licensable` / `suppressed` decide what may leave Togari, so a
-- client whose contract forbids reuse can be withdrawn without a re-build.
--
-- Keys are derived, not random, so re-recording the same research is a no-op:
--   org_id         d:<registrable domain>, else n:<normalized name>
--   person_id      li:<linkedin slug>,     else n:<normalized name>@<org_id>
--   employment_id  sha256(person_id | org_id | title | start_year)
-- A person seen once with a LinkedIn URL and once without can still end up as
-- two rows; they share name and org and can be merged later.
--
-- Uniqueness is enforced by the MERGEs in src/network/store.ts, not the table.
--
-- Apply: bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < this_file
-- Net-new dataset objects; nothing existing is altered.

CREATE SCHEMA IF NOT EXISTS `togari_core`;

-- ── Organizations ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `togari_core.network_organizations` (
  org_id           STRING    NOT NULL,
  name             STRING    NOT NULL,   -- best display name seen
  name_normalized  STRING,               -- src/connections/targets.ts normalizeOrgName
  domain           STRING,               -- registrable domain, e.g. tenethealth.com
  aliases          ARRAY<STRING>,        -- every other name a source used
  parent_org_id    STRING,               -- reserved: acquisitions and sub-brands
  org_type         STRING,               -- from a client's target sheet, if any
  segment          STRING,               -- likewise
  first_seen_at    TIMESTAMP NOT NULL,
  last_seen_at     TIMESTAMP NOT NULL
)
CLUSTER BY org_id;

-- ── People ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `togari_core.network_people` (
  person_id          STRING    NOT NULL,
  full_name          STRING    NOT NULL,
  linkedin_url       STRING,
  linkedin_slug      STRING,
  email              STRING,
  email_source       STRING,             -- client_supplied
  current_title      STRING,
  current_org_id     STRING,
  current_org_name   STRING,
  location           STRING,
  persona            STRING,             -- buyer persona, when found in a buyer seat
  -- How the person was found. A researched person (the one Clay sent, or a
  -- colleague) has a full career history; a buyer was only placed in their
  -- current seat. Reuse needs to know which.
  history_complete   BOOL      NOT NULL,
  identity_confirmed BOOL,
  last_researched_at TIMESTAMP,          -- last full-history research; drives reuse
  first_seen_at      TIMESTAMP NOT NULL,
  last_seen_at       TIMESTAMP NOT NULL,
  source_client_ids  ARRAY<STRING>,      -- every client whose research saw them
  -- What may leave Togari.
  licensable         BOOL      NOT NULL, -- false: internal use only
  suppressed         BOOL      NOT NULL, -- true: opted out; never sold, never pathed
  suppressed_reason  STRING,
  suppressed_at      TIMESTAMP
)
CLUSTER BY person_id;

-- ── Jobs: who worked where, when, and the source that says so ──────────────
CREATE TABLE IF NOT EXISTS `togari_core.network_employment` (
  employment_id       STRING    NOT NULL,
  person_id           STRING    NOT NULL,
  org_id              STRING    NOT NULL,
  org_name_as_sourced STRING,             -- the name the source used
  org_domain          STRING,
  title               STRING,
  start_year          INT64,
  end_year            INT64,
  -- true for a seat someone holds today (the customer contact's, a colleague's,
  -- a buyer's). NULL for a past job whose end year is missing: "present" and
  -- "unknown" arrive looking the same.
  is_current          BOOL,
  source_url          STRING,             -- NULL only for client_supplied seats
  evidence            STRING    NOT NULL, -- career_history | current_role | client_supplied
  method              STRING    NOT NULL, -- perplexity_computer
  research_id         STRING,             -- connection_items.id that last saw it
  client_id           STRING,             -- the client that research ran for
  first_seen_at       TIMESTAMP NOT NULL,
  last_seen_at        TIMESTAMP NOT NULL
)
CLUSTER BY org_id, person_id;

-- ── Research runs: what was paid for, and for whom ─────────────────────────
-- One row per connection_items result. The top-up step reads this to know
-- which colleagues and buyer seats a past run already covered.
CREATE TABLE IF NOT EXISTS `togari_core.network_research_runs` (
  research_id         STRING    NOT NULL,  -- connection_items.id
  row_id              STRING    NOT NULL,
  client_id           STRING,
  subject_person_id   STRING    NOT NULL,
  subject_org_id      STRING,
  colleague_ids       ARRAY<STRING>,       -- people researched alongside the subject
  buyer_ids           ARRAY<STRING>,       -- people placed in buyer seats
  buyer_org_ids       ARRAY<STRING>,       -- orgs whose buyer seats were searched
  identity_confirmed  BOOL,
  people_found        INT64,
  jobs_found          INT64,
  method              STRING    NOT NULL,
  researched_at       TIMESTAMP NOT NULL,
  recorded_at         TIMESTAMP NOT NULL
)
CLUSTER BY subject_person_id;

-- ── Who overlapped where ───────────────────────────────────────────────────
-- Same organization, same years. Worked out from years, never asked of a
-- model, with the rules of tenureOverlap in src/connections/results.ts: a
-- current seat runs to this year, a missing year means no row rather than a
-- guess. Overlap says two people were in the same building, not that they met.
CREATE OR REPLACE VIEW `togari_core.network_coworker_overlaps` AS
WITH jobs AS (
  SELECT
    e.person_id,
    e.org_id,
    e.title,
    e.start_year,
    CASE WHEN e.is_current THEN EXTRACT(YEAR FROM CURRENT_DATE()) ELSE e.end_year END AS end_year,
    e.source_url
  FROM `togari_core.network_employment` e
  JOIN `togari_core.network_people` p USING (person_id)
  WHERE NOT p.suppressed
)
SELECT
  a.person_id   AS person_a,
  b.person_id   AS person_b,
  a.org_id,
  a.title       AS person_a_title,
  b.title       AS person_b_title,
  GREATEST(a.start_year, b.start_year) AS overlap_start_year,
  LEAST(a.end_year, b.end_year)        AS overlap_end_year,
  LEAST(a.end_year, b.end_year) - GREATEST(a.start_year, b.start_year) AS overlap_years,
  IF(LEAST(a.end_year, b.end_year) > GREATEST(a.start_year, b.start_year), 'yes', 'possible')
                AS overlap,
  a.source_url  AS person_a_source_url,
  b.source_url  AS person_b_source_url
FROM jobs a
JOIN jobs b
  ON a.org_id = b.org_id
 AND a.person_id < b.person_id
WHERE a.start_year IS NOT NULL AND a.end_year IS NOT NULL
  AND b.start_year IS NOT NULL AND b.end_year IS NOT NULL
  AND LEAST(a.end_year, b.end_year) >= GREATEST(a.start_year, b.start_year);
