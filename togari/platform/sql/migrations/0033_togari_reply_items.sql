-- 0033_togari_reply_items.sql
--
-- Step 02 of the Perplexity x Togari x Clay reply loop: the work queue every
-- inbound cold-email reply lands in.
--
-- Clay POSTs each reply to POST /replies (src/routes/replies.ts). The row is
-- created at state 'queued' and walks queued -> dispatching -> dispatched ->
-- done as Perplexity picks it up (step 06) and posts a draft back (step 04).
-- 'failed' is reachable from any of the three middle states.
--
-- Three places where the plan's Postgres shape does not exist in BigQuery, and
-- what we do instead:
--
--   * "A unique index on row_id." BigQuery has no unique constraint. Uniqueness
--     is enforced at WRITE time by the MERGE ... WHEN NOT MATCHED THEN INSERT in
--     src/replies/store.ts, which is this repo's canonical idempotent-upsert
--     path (cf. src/icp/lead-record.ts, src/dnc/service.ts). That MERGE has no
--     WHEN MATCHED branch, so a second POST of the same row_id touches nothing.
--     Nothing else may INSERT into this table directly.
--
--   * "An index covering state and updated_at." BigQuery has no secondary
--     indexes; CLUSTER BY is the equivalent. Clustering on (state, updated_at)
--     is what prunes the step 08 cron scan:
--       WHERE state = 'dispatched' AND updated_at < now() - 15min AND attempts < 3
--
--   * The five allowed values of `state` are not a CHECK constraint (BigQuery
--     has none). They are enforced by REPLY_STATES in src/replies/types.ts.
--     Keep the two in sync.
--
-- Two columns are additions to the plan's list, both deliberate:
--   id         a surrogate, opaque handle = sha256(row_id). row_id belongs to
--              Clay's namespace; this is the one we hand back on 201 and quote
--              in logs, so Togari is not exposing a vendor id as its own.
--   client_id  tenancy, matching every other table in togari_data_lake. The
--              step 04 Slack routing is per-client (serif / bma / ...), so a
--              shared queue with no tenant column cannot route. Defaults to
--              REPLIES_DEFAULT_CLIENT_ID.
--
-- Apply: bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < this_file
-- Net-new empty table; nothing existing is altered.

CREATE TABLE IF NOT EXISTS `togari_data_lake.reply_items` (
  -- ── Tracking: where this reply has got to ──────────────────────────
  id              STRING    NOT NULL,   -- surrogate handle, sha256(row_id)
  row_id          STRING    NOT NULL,   -- Clay's own row identifier; unique (enforced on write)
  client_id       STRING,               -- owning replybot client, e.g. 'serif'
  state           STRING    NOT NULL,   -- queued|dispatching|dispatched|done|failed
  pplx_thread_id  STRING,               -- Perplexity conversation id; empty until step 06(g)
  pplx_account    STRING,               -- which Perplexity login was used; empty until step 06(g)
  attempts        INT64     NOT NULL,   -- step 08 chase-ups; starts at 0
  created_at      TIMESTAMP NOT NULL,
  updated_at      TIMESTAMP NOT NULL,

  -- ── The email itself ───────────────────────────────────────────────
  campaign        STRING,               -- which email campaign it came from
  email_thread_id STRING,               -- id of the email conversation (wire name: thread_id)
  from_address    STRING,               -- who wrote the reply (wire name: from)
  sender_account  STRING,               -- which of our addresses they replied to
  subject         STRING,
  body            STRING    NOT NULL,   -- the full text of their reply
  received_at     TIMESTAMP,

  -- ── Filled in later by the AI, via the step 04 endpoint ────────────
  category        STRING,               -- positive | negative | needs_review
  confidence      FLOAT64,              -- how sure the AI was, 0 to 1
  draft           STRING,               -- the suggested reply
  reasoning       STRING                -- why the AI chose that category
)
CLUSTER BY state, updated_at;
