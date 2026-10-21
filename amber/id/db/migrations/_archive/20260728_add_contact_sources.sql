-- Canonical-contact provenance: one row per (source, external_id) pointing at
-- the single canonical `contacts` row that person collapsed into. `contacts`
-- stays the one user-facing/searchable contact; contact_sources records which
-- upstream sources (apple / google / linkedin…) fed it, so re-imports are
-- idempotent and cross-source dedup has an audit trail. Idempotent migration.
--
-- owner_id is text (the amber_id uuid stored as text, matching wall_posts /
-- question_threads); contact_id FKs the contacts PK (id bigint).

CREATE TABLE IF NOT EXISTS contact_sources (
  id            bigserial   PRIMARY KEY,
  owner_id      text        NOT NULL,
  contact_id    bigint      NOT NULL REFERENCES contacts(id),
  source        text        NOT NULL,   -- 'apple' | 'google' | ...
  external_id   text        NOT NULL,   -- source's stable id (resourceName / apple id)
  raw_full_name text,
  raw_emails    text,
  raw_phones    text,
  raw_company   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

-- One live provenance row per (owner, source, external_id) — the idempotency
-- key for re-imports. Partial (deleted_at IS NULL) so a soft-deleted row does
-- not block re-creation. ON CONFLICT targets must carry this same predicate.
CREATE UNIQUE INDEX IF NOT EXISTS contact_sources_owner_source_ext_uidx
  ON contact_sources (owner_id, source, external_id)
  WHERE deleted_at IS NULL;

-- Reverse lookup: all sources feeding a canonical contact.
CREATE INDEX IF NOT EXISTS contact_sources_contact_idx
  ON contact_sources (contact_id)
  WHERE deleted_at IS NULL;

-- Dedup-lookup support. contacts already has the indexes mergeContact relies on:
--   idx_contacts_owner_id / contacts_owner_active_idx  → owner scoping
--   contacts_owner_phone_norm_idx (owner_id, phone_primary_normalized)
--                                                      → deterministic phone match (primary)
-- Secondary-phone (phones_all) and email matching run inside a single owner's
-- contact set (already narrow) via regexp_replace / string_to_array, so no new
-- index is required. If a tenant ever has a very large address book and these
-- become hot, add a GIN trigram index on contacts.phones_all / contacts.emails
-- — deferred as optional until profiling shows a need.
