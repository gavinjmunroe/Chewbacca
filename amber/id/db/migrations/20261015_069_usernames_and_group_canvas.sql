-- ============================================================================
-- A NAME TO SIGN IN WITH, AND A SHAPE FOR THE COMPANY.
--
-- TWO UNRELATED THINGS IN ONE MIGRATION, which is normally wrong and is right
-- here: both are additive columns on tables the enterprise fork already owns,
-- both ship in the same deploy, and splitting them would mean two sealed files
-- that can never be applied independently anyway.
--
-- ── USERNAMES ──────────────────────────────────────────────────────────────
--
-- Every door into this product so far has been something somebody receives: a
-- code to a phone, a link to an inbox. That is a good default and a bad only
-- option. It means signing in depends on a mail provider being configured, on
-- an iMessage reaching a device, and on the person being where that device is.
-- For a company's own staff, on their own laptops, several times a day, the
-- thing they expect is a name and a password.
--
-- The username is stored lowercase with a CHECK rather than a trigger, because
-- a case-insensitive unique index plus a case-preserving column is two sources
-- of truth about the same string and they drift. What somebody typed is not
-- worth keeping; what they typed it as is.
--
-- It is deliberately NOT a second identity in user_identities. That table is
-- for things an outside provider asserts about a person -- a Google subject, a
-- verified email. A username is a label this service issued, it proves nothing
-- on its own, and putting it beside verified subjects would invite a resolver
-- to treat it like one.
--
-- ── THE GROUP CANVAS ───────────────────────────────────────────────────────
--
-- Groups were drawn in a ring at equal angles, which says the company is a
-- wheel with equal spokes. No company is. Positions are stored now, so the
-- picture can say what somebody actually believes about how their company is
-- arranged -- which is the only reason to draw it rather than list it.
--
-- org_group_links is the other half: a real edge between two groups, with a
-- sentence on it. The sentence is the point. "Sales — Engineering" is a line
-- anybody could have guessed; "Sales — Engineering: scoping calls before a
-- quote goes out" is the thing a new hire needed and nobody wrote down.
--
-- The edge is UNDIRECTED and stored once, enforced by a CHECK that the lower
-- uuid is always in from_group_id. Storing it twice would mean deleting it
-- twice, and the first delete anybody forgets is the one that leaves a
-- half-edge nothing renders.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- USERNAMES
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username text NULL;

-- Lowercase, 3-32, letters/digits/dot/underscore/hyphen, must start with a
-- letter or digit. Narrow on purpose: a username that can contain an @ is a
-- username somebody will type into the email field.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_shape;
ALTER TABLE users ADD CONSTRAINT users_username_shape
  CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9._-]{2,31}$');

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique
  ON users (username)
  WHERE username IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN users.username IS
  'A name this service issued, for signing in. Lowercase; the CHECK is the
   only normalizer, so there is one spelling of any username and not two.';

-- ---------------------------------------------------------------------------
-- WHERE A GROUP SITS, AND WHAT CONNECTS IT TO ANOTHER
-- ---------------------------------------------------------------------------

ALTER TABLE org_groups
  ADD COLUMN IF NOT EXISTS canvas_x double precision NULL,
  ADD COLUMN IF NOT EXISTS canvas_y double precision NULL;

COMMENT ON COLUMN org_groups.canvas_x IS
  'Position on the company canvas, in canvas units relative to the centre.
   NULL means "never been moved", which is what lets the first render lay the
   group out automatically without that choice becoming permanent.';

CREATE TABLE IF NOT EXISTS org_group_links (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,

  from_group_id uuid        NOT NULL,
  to_group_id   uuid        NOT NULL,

  -- Two or three words on the line itself: "scopes deals", "shares a roadmap".
  label         text        NULL,
  -- The longer version, read when somebody opens the connection.
  description   text        NULL,

  created_by    uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- A group does not connect to itself, and an edge is stored in exactly one
  -- direction so there is exactly one row to delete.
  CONSTRAINT org_group_links_ordered CHECK (from_group_id < to_group_id),

  UNIQUE (org_id, id),
  UNIQUE (org_id, from_group_id, to_group_id)
);

ALTER TABLE org_group_links DROP CONSTRAINT IF EXISTS org_group_links_from_fk;
ALTER TABLE org_group_links ADD CONSTRAINT org_group_links_from_fk
  FOREIGN KEY (org_id, from_group_id)
  REFERENCES org_groups (org_id, id) ON DELETE CASCADE;

ALTER TABLE org_group_links DROP CONSTRAINT IF EXISTS org_group_links_to_fk;
ALTER TABLE org_group_links ADD CONSTRAINT org_group_links_to_fk
  FOREIGN KEY (org_id, to_group_id)
  REFERENCES org_groups (org_id, id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS org_group_links_by_org
  ON org_group_links (org_id);

COMMIT;
