-- Contacts
-- Per-company people records discovered via enrichment runs, Clay imports, or DC sync.
-- `dc_contact_id` is the DealCloud contact entry id when present.
-- `is_primary` + `primary_score` + `primary_reason` capture the agent's primary-contact
-- pick (UX surfaces this with an override dropdown).
--
-- Dedup is enforced at the app layer: prefer email match, fall back to linkedin_url,
-- else insert.

CREATE TABLE IF NOT EXISTS `togari_core.contacts` (
  id                  STRING    NOT NULL,
  tenant_id           STRING    NOT NULL,
  company_id          STRING    NOT NULL,
  enrichment_run_id   STRING,
  source              STRING,
  full_name           STRING,
  first_name          STRING,
  last_name           STRING,
  title               STRING,
  email               STRING,
  email_verified      BOOL,
  mobile_phone        STRING,
  business_phone      STRING,
  linkedin_url        STRING,
  dc_contact_id       STRING,
  contact_info        JSON,
  is_primary          BOOL,
  primary_score       INT64,
  primary_reason      STRING,
  created_at          TIMESTAMP NOT NULL,
  updated_at          TIMESTAMP NOT NULL,
  PRIMARY KEY (id) NOT ENFORCED
)
CLUSTER BY tenant_id, company_id, email;
