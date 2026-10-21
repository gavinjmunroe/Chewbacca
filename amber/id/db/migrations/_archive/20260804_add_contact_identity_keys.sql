-- Universal write-time contact dedup: the person-level identity key index.
--
-- WHY. Dedup was keyed on `(owner_id, external_id)` — the SOURCE's identifier,
-- not a person key. When a device reissues its contact identifiers (reinstall,
-- new device, iCloud re-sync) every contact re-inserted: one owner's book went
-- 2,245 → 4,162 rows across two syncs, 1,877 of the extra rows carrying a phone
-- number a row already had. `contact_identity_keys` gives every person ONE
-- claimable key per identifier, per owner, so a re-sync converges instead of
-- growing.
--
-- Idempotent. Safe to run against prod (all IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS contact_identity_keys (
  id         bigserial   PRIMARY KEY,
  owner_id   uuid        NOT NULL,
  key_type   text        NOT NULL,
  key_value  text        NOT NULL,
  contact_id bigint      NOT NULL REFERENCES contacts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_identity_keys_type_chk
    CHECK (key_type IN ('phone', 'email', 'source'))
);

-- THE load-bearing index, and it is deliberately NOT partial.
--
-- `uq_contacts_owner_external` is partial on `deleted_at IS NULL`, so once the
-- dedup sweep soft-deleted a row its external_id stopped blocking re-insertion
-- and the next sync recreated it — 35 rows the one-off cleanup removed for owner
-- 35a94acc were already back. A key here stays claimed by its contact whether
-- that contact is live or soft-deleted, so cleanup cannot be undone by a later
-- sync: the claim survives, the resolver finds it, and the write merges into the
-- surviving row instead of inserting a twin.
--
-- Corollary for anything that soft-deletes a contact: REPOINT its keys onto the
-- survivor (collapseContactGroup does this) — never leave them pointing at a
-- row no reader can see.
CREATE UNIQUE INDEX IF NOT EXISTS contact_identity_keys_uidx
  ON contact_identity_keys (owner_id, key_type, key_value);

-- Reverse lookup: every key feeding one contact (used by the collapse/repoint).
CREATE INDEX IF NOT EXISTS contact_identity_keys_contact_idx
  ON contact_identity_keys (contact_id);

-- Owner-scoped index load: one query per sync pulls the whole key set.
CREATE INDEX IF NOT EXISTS contact_identity_keys_owner_idx
  ON contact_identity_keys (owner_id);

-- Pairs the resolver deliberately REFUSED to merge, kept for a future
-- merge-suggestions UI. This table never gates a write — it is a record of
-- ambiguity, not a queue.
--
-- reason:
--   same_phone_as               two rows on one line whose names disagree
--                               ("Mom" / "Dad" on a household number)
--   same_email_as               one address, names disagree (shared mailbox)
--   same_name_no_corroboration  identical name, nothing else in common — the
--                               explicit "do not merge, do not block" case
CREATE TABLE IF NOT EXISTS contact_review_candidates (
  id                   bigserial   PRIMARY KEY,
  owner_id             uuid        NOT NULL,
  contact_id           bigint      NOT NULL REFERENCES contacts(id),
  candidate_contact_id bigint      NOT NULL REFERENCES contacts(id),
  reason               text        NOT NULL,
  detail               jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- One live row per (owner, pair, reason) so a repeated sync re-touches rather
-- than re-inserts.
CREATE UNIQUE INDEX IF NOT EXISTS contact_review_candidates_uidx
  ON contact_review_candidates (owner_id, contact_id, candidate_contact_id, reason);

CREATE INDEX IF NOT EXISTS contact_review_candidates_owner_idx
  ON contact_review_candidates (owner_id, reason);
