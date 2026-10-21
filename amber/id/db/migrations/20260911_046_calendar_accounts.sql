-- Calendar accounts, and the events they bring in.
--
-- "Allow the ability to connect multiple Google calendars, like your work
--  Google Calendar, your personal Google Calendar, etc., Outlook calendar,
--  anything."
--
-- WHY A TABLE AND NOT MORE SECRET KEYS. Google tokens have lived in the
-- per-user secrets bag under fixed names -- GCAL_OAUTH_REFRESH_TOKEN and
-- friends (src/oauth/google/callback.js). One name, one slot: connecting a
-- second Google account overwrites the first, silently, and the work calendar
-- replaces the personal one with no error anywhere. A bag of named secrets
-- cannot hold a LIST of anything, so the list needs a table.
--
-- THE EVENTS DO NOT GET A TABLE. This is the part that matters and it is easy to
-- get wrong: a `calendar_events` table would be a second, parallel store of
-- "things on your day", and every reader in this codebase -- contact-rollup,
-- interaction stats, the agenda route, PeopleRank -- already reads `events`.
-- A synced meeting with Mina has to count as an interaction with Mina exactly
-- the way a captured one does, or connecting a calendar makes the graph LESS
-- accurate by hiding half your life in a table nothing consults.
--
-- So synced events land in `events`, and this migration adds the three columns
-- that let them be told apart, re-synced and withdrawn:
--
--   source              where the row came from. NULL means capture, which is
--                       every row that exists today -- no backfill, and a
--                       reader that ignores the column behaves as it always did.
--   external_id         the provider's id for the event, so a re-sync updates
--                       the row rather than adding a second copy of Tuesday.
--   calendar_account_id which account it came from, so disconnecting one takes
--                       its events with it and leaves the others alone.
--
-- SAFE TO RE-RUN.

CREATE TABLE IF NOT EXISTS calendar_accounts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The Amber id, which is what every other owner-scoped table keys on.
  owner_id      uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  provider      text        NOT NULL CHECK (provider IN ('google', 'microsoft')),
  -- The address that identifies WHICH account, and what the UI shows so
  -- somebody can tell their work Google from their personal one.
  account_email text        NOT NULL,
  display_name  text,

  -- The grant. Tokens are per ACCOUNT here rather than per user in the secrets
  -- bag, which is the whole point of the table.
  refresh_token text,
  access_token  text,
  expires_at    timestamptz,
  scopes        text,

  -- Sync bookkeeping. `sync_token` is the provider's incremental cursor (Google
  -- calls it a syncToken, Microsoft a deltaLink): with it a refresh asks "what
  -- changed" instead of re-reading a year of calendar every time.
  sync_token    text,
  synced_at     timestamptz,
  -- The last failure, kept so a quietly-dead connection can SAY it is dead
  -- rather than looking like an empty calendar.
  last_error    text,

  connected_at  timestamptz NOT NULL DEFAULT now(),
  disabled_at   timestamptz,

  -- ONE ROW PER ACCOUNT PER PERSON. Reconnecting the same Google account is an
  -- update, not a second row -- otherwise every re-consent doubles the events.
  CONSTRAINT calendar_accounts_unique UNIQUE (owner_id, provider, account_email)
);

CREATE INDEX IF NOT EXISTS calendar_accounts_owner_idx
  ON calendar_accounts (owner_id) WHERE disabled_at IS NULL;

-- ── the three columns on events ────────────────────────────────────────────

ALTER TABLE events ADD COLUMN IF NOT EXISTS source      text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS calendar_account_id uuid
  REFERENCES calendar_accounts (id) ON DELETE CASCADE;

-- NULL is capture, so every existing row keeps working and nothing is
-- backfilled. Only the values a sync writes are constrained.
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_source_chk;
ALTER TABLE events ADD CONSTRAINT events_source_chk
  CHECK (source IS NULL OR source IN ('capture', 'google', 'microsoft'));

-- THE UPSERT KEY. A re-sync must land on the same row: without this a nightly
-- refresh adds a fresh copy of every recurring standup, forever.
--
-- Partial, because it only applies to synced rows -- captured events have no
-- external_id and there may be any number of them.
CREATE UNIQUE INDEX IF NOT EXISTS events_external_unique
  ON events (calendar_account_id, external_id)
  WHERE calendar_account_id IS NOT NULL AND external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_account_idx
  ON events (calendar_account_id) WHERE deleted_at IS NULL;
