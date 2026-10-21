-- A BLOCK THAT A NEW ACCOUNT UNDOES IS NOT A BLOCK.
--
-- dm_blocks keys on amber_id, so blocking somebody blocked that ROW. Delete the
-- account and sign up again on the same phone and you get a fresh amber_id and a
-- clean slate: the person who blocked you has no idea, and nothing anywhere
-- records that they ever did. For an app whose whole content is who somebody
-- knows and what they said about them, that is the wrong side to be wrong on.
--
-- So a block now also records the handles the blocked account had proven:
-- their phone, and any email they verified through Apple or Google.
--
-- HASHES, NOT ADDRESSES, and the hashing is not new. discovery_keys already
-- stores HMAC(IDENTITY_KEY_PEPPER, value) truncated to 16 bytes for exactly this
-- kind of question, with a length CHECK in the database and the reasoning
-- written out in lib/identity-keys.js. Copying that shape means blocking never
-- has to see a plaintext phone number: setBlock copies the hashes straight
-- across from discovery_keys, and matching is a join on two columns.
--
-- It also means this table is worth no more to a stolen backup than
-- discovery_keys already is, and the pepper is not in either of them.
--
-- ── THE TWO FOREIGN KEYS POINT DIFFERENT WAYS, ON PURPOSE ────────────────────
--
--   blocker_amber_id  ON DELETE CASCADE   your blocks die with your account
--   source_amber_id   ON DELETE SET NULL  their block SURVIVES theirs
--
-- The second one IS the feature. A cascade there would delete the block the
-- moment the blocked person deleted their account, which is precisely the
-- evasion this table exists to close, and it would do it silently.

CREATE TABLE IF NOT EXISTS blocked_handles (
  blocker_amber_id uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  -- 1 phone, 2 email. Matches KEY_TYPE in lib/identity-keys.js and the CHECK on
  -- discovery_keys, because these two tables are joined on exactly these columns
  -- and a third kind here could never match anything.
  key_type         smallint    NOT NULL CHECK (key_type IN (1, 2)),
  key_hash         bytea       NOT NULL,
  /**
   * Who the handle was copied from, so unblocking removes exactly what blocking
   * added. Without it, unblock would have to re-read the other account's CURRENT
   * handles -- and a person who changed their number while blocked would leave a
   * row behind that nothing could ever clear.
   *
   * Nullable, and it goes null rather than taking the row with it when that
   * account is deleted. See the header.
   */
  source_amber_id  uuid        REFERENCES users (amber_id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_amber_id, key_type, key_hash),
  CONSTRAINT blocked_handles_len_chk CHECK (octet_length(key_hash) = 16)
);

-- The lookup that matters is "does any handle this person blocked belong to that
-- account", which joins discovery_keys on (key_type, key_hash). Without this the
-- join scans every block in the table on every connection request.
CREATE INDEX IF NOT EXISTS blocked_handles_hash_idx
  ON blocked_handles (key_type, key_hash);

-- And "everything this person blocked", for the notification fan-out, which is
-- already served by the primary key's leading column.

COMMENT ON TABLE blocked_handles IS
  'Handles (hashed phone / verified email) a user has blocked, so a block survives the blocked account being deleted and recreated. Joined to discovery_keys on (key_type, key_hash).';
