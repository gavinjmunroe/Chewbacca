-- Actions the client assistant proposed, waiting for a tap on Do it.
-- src/agents/client-assistant/index.ts.
CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.assistant_pending` (
  id STRING NOT NULL,
  client_id STRING NOT NULL,
  tool STRING NOT NULL,
  input STRING,
  proposed_by STRING,
  created_at TIMESTAMP NOT NULL,
  status STRING NOT NULL,
  decided_by STRING,
  decided_at TIMESTAMP
);
