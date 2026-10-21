-- The learned dictionary gains a HEARD column: what Whisper produced, alongside the
-- term the user actually wants.
--
-- WHY. Today the table stores only the intended spelling, and the only thing that can
-- be done with a list of intended spellings is BIAS: feed them to Whisper's prompt and
-- hope decoding leans that way. That works often and fails silently — and when it
-- fails there is no second line of defence, because nothing records what the mistake
-- looked like. "AJ" for "Ajay" cannot be repaired after the fact if all we know is
-- that "Ajay" is a word this user likes.
--
-- Storing the pair makes the correction DETERMINISTIC. Bias still runs first and is
-- still the better mechanism, because it fixes the transcript at the source; the pair
-- is what catches the case where bias did not take.
--
-- heard_key is lower(heard), and the uniqueness moves onto (owner_id, heard_key) for
-- rows that HAVE a heard value — one misrecognition maps to exactly one intended
-- spelling, otherwise substitution would be ambiguous. Rows with no heard value are
-- the existing bias-only vocabulary and keep their (owner_id, term_key) identity.
--
-- Safe to re-run.

ALTER TABLE voice_vocabulary ADD COLUMN IF NOT EXISTS heard     text;
ALTER TABLE voice_vocabulary ADD COLUMN IF NOT EXISTS heard_key text;

-- Partial unique: only rows that actually carry a misrecognition are constrained.
-- Without WHERE, every legacy bias-only row (heard_key NULL) would collide.
CREATE UNIQUE INDEX IF NOT EXISTS voice_vocabulary_owner_heard_uidx
  ON voice_vocabulary (owner_id, heard_key)
  WHERE heard_key IS NOT NULL;

-- The substitution read path: "every heard -> term pair for this owner". Small per
-- user, but it runs on every transcription, so it should never be a seq scan.
CREATE INDEX IF NOT EXISTS voice_vocabulary_owner_heard_idx
  ON voice_vocabulary (owner_id)
  WHERE heard_key IS NOT NULL;
