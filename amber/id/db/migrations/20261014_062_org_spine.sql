-- ============================================================================
-- THE ORG SPINE. An account belongs to a company, or it does not.
--
-- Everything in this schema up to now has had exactly one owner: a person, a
-- phone number, an amber_id, and a wall of composite foreign keys pointing at
-- (owner_id, id) so that one person's rows can never be reached through another
-- person's. That is the consumer product and none of it changes here.
--
-- AN ORGANIZATION IS A SEPARATE INSTANCE, NOT A LABEL ON AN EXISTING ONE.
-- When somebody enrols their company, the account they are using inside that
-- company is an account OF that company: what they say in it, the contacts they
-- sync into it, the notes they share through it are the organization's data and
-- live under the organization. When the same human uses Amber for themselves,
-- that is a different account with a different amber_id, and nothing crosses
-- between them. Two instances, one human, no join.
--
-- That is why org_members carries a UNIQUE index on amber_id and not a plain
-- membership row: an amber_id is in at most one organization, for its whole
-- life. "I want to be in two companies" is two accounts, exactly like "I want a
-- personal Amber and a work Amber" is two accounts. The alternative -- one
-- account in several orgs -- would mean every read in the service has to ask
-- WHICH org it is acting in, forever, including the ~90 routes written before
-- organizations existed, and the first one that forgets to ask leaks a customer
-- list between two companies.
--
-- WHAT THIS MIGRATION DOES NOT DO. It does not touch `shares`, `viewer-reach`
-- or any read path. An organization with members, groups and a policy still
-- shares exactly the way an individual does until the next migration widens the
-- scope vocabulary. This file is the spine: who exists, who is in it, who runs
-- it, and what the ceiling is. Nothing reads the ceiling yet, deliberately --
-- landing the table and the enforcement in one change would mean a policy bug
-- and a schema bug arriving together with no way to tell them apart.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- THE ORGANIZATION.
--
-- `slug` is what appears in a URL and in an invite link, so it is immutable in
-- practice even though nothing here forbids an update: renaming it breaks every
-- link already sent. Lowercased and uniquely indexed.
--
-- `email_domain` is the domain the company's people have addresses at. It is
-- NOT an authorization boundary on its own -- an invite is what lets somebody
-- in, never a matching address -- but it is what the admin console checks an
-- invited address against before sending, so a typo'd personal address is
-- caught by a human instead of becoming a member.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL,
  slug         text        NOT NULL,
  email_domain text        NULL,

  -- The account that enrolled the company. Kept for provenance; it confers no
  -- standing on its own. Authority is org_members.role and nothing else, so
  -- removing the founder's admin role actually removes their admin.
  created_by   uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,

  status       text        NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'suspended')),

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_live
  ON organizations (lower(slug)) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- MEMBERSHIP, WHICH IS ALSO THE ANSWER TO "AM I AN ENTERPRISE ACCOUNT".
--
-- There are two roles and there is no third. `admin` sets the policy ceiling,
-- invites, removes, and creates groups; `member` does everything else. A
-- finer-grained role model is a thing to add when somebody asks for it by
-- name -- inventing one now means guessing at a company's org chart and
-- shipping four roles that all mean "member".
--
-- `status` is separate from `deleted_at` on purpose. A suspended member still
-- exists, still owns their rows, and can be restored; a deleted one is gone
-- from the roster. Suspension is what an admin reaches for when somebody is on
-- leave or under investigation, and losing the distinction would make the only
-- available action destructive.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_members (
  org_id     uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  amber_id   uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,

  role       text        NOT NULL DEFAULT 'member'
                         CHECK (role IN ('admin', 'member')),

  status     text        NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'suspended')),

  invited_by uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,

  PRIMARY KEY (org_id, amber_id)
);

-- THE INSTANCE RULE, ENFORCED BY THE DATABASE RATHER THAN BY EVERY WRITER.
-- One live membership per account. A second org for the same amber_id is
-- refused here, which is the only place it cannot be forgotten.
CREATE UNIQUE INDEX IF NOT EXISTS org_members_one_live_org
  ON org_members (amber_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS org_members_org_idx
  ON org_members (org_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- GROUPS: THE AUDIENCE INSIDE THE COMPANY.
--
-- "Share with everyone" and "share with just me" are the two ends; a group is
-- everything in between, and it is the unit the policy ceiling and the graph
-- restriction both operate on. Unlike a cohort (derived from contact evidence,
-- never edited by hand) a group is explicitly curated by an admin, because the
-- thing it models -- a team, a region, a deal pod -- is a decision somebody
-- made, not a fact the database can observe.
--
-- (org_id, id) is the composite key every child points at, matching the
-- (owner_id, id) discipline the rest of this schema uses.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_groups (
  org_id     uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  created_by uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,

  PRIMARY KEY (org_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS org_groups_name_live
  ON org_groups (org_id, lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS org_group_members (
  org_id   uuid        NOT NULL,
  group_id uuid        NOT NULL,
  amber_id uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  added_by uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (org_id, group_id, amber_id),

  CONSTRAINT org_group_members_group_fk
    FOREIGN KEY (org_id, group_id)
    REFERENCES org_groups (org_id, id) ON DELETE CASCADE,

  -- A group member must be a member of the org. Without this the two tables can
  -- disagree, and the one that decides who sees a group-scoped share would be
  -- whichever the read path happened to join first.
  CONSTRAINT org_group_members_member_fk
    FOREIGN KEY (org_id, amber_id)
    REFERENCES org_members (org_id, amber_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS org_group_members_person_idx
  ON org_group_members (org_id, amber_id);

-- ---------------------------------------------------------------------------
-- INVITES: A HASHED CAPABILITY, NOT A ROW SOMEBODY CAN GUESS.
--
-- The link in the email IS the credential -- the same model gcs-signing.js uses
-- for upload URLs, and the same sentence applies: the URL is the capability,
-- its lifetime is the blast radius. So:
--
--   * Only the SHA-256 of the token is stored. A stolen database backup yields
--     hashes, not working invite links.
--   * `expires_at` is NOT NULL. An invite that never expires is a permanent key
--     to a company's data sitting in somebody's inbox history.
--   * Acceptance is single-use: accepted_at is set in the same statement that
--     reads the invite, so two clicks on the same link cannot make two members.
--
-- `email` is stored lowercased. It is the address the invite was ISSUED to, and
-- acceptance binds the resulting account to it -- which is what makes a work
-- email an identity here rather than a display string.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_invites (
  org_id      uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),

  email       text        NOT NULL,
  role        text        NOT NULL DEFAULT 'member'
                          CHECK (role IN ('admin', 'member')),

  token_hash  bytea       NOT NULL,
  CONSTRAINT org_invites_token_len_chk CHECK (octet_length(token_hash) = 32),

  invited_by  uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz NULL,
  accepted_by uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,
  revoked_at  timestamptz NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (org_id, id)
);

-- The lookup the accept path does: hash the token from the URL, find the row.
-- Unique across all orgs because the token is the only thing the caller sends.
CREATE UNIQUE INDEX IF NOT EXISTS org_invites_token_hash_idx
  ON org_invites (token_hash);

-- One live invite per address per org. Re-inviting replaces rather than piles
-- up, so revoking "the invite" is not a hunt through six of them.
CREATE UNIQUE INDEX IF NOT EXISTS org_invites_email_live
  ON org_invites (org_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- THE POLICY, WHICH IS A CEILING AND NOT A DEFAULT.
--
-- This is the single most important sentence in the enterprise fork, so it is
-- written in the schema: the admin does not choose what a member shares. The
-- admin chooses the WIDEST AUDIENCE a given kind of thing may reach, and the
-- member picks anything at or below it.
--
-- A default would mean the admin's setting silently becomes everybody's
-- behavior, and the first person who does not change it has shared a customer
-- list org-wide because of a dropdown they never saw. A ceiling cannot do that:
-- its failure mode is a share that is refused, which the person making it finds
-- out about immediately.
--
-- One row per (org, classification). The classification is a property of the
-- thing being shared -- what KIND of information it is -- and the scope is how
-- far it may travel:
--
--   self            only the person who made it
--   group           one named group inside the org
--   org             everybody in the org
--   customer        one named customer outside the org, by link
--   customer_group  a named set of customers, by link
--
-- The order above is the ceiling order and it is total: a scope is permitted if
-- it sits at or below the cap. `customer` above `org` is deliberate and is the
-- thing an admin will care about most -- leaving the building is always a wider
-- blast radius than staying inside it, however few people are on the far end.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_policy (
  org_id         uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,

  classification text        NOT NULL
                             CHECK (classification IN
                               ('public', 'internal', 'customer_safe', 'private')),

  max_scope      text        NOT NULL
                             CHECK (max_scope IN
                               ('self', 'group', 'org', 'customer', 'customer_group')),

  updated_by     uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (org_id, classification)
);

-- ---------------------------------------------------------------------------
-- TWO CHANGES TO IDENTITY, BOTH REQUIRED BY "INVITE SOMEBODY AT WORK".
--
-- 1. A WORK EMAIL IS A LOGIN. user_identities already holds one row per
--    external identity with (provider, subject) as the key, and its provider
--    CHECK listed five providers, none of which is a plain verified email
--    address. An invited employee proves control of an address, not of an Apple
--    ID -- so 'email' joins the list. subject is the lowercased address.
--
-- 2. A PHONE IS NO LONGER REQUIRED TO EXIST. users.phone was NOT NULL because
--    every account in the system was created by phone OTP. An employee invited
--    by their work address may never give a phone number, and the alternative
--    to relaxing this is synthesising a fake number, which would collide with a
--    real one the moment somebody signed up with it.
--
--    The UNIQUE index on phone is untouched and still prevents two accounts on
--    one number; Postgres does not consider NULLs equal, so any number of
--    email-only accounts coexist.
--
--    THE INVARIANT THAT REPLACES NOT NULL: an account must have at least one
--    way to prove who it is -- a phone, or a live row in user_identities. That
--    cannot be a CHECK (it spans two tables) so it is enforced where accounts
--    are created: the invite-acceptance path writes the identity row in the
--    same transaction as the user, and there is no other path that creates a
--    user without a phone.
-- ---------------------------------------------------------------------------
ALTER TABLE user_identities DROP CONSTRAINT IF EXISTS user_identities_provider_check;
ALTER TABLE user_identities ADD CONSTRAINT user_identities_provider_check
  CHECK (provider IN ('privy', 'apple', 'google', 'phone', 'wallet', 'email'));

ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;

COMMENT ON COLUMN users.phone IS
  'Nullable since migration 062: an org member invited by work email may have no
   phone. Every account still has at least one proof of identity -- this column
   or a live user_identities row.';

-- ---------------------------------------------------------------------------
-- EMAIL SIGN-IN TOKENS. The same capability model as the invite, for the
-- second and every subsequent login of an email-only account.
--
-- Separate from org_invites because they answer different questions. An invite
-- says "this address may BECOME a member of this org, with this role"; a login
-- token says "this address already IS an account, let it back in". Merging them
-- would mean one table whose meaning depends on which columns are null, and the
-- row that is read on the authentication path is the last place that is worth
-- doing.
--
-- Single-use, short-lived, hashed, and never returned to the requester -- it
-- only ever leaves this service inside an email to the address it names. That
-- last point is the whole security of the mechanism: an endpoint that handed
-- the token back in its response would be an unauthenticated way to log in as
-- anybody whose address you could guess.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_login_tokens (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text        NOT NULL,
  amber_id     uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  token_hash   bytea       NOT NULL,
  CONSTRAINT email_login_tokens_len_chk CHECK (octet_length(token_hash) = 32),
  requester_ip text        NULL,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_login_tokens_hash_idx
  ON email_login_tokens (token_hash);

-- Rate limiting reads this: how many did this address ask for recently.
CREATE INDEX IF NOT EXISTS email_login_tokens_email_created_idx
  ON email_login_tokens (lower(email), created_at);

COMMIT;
