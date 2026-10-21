-- AN UNDO FOR MERGES, AND A RANKING OF WHO MAY OVERWRITE WHOM.
--
-- ── WHY UNDO COMES FIRST ─────────────────────────────────────────────────────
--
-- collapseContactGroup is not a repoint. It soft-deletes the absorbed cards,
-- overwrites the survivor's scalars, DELETES duplicate rows outright in
-- observation_participants, circle_members, intro_requests and contact_favorites,
-- and drops colliding identity keys. Every one of those is unrecoverable once the
-- transaction commits.
--
-- That is why the matcher has had to be timid. A merge it gets wrong costs the
-- person data they cannot get back, so the only safe setting was "only merge when
-- certain", and every uncertain pair piled up in a queue nobody drains.
--
-- With a real undo the calculus inverts: a wrong merge costs one tap. The matcher
-- can be braver, the queue gets shorter, and the app stops asking people to
-- adjudicate pairs it could have called itself.
--
-- A FAKE UNDO IS WORSE THAN NONE. If undo restores the two cards but loses the
-- circle membership and the favorite that were deleted on the way in, the person
-- is worse off for having trusted it. So the merge snapshots every row it is about
-- to destroy or move, as jsonb, inside its own transaction. Undo replays that.
--
-- Snapshots are pruned at 30 days (scripts/prune-merge-snapshots.js). After that
-- the merge is permanent and `snapshot` is null, which is why `undoable_until`
-- is stored rather than computed: the row survives as an audit trail of what was
-- merged long after the ability to reverse it has gone.
--
-- ── WHY FIELD-LEVEL PROVENANCE ───────────────────────────────────────────────
--
-- contacts.source records who wrote the row LAST, which cannot answer the only
-- question that matters when two sources disagree: who wrote THIS field. Without
-- that, a Clay run that touches one contact takes ownership of every field on it,
-- including the job title the person fixed by hand last week.
--
-- field_sources is a flat {column: source_label} map, written beside the value it
-- describes. Cheap, no join, and it degrades honestly: a field with no entry is
-- unknown provenance and is therefore treated as untouchable by a low-tier writer,
-- which is the safe direction to be wrong in.
--
-- source_tier mirrors src/lib/source-trust.js. The mapping is repeated here
-- because a migration must be static, and src/db/source-trust-parity.test.js fails
-- if the two ever disagree.

BEGIN;

-- ── 1. The merge log ─────────────────────────────────────────────────────────

CREATE TABLE contact_merges (
  id                 bigserial   PRIMARY KEY,
  owner_id           uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  survivor_id        uuid        NOT NULL,
  absorbed_ids       uuid[]      NOT NULL,
  -- 'auto' (the resolver merged on its own), 'user' (someone confirmed a pair),
  -- 'backfill' (a script). Kept so we can measure how often each is undone --
  -- a rising undo rate on 'auto' is the matcher telling us it got greedy.
  origin             text        NOT NULL DEFAULT 'auto',
  rule               text,
  -- Everything needed to put the world back. Null once pruned.
  snapshot           jsonb,
  merged_at          timestamptz NOT NULL DEFAULT now(),
  undoable_until     timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  undone_at          timestamptz,
  CONSTRAINT contact_merges_origin_chk
    CHECK (origin IN ('auto', 'user', 'backfill', 'import'))
);

-- The undo surface: this owner's reversible merges, newest first.
CREATE INDEX contact_merges_undoable_idx
  ON contact_merges (owner_id, merged_at DESC)
  WHERE undone_at IS NULL AND snapshot IS NOT NULL;

-- "Which merge produced this card?" -- the lookup the undo button makes.
CREATE INDEX contact_merges_survivor_idx
  ON contact_merges (owner_id, survivor_id)
  WHERE undone_at IS NULL;

-- The pruner's scan.
CREATE INDEX contact_merges_prune_idx
  ON contact_merges (undoable_until)
  WHERE snapshot IS NOT NULL;

-- ── 2. Provenance on the contact ─────────────────────────────────────────────

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS field_sources jsonb,
  ADD COLUMN IF NOT EXISTS source_tier   smallint;

COMMENT ON COLUMN contacts.field_sources IS
  'Flat {column: source_label} map recording who last wrote each field. Absent key = unknown provenance = not overwritable by a low-tier writer.';
COMMENT ON COLUMN contacts.source_tier IS
  'Tier of contacts.source per src/lib/source-trust.js. 3 owner-stated, 2 owner-synced, 1 amber-derived, 0 vendor/unknown.';

-- ── 3. Backfill the tier from the labels already in the table ────────────────
--
-- The prefix match mirrors normalizeSource(): `slack-thread-2026-05-26` is slack,
-- not an unknown source. Anything unlisted lands at 0, which means it can fill
-- blanks and can never clobber -- correct for a label nobody has classified.

UPDATE contacts SET source_tier =
  CASE
    WHEN source IS NULL THEN 0
    WHEN lower(source) IN (
      'manual','amber_manual','user','app_voice','app_web_save','app_favorite',
      'contact_note','amber_note','soundboard','voice','imessage_addcontact'
    ) THEN 3
    WHEN lower(source) IN (
      'apple','google','carddav','linkedin','github','twitter','slack',
      'imessage','imessage_dm','imessage_dq','vcard'
    ) OR lower(source) LIKE 'slack-%' OR lower(source) LIKE 'google-%'
      THEN 2
    WHEN lower(source) IN (
      'parsed','reminders_parse','web_search','web_profile_fill',
      'peoplerank_enrich','otp-auto-provision','firestore_fallback','amber'
    ) THEN 1
    ELSE 0
  END
WHERE source_tier IS NULL;

ALTER TABLE contacts ALTER COLUMN source_tier SET DEFAULT 0;

-- Contacts whose whole row came from one source have that provenance for every
-- field, and saying so is what protects an Apple or hand-entered card from the
-- first enrichment run. Rows already touched by several writers are left null:
-- unknown provenance is honest, and it fails closed.
UPDATE contacts
   SET field_sources = jsonb_build_object(
         'full_name', source, 'first_name', source, 'last_name', source,
         'company',   source, 'title',      source, 'city',      source,
         'location',  source, 'phone_primary', source, 'emails',  source)
 WHERE field_sources IS NULL
   AND source IS NOT NULL
   AND source_tier >= 2;

CREATE INDEX contacts_owner_tier_idx ON contacts (owner_id, source_tier)
  WHERE deleted_at IS NULL;

COMMIT;
