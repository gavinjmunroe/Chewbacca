-- ============================================================================
-- THE RELATIONSHIP LEDGER.
--
-- One table does the work here, and everything else in this file either feeds
-- it or is derived from it: every interaction the company has with a person
-- lands in org_interactions, append-only and attributed to the source it came
-- from. The relationship memory is what you get by reading that back.
--
-- WHY THIS SHAPE AND NOT A CRM. A CRM stores the CURRENT STATE of a
-- relationship -- stage, owner, last activity date -- and overwrites it as
-- things change. That is the right model for a pipeline report and the wrong
-- one for memory, because the question people actually have is not "what
-- stage is this" but "what happened, and what should I do next", and the
-- second question needs the history that the first one throws away.
--
-- An append-only ledger answers both. Current state is a fold over the
-- events, and it can be recomputed when the rules change; the events
-- themselves are never rewritten, so "why does it think that" always has an
-- answer and the audit trail is a property of the design rather than a
-- feature bolted to it.
--
-- EVERY PRODUCER WRITES THE SAME ROW. A calendar sync, a meeting transcript,
-- a CRM update, an enrichment job and somebody typing a note all produce an
-- interaction. That is what makes each new integration improve every reader
-- without any reader changing, and it is the whole compounding argument for
-- building this before the features that sit on top.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A PERSON THE COMPANY DEALS WITH.
--
-- DELIBERATELY NOT org_members. A member is somebody who signs in here; a
-- person is somebody the company talks to, who may never have heard of this
-- product. Conflating them is the modelling mistake that cannot be undone
-- later: it puts prospects in the roster, makes "who works here" unanswerable,
-- and ties a contact's lifetime to an account that does not exist.
--
-- `owner_id` is nullable and means "whose relationship this primarily is",
-- which is a claim the company makes rather than a fact about the person. It
-- is NOT who may see them -- visibility is the org's, like every other row
-- here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_people (
  org_id       uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),

  display_name text        NOT NULL,
  title        text        NULL,
  company      text        NULL,
  -- Free text the team keeps about them. Not derived, never overwritten by a
  -- producer: this is the one field a human owns outright.
  note         text        NULL,

  -- Whose relationship this is, if anybody's. ON DELETE SET NULL because the
  -- contact outlives the employee, which is the entire point of keeping it
  -- here rather than in somebody's phone.
  owner_id     uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz NULL,

  PRIMARY KEY (org_id, id),

  CONSTRAINT org_people_name_shape CHECK (btrim(display_name) <> '')
);

CREATE INDEX IF NOT EXISTS org_people_name_idx
  ON org_people (org_id, lower(display_name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS org_people_owner_idx
  ON org_people (org_id, owner_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- HOW A PERSON IS RECOGNIZED.
--
-- The dedupe key, and the reason two producers can independently discover the
-- same human. A calendar invite knows an email address; Salesforce knows a
-- record id; a transcript knows a display name and maybe a phone. None of
-- those is "the" identifier, so none of them lives on org_people -- they are
-- rows here, and a person is whoever owns a given identity.
--
-- `value` IS STORED NORMALIZED (lower, trimmed) because matching is the only
-- thing it is for. The unique index is what makes a second producer attach to
-- an existing person rather than create a duplicate, which is the single
-- behaviour that decides whether this graph is useful or noise after a month.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_person_identities (
  org_id     uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  person_id  uuid        NOT NULL,
  kind       text        NOT NULL,
  value      text        NOT NULL,
  -- Which producer asserted this. Two sources claiming the same identity is
  -- normal and good; it is corroboration, not conflict.
  source     text        NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (org_id, kind, value),

  CONSTRAINT org_person_identities_person_fk
    FOREIGN KEY (org_id, person_id)
    REFERENCES org_people (org_id, id) ON DELETE CASCADE,

  CONSTRAINT org_person_identities_kind_shape
    CHECK (kind IN ('email', 'phone', 'linkedin', 'salesforce', 'microsoft', 'domain', 'other')),

  CONSTRAINT org_person_identities_value_shape
    CHECK (btrim(value) <> '' AND value = lower(value))
);

CREATE INDEX IF NOT EXISTS org_person_identities_person_idx
  ON org_person_identities (org_id, person_id);

-- ---------------------------------------------------------------------------
-- THE LEDGER.
--
-- APPEND-ONLY. There is no update path in the store that writes this table,
-- and that is a deliberate constraint rather than an oversight: the moment an
-- interaction can be edited, the history stops being evidence and the audit
-- trail stops being worth anything. A correction is a new row.
--
-- `external_id` + `source` IS THE IDEMPOTENCY KEY, and it is the difference
-- between a sync that can be re-run and one that duplicates everything each
-- night. Every producer that has a stable id for its own objects -- a
-- calendar event, a Salesforce task, a transcript -- must supply it.
--
-- `member_id` is WHICH OF OUR PEOPLE was involved. Nullable because some
-- sources genuinely do not know (an enrichment job acts on behalf of the
-- company, not a person), and that is more honest than attributing it to
-- whoever happened to run it.
--
-- `occurred_at` IS NOT created_at. A transcript lands on Thursday for a call
-- that happened on Tuesday, and every question anybody asks -- how long since
-- we spoke, is this going cold -- is about Tuesday.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_interactions (
  org_id      uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),

  person_id   uuid        NOT NULL,
  member_id   uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,

  kind        text        NOT NULL,
  source      text        NOT NULL,
  -- The producer's own id for this thing, so a re-run updates nothing and
  -- inserts nothing rather than doubling the history.
  external_id text        NULL,

  -- A sentence a person reads. Not the raw artifact: a transcript is
  -- thousands of words and belongs where it already lives.
  summary     text        NULL,
  -- Where the real thing is, so the ledger points at evidence rather than
  -- trying to become a copy of every system it reads.
  artifact_url text       NULL,

  occurred_at timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- Set when this came in through a connection somebody can revoke. Revoking
  -- deletes these rows, which is what makes per-source consent real rather
  -- than a checkbox.
  connection_id uuid      NULL,

  PRIMARY KEY (org_id, id),

  CONSTRAINT org_interactions_person_fk
    FOREIGN KEY (org_id, person_id)
    REFERENCES org_people (org_id, id) ON DELETE CASCADE,

  CONSTRAINT org_interactions_kind_shape
    CHECK (kind IN (
      'meeting', 'call', 'email', 'message', 'note',
      'crm_update', 'enrichment', 'task', 'intro', 'other'
    )),

  CONSTRAINT org_interactions_source_shape CHECK (btrim(source) <> '')
);

-- The idempotency key. Partial, because external_id is genuinely absent for
-- anything somebody typed, and two hand-written notes are not duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS org_interactions_external_idx
  ON org_interactions (org_id, source, external_id)
  WHERE external_id IS NOT NULL;

-- The hot read: one person's history, newest first.
CREATE INDEX IF NOT EXISTS org_interactions_person_idx
  ON org_interactions (org_id, person_id, occurred_at DESC);

-- The other hot read: what has this employee been doing, and with whom.
CREATE INDEX IF NOT EXISTS org_interactions_member_idx
  ON org_interactions (org_id, member_id, occurred_at DESC);

-- Revoking a connection has to find its rows without scanning the ledger.
CREATE INDEX IF NOT EXISTS org_interactions_connection_idx
  ON org_interactions (org_id, connection_id) WHERE connection_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- WHO KNOWS WHOM.
--
-- DERIVED, and that is the important word. Every column here is a fold over
-- org_interactions, so this table can be dropped and rebuilt and nothing a
-- human wrote is lost. It exists because computing "last touch across eleven
-- thousand interactions" on every page render is the difference between a
-- product and a demo, not because it holds anything.
--
-- The temptation will be to let somebody edit `strength` by hand. Do not:
-- the moment a derived table has authored rows in it, it can no longer be
-- rebuilt, and the rebuild is the thing that lets the scoring rules change.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_person_edges (
  org_id        uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  person_id     uuid        NOT NULL,
  member_id     uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,

  interactions  int         NOT NULL DEFAULT 0,
  first_at      timestamptz NULL,
  last_at       timestamptz NULL,
  -- 0..1. Recency and frequency folded together; the formula lives in the
  -- store so it can change without a migration.
  strength      numeric(4,3) NOT NULL DEFAULT 0,

  computed_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (org_id, person_id, member_id),

  CONSTRAINT org_person_edges_person_fk
    FOREIGN KEY (org_id, person_id)
    REFERENCES org_people (org_id, id) ON DELETE CASCADE,

  CONSTRAINT org_person_edges_strength_shape
    CHECK (strength >= 0 AND strength <= 1)
);

CREATE INDEX IF NOT EXISTS org_person_edges_member_idx
  ON org_person_edges (org_id, member_id, strength DESC);

-- ---------------------------------------------------------------------------
-- WHICH SOURCES A PERSON HAS AGREED TO FEED IN.
--
-- CONSENT IS PER PERSON AND PER SOURCE, not per company and not per
-- connection. Somebody connecting their Google account to see their own
-- calendar has not agreed to drain their mail into a company graph, and a
-- product that treats those as the same decision is one people turn off
-- entirely the first time it surprises them.
--
-- Revoking sets revoked_at AND deletes the interactions that came in under
-- it -- which is why org_interactions carries connection_id. A consent record
-- that stops future writes but leaves the past is not consent, it is a
-- toggle.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_memory_sources (
  org_id       uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  amber_id     uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,

  source       text        NOT NULL,
  -- What of theirs this reads: a calendar account id, a mailbox, a workspace.
  scope_ref    text        NULL,

  granted_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz NULL,
  last_sync_at timestamptz NULL,
  last_error   text        NULL,

  PRIMARY KEY (org_id, id),

  CONSTRAINT org_memory_sources_member_fk
    FOREIGN KEY (org_id, amber_id)
    REFERENCES org_members (org_id, amber_id) ON DELETE CASCADE,

  CONSTRAINT org_memory_sources_source_shape CHECK (btrim(source) <> '')
);

-- One live grant per person per source per scope. Partial on revoked_at so a
-- revoked grant does not block granting again later.
CREATE UNIQUE INDEX IF NOT EXISTS org_memory_sources_live_idx
  ON org_memory_sources (org_id, amber_id, source, COALESCE(scope_ref, ''))
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Every table joins the tenant policy. Relationship data is the most
-- sensitive thing in this product and it does not get a new isolation story:
-- same org_id linchpin, same amber_tenant policy, same RLS as everything
-- else.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'org_people', 'org_person_identities', 'org_interactions',
    'org_person_edges', 'org_memory_sources'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS amber_tenant ON %I', t);
    EXECUTE format($f$
      CREATE POLICY amber_tenant ON %I
        USING (amber_current_org() IS NOT NULL AND org_id = amber_current_org())
        WITH CHECK (amber_current_org() IS NOT NULL AND org_id = amber_current_org())
    $f$, t);
  END LOOP;
END $$;
