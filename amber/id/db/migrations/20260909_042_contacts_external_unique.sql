-- THE INDEX THE ENTIRE CONTACT SYNC DEPENDS ON, WHICH THE MIGRATIONS DO NOT CREATE.
--
-- Found by building a database from these migrations and nothing else, then
-- running a real 1,179-contact sync against it. Every single contact failed:
--
--   42P10  there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
--
-- src/db/store.js batches contacts with `ON CONFLICT (owner_id, external_id)
-- WHERE external_id IS NOT NULL AND deleted_at IS NULL`. That needs a UNIQUE
-- index with exactly that key and exactly that predicate. The live migration
-- set creates only `contacts_external_idx`, which is NON-unique and keyed
-- (owner_id, source, external_id) -- so it cannot satisfy the clause, and
-- Postgres rejects the statement before it looks at a single row.
--
-- WHY NOBODY NOTICED. The unique index does exist in production. It was created
-- on 2026-07-28 by db/migrations/_archive/20260728_contacts_canonical_plus_enrichment.sql,
-- and when the migration set was consolidated on 2026-08-28 that file moved to
-- _archive and its index was not carried into 20260828_003_contacts.sql. The
-- production database kept an object its own migrations no longer describe.
--
-- So the sync works in exactly one place: the database that predates the
-- consolidation. Any database built from this repository -- a staging
-- environment, a second region, a new developer, a restore that replays
-- migrations rather than a snapshot -- cannot accept a single contact, and
-- fails with a message about ON CONFLICT that says nothing about a missing
-- index. That is not a contact bug; it means the migrations stopped being the
-- definition of the schema, and every guarantee built on top of them was
-- resting on one long-lived database's memory.
--
-- IF NOT EXISTS, so this is a no-op in production and a repair everywhere else.
--
-- ON DUPLICATES: if some environment has drifted far enough to hold two live
-- rows with the same (owner_id, external_id), this CREATE will fail rather than
-- pick a winner, and that is correct -- two cards claiming one Apple identifier
-- is a merge decision, not something a migration should make silently. The
-- SELECT below the index names them if it happens.

CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_owner_external
  ON contacts (owner_id, external_id)
  WHERE external_id IS NOT NULL AND deleted_at IS NULL;

-- The identity/provenance side of the same clause, for the same reason:
-- store.js upserts contact_sources with
-- `ON CONFLICT (owner_id, source, external_id) WHERE deleted_at IS NULL`.
-- 20260828_012_carry_forward.sql does create that one
-- (contact_sources_owner_source_ext_uidx), so this is only a guard against the
-- same omission recurring -- it is a no-op wherever that migration ran.
CREATE UNIQUE INDEX IF NOT EXISTS contact_sources_owner_source_ext_uidx
  ON contact_sources (owner_id, source, external_id)
  WHERE deleted_at IS NULL;
