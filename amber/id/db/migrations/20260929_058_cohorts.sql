-- ============================================================================
-- COHORTS: AN AUDIENCE THE ADDRESS BOOK ALREADY KNOWS ABOUT.
--
-- "My cofounder is at Stanford. He might want to share some information only
--  with people that have a stanford.edu email. All his classmates that he syncs
--  into Amber should fall under that Stanford branch."
--
-- Sharing already has three audiences: everyone you are connected to
-- (`network`), a named list you curated (`circle`), and one person (`contact`).
-- All three are things somebody has to BUILD. The Stanford audience is not --
-- it is already sitting in the address book as four hundred email addresses
-- ending in the same domain, and asking somebody to hand-add those people to a
-- circle is asking them to retype a fact the database already holds.
--
-- SO A COHORT IS DERIVED, NEVER MAINTAINED. Membership is a function of the
-- evidence on a contact, recomputed by a job. There is deliberately no "add
-- member" endpoint: the moment a cohort can be edited by hand it stops meaning
-- "everyone with a stanford.edu address" and starts meaning "whoever I
-- remembered to add", which is a circle, and circles already exist. A person
-- who leaves the cohort because their address changed is correct behavior.
--
-- WHY IT IS A TABLE AND NOT A QUERY. `shares.scope_ref` is a uuid pointing at
-- something the owner demonstrably owns, and the authorization predicate joins
-- through it. A cohort computed on the fly inside that predicate would run the
-- derivation on every feed read, and -- worse -- would let a change in the
-- derivation silently re-open things somebody shared last month to a different
-- set of people. A row makes the audience nameable, auditable, and stable
-- between refreshes.
--
-- MEMBERSHIP IS ONLY EVER THE OWNER'S OWN CONTACTS. A cohort is not a global
-- "everyone at Stanford" -- it is "the people in MY book who are at Stanford".
-- Two owners with a stanford.edu cohort have two different membership lists and
-- neither can see the other's, which falls out of every row here being scoped
-- to owner_id.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS cohorts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,

  -- What the cohort is derived FROM. Kept separate from the display name so a
  -- rename never changes who is in it.
  --   'email_domain'  every contact holding an address at this domain
  kind         text        NOT NULL CHECK (kind IN ('email_domain')),

  -- The value the kind is keyed on, lowercased: 'stanford.edu'.
  key          text        NOT NULL,

  -- What it is called on screen. Derived on first sight, editable later --
  -- renaming the Stanford cohort to "grad school" must not move anybody.
  name         text        NOT NULL,

  -- Schools and workplaces are both email domains and read completely
  -- differently in a sharing picker, so the distinction is stored rather than
  -- re-guessed at every call site.
  flavor       text        NOT NULL DEFAULT 'organization'
                           CHECK (flavor IN ('school', 'organization')),

  member_count integer     NOT NULL DEFAULT 0,
  computed_at  timestamptz NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz NULL
);

-- One cohort per (owner, kind, key). The partial index lets a deleted cohort be
-- re-derived later without colliding with its own tombstone.
CREATE UNIQUE INDEX IF NOT EXISTS cohorts_unique_live
  ON cohorts (owner_id, kind, key) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS cohorts_owner_idx ON cohorts (owner_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- MEMBERSHIP, WHICH IS OUTPUT AND NOT INPUT.
--
-- Rewritten wholesale by the refresh job. `evidence` records WHY this contact
-- is in this cohort -- the actual address that put them there -- because the
-- first question anybody asks about an automatic audience is "why is this
-- person in it", and the second is "why is this person NOT in it".
--
-- The composite FK to contacts is the one every contact-owned table here uses,
-- so a merge repoints these rows and delete-my-account cascades.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cohort_members (
  owner_id   uuid NOT NULL,
  cohort_id  uuid NOT NULL REFERENCES cohorts (id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  evidence   text NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (owner_id, cohort_id, contact_id),

  CONSTRAINT cohort_members_owner_contact_fk
    FOREIGN KEY (owner_id, contact_id)
    REFERENCES contacts (owner_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS cohort_members_contact_idx
  ON cohort_members (owner_id, contact_id);

-- ---------------------------------------------------------------------------
-- LET A SHARE POINT AT ONE.
--
-- The CHECK is replaced rather than dropped: an unconstrained scope_type would
-- accept a typo and store a share nothing can ever resolve, which fails OPEN in
-- the worst way -- the owner believes they shared something and no audience can
-- reach it, or a later reader interprets the unknown value generously.
--
-- network_visibility gets the same treatment for consistency. Nothing reads
-- that table yet; leaving the two columns with different vocabularies would
-- guarantee they disagree by the time something does.
-- ---------------------------------------------------------------------------
ALTER TABLE shares DROP CONSTRAINT IF EXISTS shares_scope_type_check;
ALTER TABLE shares ADD CONSTRAINT shares_scope_type_check
  CHECK (scope_type IN ('network', 'circle', 'contact', 'cohort'));

ALTER TABLE network_visibility DROP CONSTRAINT IF EXISTS network_visibility_scope_type_check;
ALTER TABLE network_visibility ADD CONSTRAINT network_visibility_scope_type_check
  CHECK (scope_type IN ('network', 'circle', 'contact', 'cohort'));

COMMIT;
