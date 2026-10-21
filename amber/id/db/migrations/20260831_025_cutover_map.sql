-- THE TWO TABLES THE CUTOVER NEEDS, AND WHY THEY OUTLIVE IT.
--
-- Moving the pre-rebuild database into this schema is not a copy. contacts.id was
-- a bigserial and is now a uuid, and ELEVEN columns across TEN tables carry that
-- id. Every one of them has to land on the SAME new uuid for the same old row, or
-- the graph tears quietly: a favourite pointing at nobody, an identity key
-- attached to the wrong person, an observation about the wrong human.
--
-- WHY A MAP TABLE AND NOT A DERIVED uuid. The alternative is uuidv5 of a constant
-- namespace: no table, no join, and it converges exactly on a re-run. It was
-- rejected deliberately. The namespace would live in this file, so anyone with
-- the repo could compute every contact id in the system, permanently. Ids are not
-- authorization here -- every route scopes by owner_id -- but predictable ids
-- throw away the defence in depth random ones give, and they can never be taken
-- back once they are the ids.
--
-- So: a random uuid per row, written down. The map is also the only way to answer
-- "which old row did this come from" when something looks wrong a week after the
-- cutover, which is why it is KEPT rather than dropped once the migration
-- verifies. It costs one table and a join in each of the eleven statements.
--
-- IT IS ALSO WHAT MAKES THE CUTOVER RESUMABLE. Every phase asks the map what it
-- has already moved and skips it. A migration you cannot re-run after it dies
-- half way is a migration you only get one attempt at.
--
-- A FRESH INSTALL LEAVES BOTH EMPTY, which is correct. They describe an event
-- that happened to one database; a new one has no history to record.

CREATE TABLE IF NOT EXISTS cutover_map (
  -- The old table the row came from. Text rather than an enum: this records
  -- history, and history should not need a migration to describe a table that no
  -- longer exists.
  source_table text   NOT NULL,
  old_id       bigint NOT NULL,
  new_id       uuid   NOT NULL,
  migrated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_table, old_id)
);

-- The reverse lookup: given a new row, what was it? Not unique -- several old
-- rows can legitimately collapse onto one new one.
CREATE INDEX IF NOT EXISTS cutover_map_new_idx ON cutover_map (source_table, new_id);

COMMENT ON TABLE cutover_map IS
  'Old bigserial id -> new uuid, per source table. Written by scripts/cutover.js. '
  'Kept after the cutover: it is the only trace back to the pre-rebuild row.';

-- EVERY ROW THE CUTOVER DID NOT MOVE, AND WHY.
--
-- The new schema has foreign keys the old one did not, so some rows cannot cross:
-- a contact whose owner has no users row, a favourite pointing at a contact that
-- was deleted years ago, a fact whose value will not fit a CHECK. The choice was
-- to skip those and record every one rather than abort the whole cutover on the
-- first surprise -- so the migration completes, and nothing disappears without a
-- row here naming it.
--
-- READ THIS TABLE AFTER THE CUTOVER. An empty result means everything crossed. A
-- non-empty one is a work list, not a warning to dismiss.
CREATE TABLE IF NOT EXISTS cutover_review (
  id           bigserial PRIMARY KEY,
  source_table text   NOT NULL,
  old_id       bigint,
  reason       text   NOT NULL,
  -- NO USER CONTENT. detail holds ids, counts and column names -- never a phone
  -- number, an email address, or the body of somebody's note. A review table is
  -- read by whoever is debugging, which is a wider audience than the data.
  detail       jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cutover_review_table_idx ON cutover_review (source_table, reason);

COMMENT ON TABLE cutover_review IS
  'Rows the cutover deliberately did not migrate, with the reason. Holds no user '
  'content -- ids, counts and column names only.';
