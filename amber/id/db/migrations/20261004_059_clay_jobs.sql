-- ============================================================================
-- CLAY_JOBS, RECONSTRUCTED FROM THE LIVE SCHEMA.
--
-- THIS FILE IS NOT THE ORIGINAL. The migration recorded in schema_migrations as
--
--   20261004_059_clay_jobs.sql
--   applied 2026-10-04T08:41:11.471Z
--   checksum fd3edee4c6242778d8fe359b30650ba9ab2c91fa321d32a8d679a3a4619f2ad1
--
-- was applied to production from a checkout that no longer exists. The file is
-- not in this repository and not in any branch of its history; `git log --all`
-- for the path returns nothing. What follows was rebuilt by reading the live
-- schema (scripts/inspect-clay-jobs.mjs): columns in ordinal order with their
-- types, defaults and nullability, both CHECK constraints, the foreign key, the
-- primary key and the one secondary index. It produces the same table. Its
-- BYTES are different, so its sha256 will not be fd3ede..., and that matters:
--
--   `npm run migrate` compares the checksum of every file the ledger has
--   already applied. A file reappearing under an applied name with a different
--   checksum reads to the runner exactly like somebody editing a migration
--   after the fact, which it refuses on, as it should.
--
-- SO THIS FILE ARRIVES WITH ONE RE-STAMP, AND ONLY ONE:
--
--   railway run npm run migrate -- --allow-drift
--
-- which rewrites the ledger's checksum for this name without re-running it.
-- That flag normally discards the evidence of a real edit and is the wrong
-- answer. It is the right answer exactly once here, because the alternative is
-- worse in both directions: leave the file missing and
-- `npm run migrate -- --seal` writes a sealed line for a file that does not
-- exist, which fails src/db/migrations-immutable.test.js on every `npm test`
-- from then on; or never seal, and the whole forward-only guard stays frozen at
-- migration 058 while the schema moves on.
--
-- AFTER THE RE-STAMP, DO NOT TOUCH THIS FILE AGAIN. From that point it is an
-- applied migration like any other and the forward-only rule applies: the fix
-- for anything wrong here is a new file.
--
-- WHAT THE TABLE IS. A queue of Clay operations per owner. `id` is a uuid with
-- no default, so the caller names the job and can be idempotent about it;
-- `input` and `output` are jsonb, `output` null until the job answers; `status`
-- defaults to 'pending' and carries NO check constraint in production, so the
-- set of states is whatever the code writes. `clay_destinations` is a different
-- table with its own history and is deliberately not recreated here.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS clay_jobs (
  owner_id   uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  id         uuid        NOT NULL,
  kind       text        NOT NULL,
  input      jsonb       NOT NULL,
  output     jsonb,
  status     text        NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, id),
  CONSTRAINT clay_jobs_kind_check CHECK (kind = ANY (ARRAY['search'::text, 'enrich'::text]))
);

CREATE INDEX IF NOT EXISTS clay_jobs_created_idx ON clay_jobs (created_at);

COMMIT;
