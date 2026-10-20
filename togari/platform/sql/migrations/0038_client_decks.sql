-- One deck link per client company, so a deck-request card sends it in one
-- press. Latest row per (client_id, company_key) wins. src/replies/decks.ts.
CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.client_decks` (
  client_id STRING NOT NULL,
  company STRING NOT NULL,
  company_key STRING NOT NULL,
  url STRING NOT NULL,
  added_by STRING,
  added_at TIMESTAMP NOT NULL
);
