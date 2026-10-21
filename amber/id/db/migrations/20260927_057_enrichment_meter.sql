-- ============================================================================
-- ENRICHMENT, ONE CONTACT AT A TIME, ON A METER.
--
-- Enrichment is the only thing Amber does that costs money per contact. A sweep
-- over a 966-contact address book is 966 vendor calls, and the way that goes
-- wrong is not dramatic: a retry loop, a sync that re-enqueues, a second
-- instance running the same job, and the bill arrives at the end of the month
-- with no way to find out what it was spent on.
--
-- SO EVERY ATTEMPT IS A ROW. Not a counter -- a ledger. A counter tells you a
-- number and cannot tell you whether it is right; a ledger says which contact,
-- which provider, when, what came back, and what it cost, so "why did we spend
-- 400 credits on Tuesday" has an answer that is a query rather than a guess.
-- Counters also drift under concurrency in exactly the situation that matters,
-- which is two workers enriching at once.
--
-- THE LEDGER IS ALSO THE LOCK. A contact enriched an hour ago must not be
-- enriched again because a sweep came round, and the row recording the first
-- attempt is what says so -- there is no separate "last_enriched_at" to fall out
-- of step with the spend. One source of truth for both questions.
--
-- FAILURES ARE RECORDED TOO, with cost 0. A provider that 500s twenty times is
-- the single most important thing to be able to see, and a ledger that only
-- holds successes is blind to precisely the run that is going wrong.
--
-- LIMITS ARE PER OWNER AND FAIL CLOSED. No row means the service default
-- applies. A row with 0 means enrichment is off for that owner, which is a
-- thing somebody will want on the day a vendor bill surprises them, and it has
-- to be reachable without a deploy.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS enrichment_ledger (
  id          bigserial   PRIMARY KEY,
  owner_id    uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,

  -- The contact this was spent on. ON DELETE SET NULL rather than CASCADE: a
  -- deleted contact must not erase the record that money was spent, or the
  -- ledger stops adding up the moment somebody cleans up their address book.
  contact_id  uuid        NULL,

  provider    text        NOT NULL,

  -- 'ok' | 'empty' | 'error' | 'skipped'. 'empty' is a call that succeeded and
  -- found nothing, which still costs, and is worth telling apart from 'error'
  -- because one means try later and the other means do not.
  outcome     text        NOT NULL,

  -- What this attempt cost, in whatever unit the provider bills. Integer, so
  -- summing it is exact.
  cost_units  integer     NOT NULL DEFAULT 1 CHECK (cost_units >= 0),

  -- How many fields it actually filled. The number that says whether any of
  -- this is worth paying for.
  fields_filled integer   NOT NULL DEFAULT 0 CHECK (fields_filled >= 0),

  detail      text        NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The three questions asked of this table: what has this owner spent lately,
-- when was this contact last attempted, and what is failing.
CREATE INDEX IF NOT EXISTS enrichment_ledger_owner_time_idx
  ON enrichment_ledger (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS enrichment_ledger_contact_idx
  ON enrichment_ledger (owner_id, contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS enrichment_limits (
  owner_id      uuid        PRIMARY KEY REFERENCES users (amber_id) ON DELETE CASCADE,

  -- NULL means "use the service default". 0 means off. Both are deliberate and
  -- different, which is why this is nullable rather than defaulted here.
  daily_units   integer     NULL CHECK (daily_units IS NULL OR daily_units >= 0),
  monthly_units integer     NULL CHECK (monthly_units IS NULL OR monthly_units >= 0),

  -- Set when somebody turns enrichment off for a reason, so the next person to
  -- look does not just see a zero.
  note          text        NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMIT;
