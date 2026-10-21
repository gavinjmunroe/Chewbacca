-- The sharing engine: a privacy ledger. One row = "this item is visible to this
-- audience." Items are experiences (now), posts + interactions + media (later) —
-- NEVER notes or facts, which stay private but still feed PeopleRank.
--
-- Audience is a scope:
--   contact  scope_ref = a contact_id in the sharer's book (one-to-one)
--   circle   scope_ref = a circle_id the sharer owns
--   network  scope_ref = NULL (everyone the sharer is connected to)
-- Sharing to several circles = several 'circle' rows. Nothing here copies an
-- item; the item is only pointed at by (item_type, item_id).
--
-- Idempotent + additive. Until 2026-08-26 shares-store.js ALSO created this
-- table at request time; that lazy path has been removed and this file is now
-- the only definition.

CREATE TABLE IF NOT EXISTS shares (
  id          bigserial   PRIMARY KEY,
  owner_id    uuid        NOT NULL,
  item_type   text        NOT NULL,
  item_id     bigint      NOT NULL,
  scope_type  text        NOT NULL,
  scope_ref   bigint,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT shares_item_type_chk  CHECK (item_type IN ('experience','post','interaction')),
  CONSTRAINT shares_scope_type_chk CHECK (scope_type IN ('contact','circle','network'))
);

-- One live row per (owner, item, audience target). COALESCE folds the NULL
-- network scope_ref so a network share can't duplicate either.
CREATE UNIQUE INDEX IF NOT EXISTS shares_unique_live
  ON shares (owner_id, item_type, item_id, scope_type, COALESCE(scope_ref, 0))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS shares_scope_idx ON shares (scope_type, scope_ref)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS shares_item_idx ON shares (owner_id, item_type, item_id)
  WHERE deleted_at IS NULL;
