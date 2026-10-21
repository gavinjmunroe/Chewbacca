-- WHAT AMBER LAST WROTE FROM A SYNC, SO A RE-SYNC CAN TELL AN APPLE CHANGE FROM
-- AN AMBER EDIT.
--
-- The two demands look contradictory and are not.
--
--   "It shouldn't override the edits you made in Amber. If I edited a contact in
--    Amber and the old stale one is in Apple, that old stale one should not
--    override the one I have in Amber."
--
--   "If I update Sagar's nickname or his notes or his birthday in Apple and then
--    hit resync, Amber should see that update and update that information."
--
-- The invariant under both is NEVER LOSE AN AMBER EDIT. Insert-only satisfied it
-- by refusing to learn anything at all, which is why a contact renamed on the
-- phone never arrived. A three-way merge satisfies it while picking up genuine
-- changes, and it needs one thing insert-only did not have: a baseline.
--
-- THE RULE, PER FIELD:
--   Amber blank                   -> take the incoming value (fill a gap)
--   Amber == what we last wrote   -> nobody edited it here, take the incoming
--   Amber != what we last wrote   -> edited here, Amber wins
--   no snapshot yet (NULL)        -> Amber wins, every field
--
-- The last line is why this needs no backfill and cannot regress anybody. Every
-- row that exists today has no snapshot, so it reads as hand-edited on every
-- field: the first sync after this ships behaves exactly like insert-only and
-- merely records a baseline. Real Apple updates start flowing on the sync after
-- that. There is no window in which an existing hand-edited name can be lost.
--
-- WHY "WHAT WE WROTE" AND NOT "WHAT APPLE SENT", which is the subtle half.
-- phones_all is stored as a UNION of the device's list and the row's, so the row
-- never equals Apple's raw list once a number has arrived from anywhere else. A
-- snapshot of Apple's payload would therefore read as an Amber edit forever, on
-- every card that has ever been enriched, permanently freezing the one column
-- people reorder most. The value WE wrote is the only thing an Amber edit can
-- honestly be compared against.
--
-- ONE FLAT OBJECT, NOT ONE PER SOURCE. Only the source-authoritative path
-- (rule 1: same source, same external id) advances it. Every other writer -- a
-- Google import, a Clay ingest, a hand edit -- leaves it alone, so their write
-- shows up as row != snapshot and Apple correctly declines to overwrite it.
--
-- Nullable, no default, no index: nothing queries it. It is read by primary key
-- along with the row and compared in JavaScript.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS sync_snapshot jsonb;

-- Apple's Nickname field had nowhere to land, and it is one of the three fields
-- named in the request ("his nickname, his notes, or his birthday"). notes and
-- birthday already have columns: apple_notes and birthday.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS nickname text;

COMMENT ON COLUMN contacts.sync_snapshot IS
  'The field values Amber last wrote from a source-authoritative sync. Compared '
  'against the live row to tell an upstream change from a local edit. NULL means '
  'no baseline, which resolves to "the local row wins".';
