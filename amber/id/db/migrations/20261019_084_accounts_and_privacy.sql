-- ---------------------------------------------------------------------------
-- 084 — ACCOUNTS ABOVE PEOPLE, AND THE LINE BETWEEN WHAT THE COMPANY KNOWS
--       AND WHAT A PERSON KNOWS.
--
-- Two changes that both have to land before any real data exists, because
-- both are nearly impossible to retrofit once a ledger has rows in it.
--
--
-- 1. A RELATIONSHIP IS OFTEN WITH A FIRM, NOT A PERSON.
--
-- 083 modeled people and nothing above them, which is right for a prospect
-- and wrong for the motion this is actually for. A payroll company's warm
-- pipeline runs through accounting firms: a managing partner, two partners,
-- an office manager, and whoever actually calls support. Four people, one
-- relationship. People churn inside the firm while the relationship persists,
-- which is precisely backwards from a model where the person is the top-level
-- object.
--
-- So: org_accounts sits above org_people. Interactions still attach to a
-- PERSON, because that is who was actually in the room, and roll up to the
-- account by join. Nothing attaches to an account directly, which keeps one
-- source of truth and makes "what is our relationship with this firm" a sum
-- rather than a second ledger to keep in step with the first.
--
--
-- 2. THE COMPANY SEES THAT A RELATIONSHIP EXISTS. IT DOES NOT SEE WHAT WAS SAID.
--
-- THIS IS THE ADOPTION DECISION, NOT A COMPLIANCE CHECKBOX. A rep whose
-- calendar reveals every conversation they have to the whole company does not
-- connect their calendar. They will not say so; they will simply never finish
-- onboarding, and the graph will be empty for reasons nobody can diagnose.
--
-- The split that makes it safe to connect:
--
--   org_person_edges  — company-visible. That a relationship exists, how many
--                       touches, how recent, how strong. This is what answers
--                       "who here knows this firm", which is the whole reason
--                       an enterprise wants this and a thing no CRM can do.
--
--   org_interactions  — private by default. The transcript, the summary, the
--                       artifact. Visible to the member it belongs to, and to
--                       anyone they deliberately share it with.
--
-- The aggregate is public; the content is not. That is the only configuration
-- where both the rep and the company get what they need, and it is why the
-- column below defaults to 'private' rather than being a setting somebody has
-- to find.
--
-- ENFORCEMENT LIVES IN THE QUERY LAYER, NOT IN A POLICY, and that is
-- deliberate. RLS is the right tool for tenant isolation: one rule, no
-- exceptions, fails closed. This rule has exceptions BY DESIGN — the whole
-- point is that edges roll up while content stays private — and a policy with
-- designed exceptions is one that every aggregate query has to fight. That
-- fight is how a codebase ends up with SECURITY DEFINER escape hatches, and
-- those are how the boundary actually gets lost. So: one shared clause in the
-- store, applied by every read, with a structural test that fails if a query
-- is added that skips it.
--
-- amber_current_member() is added here anyway, unused by any policy today,
-- because retrofitting a security context onto a live boundary later is worse
-- than carrying an unused function now.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- WHO, as opposed to WHICH COMPANY.
--
-- Same shape and same failure mode as amber_current_org: `true` means an
-- unset context returns NULL rather than erroring, so a predicate built on it
-- denies rather than crashes.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION amber_current_member() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('amber.amber_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION amber_current_member() IS
  'The member this transaction is acting as, set by the application as a
   transaction-local setting. NULL when unset. Not referenced by any policy
   today; present so that member-scoped policies do not require touching the
   tenant boundary later.';

-- ---------------------------------------------------------------------------
-- ACCOUNTS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS org_accounts (
  org_id     uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),

  name       text        NOT NULL,

  -- The email domain, when there is one. This is the join key that lets a
  -- calendar invite from someone@henderson-cpa.com land on the Henderson CPA
  -- account without anyone filing it there, which is the difference between
  -- an account model that populates itself and one that is data entry.
  domain     text        NULL,

  kind       text        NOT NULL DEFAULT 'other',

  -- Who owns the relationship with this firm. Nullable: a firm discovered from
  -- a calendar backfill has no owner until somebody claims it.
  owner_id   uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,

  note       text        NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,

  CONSTRAINT org_accounts_pkey PRIMARY KEY (org_id, id),

  CONSTRAINT org_accounts_kind_check
    CHECK (kind IN ('firm', 'prospect', 'client', 'partner', 'vendor', 'other')),

  CONSTRAINT org_accounts_name_check
    CHECK (btrim(name) <> ''),

  -- Lowercased at the application boundary, asserted here. Same reasoning as
  -- org_person_identities: a case-folded duplicate is a duplicate nobody can
  -- see, and the cheapest place to make that impossible is the column.
  CONSTRAINT org_accounts_domain_check
    CHECK (domain IS NULL OR (btrim(domain) <> '' AND domain = lower(domain)))
);

-- One account per domain per company. Partial on deleted_at so a deleted
-- account does not permanently reserve its own domain.
CREATE UNIQUE INDEX IF NOT EXISTS org_accounts_domain_idx
  ON org_accounts (org_id, domain)
  WHERE domain IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS org_accounts_name_idx
  ON org_accounts (org_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS org_accounts_owner_idx
  ON org_accounts (org_id, owner_id)
  WHERE owner_id IS NOT NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- PEOPLE HANG UNDER ACCOUNTS
--
-- Nullable, and it stays nullable. Plenty of real contacts have no firm: a
-- freelancer, somebody on a personal address, a referral whose employer is
-- unknown. Forcing every person into an account would mean inventing accounts
-- to satisfy the schema, and an invented account is worse than none.
-- ---------------------------------------------------------------------------

ALTER TABLE org_people ADD COLUMN IF NOT EXISTS account_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_people_account_fk'
  ) THEN
    ALTER TABLE org_people
      ADD CONSTRAINT org_people_account_fk
      FOREIGN KEY (org_id, account_id)
      REFERENCES org_accounts (org_id, id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS org_people_account_idx
  ON org_people (org_id, account_id)
  WHERE account_id IS NOT NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- VISIBILITY
--
-- The two defaults point in opposite directions and both are deliberate.
--
-- A PERSON defaults to 'org'. That a business contact exists is company
-- knowledge: it is the thing being bought. The producer marks a person
-- 'private' when the identity that found them is a personal address rather
-- than a work one, which keeps a rep's dentist out of the company directory
-- without asking anybody to classify their own contacts.
--
-- AN INTERACTION defaults to 'private'. What was said belongs to the person
-- who said it until they decide otherwise. A default of 'org' here would be a
-- setting people discover after the fact, which is not consent.
-- ---------------------------------------------------------------------------

ALTER TABLE org_people
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'org';

ALTER TABLE org_interactions
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_people_visibility_check'
  ) THEN
    ALTER TABLE org_people
      ADD CONSTRAINT org_people_visibility_check
      CHECK (visibility IN ('org', 'private'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_interactions_visibility_check'
  ) THEN
    ALTER TABLE org_interactions
      ADD CONSTRAINT org_interactions_visibility_check
      CHECK (visibility IN ('org', 'private'));
  END IF;
END $$;

-- The read path is "my own interactions, plus whatever is company-wide",
-- which is this index exactly.
CREATE INDEX IF NOT EXISTS org_interactions_visible_idx
  ON org_interactions (org_id, person_id, visibility, member_id);

-- ---------------------------------------------------------------------------
-- The new table joins the tenant policy. Same linchpin, same policy name,
-- same failure mode as every other org table.
-- ---------------------------------------------------------------------------

ALTER TABLE org_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS amber_tenant ON org_accounts;
CREATE POLICY amber_tenant ON org_accounts
  USING (amber_current_org() IS NOT NULL AND org_id = amber_current_org())
  WITH CHECK (amber_current_org() IS NOT NULL AND org_id = amber_current_org());
