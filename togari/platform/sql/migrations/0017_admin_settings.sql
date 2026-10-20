-- Admin settings
-- Per-tenant key/value store for runtime configuration: pricing tables, concurrency
-- caps, feature flags. Composite PK on (tenant_id, key) so each tenant has its own
-- isolated config.
--
-- Seeds two well-known keys for the 48North tenant:
--   - agentic_max_steps: ceiling on agent-loop iterations (Tab 3 reads this)
--   - pricing_config:    pricing for AI + external API calls in cents
--                        (shape mirrors autotier/apps/worker/src/lib/costTracking.ts)

CREATE TABLE IF NOT EXISTS `togari_core.admin_settings` (
  `key`         STRING    NOT NULL,
  tenant_id     STRING    NOT NULL,
  value         JSON      NOT NULL,
  updated_at    TIMESTAMP NOT NULL,
  PRIMARY KEY (tenant_id, `key`) NOT ENFORCED
);

-- Seed agentic_max_steps. JSON literal because the column is JSON-typed.
MERGE `togari_core.admin_settings` T
USING (
  SELECT 'agentic_max_steps' AS `key`, '48north' AS tenant_id, JSON '15' AS value
) S
ON T.`key` = S.`key` AND T.tenant_id = S.tenant_id
WHEN NOT MATCHED THEN
  INSERT (`key`, tenant_id, value, updated_at)
  VALUES (S.`key`, S.tenant_id, S.value, CURRENT_TIMESTAMP());

-- Seed pricing_config. Pricing units:
--   - AI per_1m fields are cents per 1,000,000 tokens
--   - external fields are cents per call
MERGE `togari_core.admin_settings` T
USING (
  SELECT 'pricing_config' AS `key`, '48north' AS tenant_id, JSON """
  {
    "ai": {
      "gpt-5-mini":     { "input_per_1m": 25,  "output_per_1m": 200,  "web_search_per_call": 1 },
      "gpt-5.4":        { "input_per_1m": 250, "output_per_1m": 1500 },
      "gpt-5.4-nano":   { "input_per_1m": 20,  "output_per_1m": 125,  "web_search_per_call": 2.5 },
      "gpt-4o":         { "input_per_1m": 250, "output_per_1m": 1000 },
      "gpt-4o-mini":    { "input_per_1m": 15,  "output_per_1m": 60 }
    },
    "external": {
      "google_places": 4,
      "zoominfo_search": 0,
      "zoominfo_enrich": 0,
      "enformion_business_search": 40,
      "enformion_person_search": 20,
      "enformion_contact_enrich": 8,
      "enformion_contact_id": 8,
      "enformion_property_search": 20
    }
  }
  """ AS value
) S
ON T.`key` = S.`key` AND T.tenant_id = S.tenant_id
WHEN NOT MATCHED THEN
  INSERT (`key`, tenant_id, value, updated_at)
  VALUES (S.`key`, S.tenant_id, S.value, CURRENT_TIMESTAMP());
