-- DealCloud sync log
-- Audit trail of every pull/push between Togari and DealCloud. Stores the diff
-- (fields_changed) so analysts can see exactly what moved without re-reading the
-- old/new payloads.

CREATE TABLE IF NOT EXISTS `togari_core.dc_sync_log` (
  id              STRING    NOT NULL,
  tenant_id       STRING    NOT NULL,
  company_id      STRING,
  dc_id           STRING,
  direction       STRING    NOT NULL,
  fields_changed  JSON,
  sync_status     STRING    NOT NULL,
  error_message   STRING,
  synced_at       TIMESTAMP NOT NULL,
  PRIMARY KEY (id) NOT ENFORCED
)
PARTITION BY DATE(synced_at)
CLUSTER BY tenant_id, sync_status;
