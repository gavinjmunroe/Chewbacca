-- 0037_connection_items.sql
--
-- The work queue for warm-intro connection research (POST /connections).
--
-- Clay posts one person per row: a contact at a client's existing customer.
-- Perplexity Computer, on the client's own seat, reads the client's published
-- connection guide and target account sheet, works out where that person and
-- their senior colleagues used to work, and posts the histories back to
-- POST /connections/result. Togari re-checks every employer against the target
-- sheet itself and hands each connection on to a Clay table.
--
-- Same state machine as reply_items (0033), so the same dispatcher and sweeper
-- drive it: queued -> dispatching -> dispatched -> done, with 'failed'
-- reachable from the three middle states. The notes in 0033 about row_id
-- uniqueness (enforced by the MERGE in src/connections/store.ts) and CLUSTER BY
-- standing in for an index apply here unchanged.
--
-- A separate table rather than a `kind` column on reply_items, deliberately:
-- every reply path (autopilot, delete-after-send, the requeue script, the Slack
-- card) reads reply_items, and none of them should ever meet a row that is not
-- an email.
--
-- result_json keeps everything Perplexity reported, including employers that
-- matched nothing. Today's non-match is tomorrow's match when the target list
-- grows, and re-matching a stored history is free where re-researching it is
-- not.
--
-- Apply: bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < this_file
-- Net-new empty table; nothing existing is altered.

CREATE TABLE IF NOT EXISTS `togari_data_lake.connection_items` (
  -- ── Tracking, identical in meaning to reply_items ──────────────────
  id              STRING    NOT NULL,   -- surrogate handle, sha256(row_id)
  row_id          STRING    NOT NULL,   -- Clay's row identifier; unique (enforced on write)
  client_id       STRING,               -- owning client, e.g. 'serif'
  state           STRING    NOT NULL,   -- queued|dispatching|dispatched|done|failed
  pplx_thread_id  STRING,
  pplx_account    STRING,
  attempts        INT64     NOT NULL,
  created_at      TIMESTAMP NOT NULL,
  updated_at      TIMESTAMP NOT NULL,

  -- ── The person to research, as Clay sent them ──────────────────────
  person_name           STRING NOT NULL,
  person_title          STRING,
  person_company        STRING NOT NULL,  -- the customer they work at now
  person_company_domain STRING,
  person_linkedin       STRING,
  person_location       STRING,
  work_history          STRING,           -- whatever enrichment already found, free text

  -- ── Filled in by POST /connections/result ──────────────────────────
  identity_confirmed    BOOL,
  target_rows_read      INT64,   -- how much of the sheet Perplexity says it read
  target_rows_expected  INT64,   -- how many rows the sheet had when Togari checked
  connections_found     INT64,
  connections_json      STRING,  -- the connections Togari kept, as sent to Clay
  result_json           STRING,  -- Perplexity's whole answer, every employer
  clay_posted           INT64    -- rows Clay accepted
)
CLUSTER BY state, updated_at;
