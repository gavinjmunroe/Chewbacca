-- Chunk 4c-i follow-up: bridge iOS / medha-auth sessions (sub = 32-hex
-- person_id) to amber_id. person_id = personIdFromHandle(phone) is deterministic
-- from the phone (sha256(toE164(phone)) truncated to 32 hex), so this is an
-- additive identity bridge exactly like privy_did — no data is derived that the
-- phone didn't already determine.
--
-- Additive + idempotent. Partial unique index (person_id IS NOT NULL) so the
-- column can stay NULL until backfilled without colliding on multiple NULLs.

ALTER TABLE users ADD COLUMN IF NOT EXISTS person_id text;

CREATE UNIQUE INDEX IF NOT EXISTS users_person_id_idx
  ON users (person_id)
  WHERE person_id IS NOT NULL;
