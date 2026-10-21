-- THE DICTIONARY LEARNS WHOSE NAME IT IS.
--
-- voice_vocabulary was redesigned in migration 010 to
-- (owner_id, heard, corrected_to, hit_count) and the consumer was never checked.
-- src/lib/voice-vocab.js writes `term`, `term_key`, `heard_key`, `contact_id` and
-- `hits` -- five columns that do not exist -- and both of its writers catch the
-- error and comment it as "fail-open". So every correction a user made was
-- discarded silently, every read threw, and voice-note tagging landed on the
-- right person only when the raw transcript happened to already be right.
--
-- That is the "inconsistent tagging" Karthik has been reporting.
--
-- FOUR OF THOSE FIVE COLUMNS DO NOT NEED TO EXIST. The code carried its own
-- model; the table's is smaller and says the same things:
--
--   term       -> corrected_to    the spelling the user wants
--   term_key   -> (dropped)       a lowercased duplicate of the PK's own key
--   heard_key  -> (dropped)       same, for the other half
--   hits       -> hit_count
--
--   A BARE PREFERRED SPELLING, with no misheard form yet, is stored as
--   heard = corrected_to. So "is this an actual correction" becomes
--   `heard <> corrected_to` -- a question about the data rather than about which
--   columns happen to be null.
--
-- contact_id IS THE ONE THAT DOES. A pronunciation belongs to a person: "AJ" is
-- this contact, not a word this owner likes. Without it the dictionary is a flat
-- word list and cannot tag anybody.
--
-- NO NEW INDEX. The primary key (owner_id, heard) already serves every read this
-- table has, and the composite FK is for integrity, not for lookup.

ALTER TABLE voice_vocabulary
  ADD COLUMN IF NOT EXISTS contact_id uuid;

-- The house convention: owner-scoped composite FK, so a row can never point at
-- another owner's contact. NULL contact_id stays allowed -- plenty of vocabulary
-- is jargon rather than a person -- and MATCH SIMPLE means a NULL is not checked.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vocab_owner_contact_fk'
  ) THEN
    ALTER TABLE voice_vocabulary
      ADD CONSTRAINT vocab_owner_contact_fk FOREIGN KEY (owner_id, contact_id)
        REFERENCES contacts (owner_id, id) ON DELETE CASCADE;
  END IF;
END $$;
