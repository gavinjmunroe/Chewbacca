-- THE GRAPH, AND THE TWO PERMISSION TABLES.
--
-- Traversal walks connections and ONLY connections. Your address book is not an
-- edge anyone else may hop through -- that distinction is the difference
-- between a webtree and a leak.

CREATE TABLE connections (
  a_amber_id     uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  b_amber_id     uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  status         text        NOT NULL DEFAULT 'active'
                             CHECK (status IN ('pending','active','blocked')),
  established_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (a_amber_id, b_amber_id),
  -- CANONICAL ORDERING. The smaller uuid is always 'a'. Two people tapping
  -- connect at the same instant therefore cannot create two rows -- the second
  -- insert loses to the primary key rather than to a race in application code.
  CONSTRAINT connections_order_chk CHECK (a_amber_id < b_amber_id)
);
-- Reverse traversal: the PK covers a -> b, this covers b -> a.
CREATE INDEX connections_b_idx ON connections (b_amber_id) WHERE status = 'active';

-- "THEIR NETWORK YOU CAN SEE", per circle.
-- One row = "viewers matching this scope may traverse my graph this deep."
-- Scope mirrors shares so both permission tables read the same way:
--   network  scope_ref NULL     — everyone I'm connected to
--   circle   scope_ref circle_id
--   contact  scope_ref contact_id
-- Most specific grant wins; absence of a row means depth 0, not depth 1.
CREATE TABLE network_visibility (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  scope_type text        NOT NULL CHECK (scope_type IN ('network','circle','contact')),
  scope_ref  uuid,
  max_depth  smallint    NOT NULL DEFAULT 1 CHECK (max_depth BETWEEN 0 AND 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT nv_scope_ref_chk CHECK (
    (scope_type = 'network' AND scope_ref IS NULL) OR
    (scope_type <> 'network' AND scope_ref IS NOT NULL))
);
CREATE UNIQUE INDEX nv_unique_live ON network_visibility
  (owner_id, scope_type, COALESCE(scope_ref, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE deleted_at IS NULL;
CREATE INDEX nv_scope_idx ON network_visibility (scope_type, scope_ref)
  WHERE deleted_at IS NULL;

-- "YOUR INFO THEY CAN SEE". A privacy ledger: one row = this item is visible to
-- this audience. Polymorphic on purpose -- item_id carries no FK because the
-- target table varies by item_type. That is a real trade-off (Postgres cannot
-- enforce it) and a chosen one.
CREATE TABLE shares (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  -- 'interaction' is in the list because the shares API already accepts it as an
  -- item type. It has no table yet; a share of one is owner-scoped at read time
  -- and resolves to no content until it does. Leaving it out would have made the
  -- API's own enum unwritable.
  item_type  text        NOT NULL CHECK (item_type IN ('observation','event','media','post','conversation','circle_feed','interaction')),
  item_id    uuid        NOT NULL,
  scope_type text        NOT NULL CHECK (scope_type IN ('network','circle','contact')),
  scope_ref  uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT shares_scope_ref_chk CHECK (
    (scope_type = 'network' AND scope_ref IS NULL) OR
    (scope_type <> 'network' AND scope_ref IS NOT NULL))
);
CREATE UNIQUE INDEX shares_unique_live ON shares
  (owner_id, item_type, item_id, scope_type,
   COALESCE(scope_ref, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE deleted_at IS NULL;
CREATE INDEX shares_scope_idx ON shares (scope_type, scope_ref) WHERE deleted_at IS NULL;
CREATE INDEX shares_item_idx  ON shares (owner_id, item_type, item_id) WHERE deleted_at IS NULL;
