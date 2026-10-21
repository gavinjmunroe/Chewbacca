-- ---------------------------------------------------------------------------
-- WHICH CONNECTED ACCOUNT A ROW CAME FROM.
--
-- WHY THIS IS MISSING AND WHY IT MATTERS NOW. A ledger row has always known
-- the SOURCE ("calendar") and the MEMBER whose connection produced it. That
-- was enough while one person had one calendar. It stopped being enough the
-- moment somebody connected a work Google and a personal Google: two rows
-- that look identical, and no way for the product to answer the first
-- question anybody asks about a duplicate -- which calendar is this one from.
--
-- And in a shared room it is the second question too: whose calendar. The
-- member is already on the row; this adds the address, so a meeting can say
-- "from karthik@bluemodernadvisory.com" rather than "from a calendar".
--
-- NULLABLE AND NEVER BACKFILLED WITH A GUESS. Rows written before this exist
-- and genuinely do not know, which is a different thing from being from
-- nowhere. The screen says the member's name and leaves the account out
-- rather than inventing one.
--
-- SAFE TO RE-RUN.
-- ---------------------------------------------------------------------------

ALTER TABLE org_interactions
  ADD COLUMN IF NOT EXISTS source_account text;

COMMENT ON COLUMN org_interactions.source_account IS
  'The connected account this row came from -- a calendar or mailbox address.
   Null on rows written before the column existed, and on anything typed by a
   person rather than produced by a connection.';
