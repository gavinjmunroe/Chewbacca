-- 0032_togari_v1_core.sql
--
-- Togari V1 core (client-centric, flexible). The rebuilt foundation after the
-- 2026-07-13 wipe. Three net-new tables that make Togari one queryable source
-- of truth Sagar can shape by talking:
--
--   clients        - the root record: a lead / company worked through the
--                    pipeline (the "client" Sagar tracks end to end). Core
--                    columns for the common case + a JSON `attributes` bag for
--                    anything the LLM extracts that is not (yet) a defined
--                    field. Structured, typed fields Sagar adds by talking live
--                    in the existing custom_field_defs / custom_field_values
--                    registry, keyed by (entity='client', entity_id=client_id).
--
--   client_tasks   - follow-up tasks tied to a client. Seeded from Sagar's CSV
--                    (which carries current info + follow-up tasks) and asked
--                    on demand. No nightly push in V1.
--
--   client_context - ANY file or note attached to a client, stored with full
--                    text so it is searchable by asking. "Scan the email Joe
--                    sent me" lands a row here + follow-up tasks in client_tasks.
--
-- Tenancy: client_brand is the org (default 'bma'); client_id identifies the
-- individual lead/company. Matches the rest of togari_data_lake. All net-new
-- empty tables; nothing existing is altered.
--
-- Apply: bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < this_file

CREATE TABLE IF NOT EXISTS `togari_data_lake.clients` (
  client_id       STRING    NOT NULL,   -- stable slug id for the lead/company
  client_brand    STRING,               -- owning org, default 'bma'
  name            STRING    NOT NULL,    -- company or lead display name
  primary_domain  STRING,               -- for identity / dedup (LLM-assisted)
  primary_email   STRING,               -- best-known contact email
  stage           STRING,               -- pipeline stage (Sagar defines by talking)
  pipeline        STRING,               -- which pipeline, default 'default'
  owner           STRING,               -- who owns it (Sagar / Tyler)
  status          STRING,               -- active / won / lost / paused
  summary         STRING,               -- LLM one-line summary for fast recall
  attributes      JSON,                 -- flexible bag for un-typed extracted facts
  source          STRING,               -- csv / ask / gmail / fireflies / file
  created_at      TIMESTAMP NOT NULL,
  updated_at      TIMESTAMP NOT NULL
)
CLUSTER BY client_brand, client_id;

CREATE TABLE IF NOT EXISTS `togari_data_lake.client_tasks` (
  task_id         STRING    NOT NULL,
  client_id       STRING,               -- nullable: a task may not tie to a client
  client_brand    STRING,               -- owning org, default 'bma'
  description     STRING    NOT NULL,
  status          STRING,               -- open / done
  due_date        DATE,
  owner           STRING,               -- who does it (Tyler / Sagar)
  priority        STRING,               -- high / medium / low (LLM or explicit)
  source          STRING,               -- csv / ask / gmail
  created_at      TIMESTAMP NOT NULL,
  updated_at      TIMESTAMP NOT NULL,
  completed_at    TIMESTAMP
)
CLUSTER BY client_brand, status;

CREATE TABLE IF NOT EXISTS `togari_data_lake.client_context` (
  context_id      STRING    NOT NULL,
  client_id       STRING,               -- nullable: unattached context still searchable
  client_brand    STRING,               -- owning org, default 'bma'
  title           STRING,               -- short label
  content         STRING,               -- full text, searchable by asking
  content_type    STRING,               -- email / fireflies / note / file / pdf / csv_row
  source          STRING,               -- gmail / fireflies / upload / ask
  source_ref      STRING,               -- e.g. gmail message id, file name
  metadata        JSON,                 -- anything structured about the context
  occurred_at     TIMESTAMP,            -- when the underlying event happened
  created_at      TIMESTAMP NOT NULL
)
CLUSTER BY client_brand, client_id;
