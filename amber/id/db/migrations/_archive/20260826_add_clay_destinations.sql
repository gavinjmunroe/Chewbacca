-- clay_destinations — one Clay webhook per Amber user, the target that
-- clay-webhook.js POSTs enriched rows to.
--
-- Previously created only by the lazy ensureTable() in clay-destinations-store.js.
-- Transcribed here verbatim so the schema is version-controlled and a fresh
-- database can be built without booting the app.
--
-- webhook_url IS A SECRET. Clay's webhook URLs end in a long opaque id and that id
-- is the entire credential — anyone holding it can write into the user's Clay
-- table. It is masked for display by maskWebhookUrl() and must never be logged.

CREATE TABLE IF NOT EXISTS clay_destinations (
  owner_id        uuid        NOT NULL PRIMARY KEY,
  webhook_url     text        NOT NULL,
  label           text,
  -- 'object' — one flat row per POST, Clay's documented webhook contract.
  -- 'array'  — a batch per POST, which some Clay sources accept.
  mode            text        NOT NULL DEFAULT 'object',
  -- Clay's optional "Add auth token" on a webhook source. Null when unused.
  auth_token      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_push_at    timestamptz,
  last_push_count integer     NOT NULL DEFAULT 0,
  CONSTRAINT clay_destinations_mode_chk CHECK (mode IN ('object','array'))
);

-- Additive, for any database created before these two columns existed. The
-- CREATE above is a no-op against an existing table, so a column added later has
-- to be stated explicitly or it silently never appears.
ALTER TABLE clay_destinations ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'object';
ALTER TABLE clay_destinations ADD COLUMN IF NOT EXISTS auth_token text;
