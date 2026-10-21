-- ---------------------------------------------------------------------------
-- 085 — AI WORK AS AN INTERACTION, AND SHARING AS A SEPARATE FACT.
--
--
-- 1. 'ai' IS ITS OWN KIND, NOT A NOTE.
--
-- Somebody asking an assistant to draft a follow-up to a partner at a firm is
-- a real event in that relationship. It is not a meeting and it is not a
-- note: nobody wrote it down deliberately, and the other party was not there.
-- It is the THINKING about a relationship, which until now has been captured
-- by nothing at all -- not the calendar, not the mailbox, not the CRM.
--
-- It gets its own kind rather than being filed as 'note' because the whole
-- point of the feature is that the timeline shows it as a peer to the human
-- touches. A row that renders identically to a hand-typed note is a row
-- nobody can see, and "AI as a channel" stops being visible exactly when it
-- stops being distinguishable.
--
--
-- 2. A SHARE IS A LATER DECISION, SO IT IS A DIFFERENT ROW.
--
-- The ledger is append-only, and that is load-bearing: the moment an
-- interaction can be edited, the history stops being evidence. Letting a
-- person publish one of their own rows to the team by flipping a column on it
-- would be an UPDATE on the ledger, which breaks that invariant to implement
-- a feature that does not need it.
--
-- Because a share is not a property of what happened. It is a decision made
-- afterwards, by a person, which they are entitled to reverse. That is a
-- different fact with a different lifetime, so it is a different table, and
-- unsharing is a delete there rather than a rewrite of history.
--
-- This is also what makes the shared-AI-research story work without making
-- AI work company-visible by default. One person decides, per item, that this
-- piece is worth the team seeing. Nobody can be opted in, and an admin cannot
-- share on somebody's behalf -- there is no column for it to set.
--
--
-- 3. AN IMPORT IS A BATCH, SO IT CAN BE UNDONE WHOLE.
--
-- Dropping two years of exported AI history into a graph is the kind of thing
-- somebody wants to reverse five minutes later, having seen what it looked
-- like. Without a batch id the only way back is picking rows out of a ledger
-- by hand, which is both miserable and the one operation this schema is built
-- to prevent. With one, undo is a delete by batch and an edge rebuild, which
-- is exactly the shape revoking a source already has.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 'ai' joins the kinds.
--
-- Dropped and recreated rather than altered because Postgres has no ADD VALUE
-- for a CHECK, and NOT VALID would leave the constraint permanently
-- untrustworthy to save a scan of a table that is currently small.
-- ---------------------------------------------------------------------------

ALTER TABLE org_interactions DROP CONSTRAINT IF EXISTS org_interactions_kind_shape;

ALTER TABLE org_interactions
  ADD CONSTRAINT org_interactions_kind_shape
  CHECK (kind IN (
    'meeting', 'call', 'email', 'message', 'note',
    'crm_update', 'enrichment', 'task', 'intro', 'ai', 'other'
  ));

-- ---------------------------------------------------------------------------
-- WHAT AN IMPORT BROUGHT IN.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS org_ai_imports (
  org_id      uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),

  -- Whose export this was. An import is personal: it is one person's history
  -- with an assistant, and it is attributed to them for the same reason an
  -- interaction is.
  amber_id    uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,

  provider    text        NOT NULL,
  filename    text        NULL,

  -- What the run did, for a screen that has to explain itself afterwards.
  conversations int       NOT NULL DEFAULT 0,
  matched       int       NOT NULL DEFAULT 0,
  written       int       NOT NULL DEFAULT 0,

  created_at  timestamptz NOT NULL DEFAULT now(),
  undone_at   timestamptz NULL,

  CONSTRAINT org_ai_imports_pkey PRIMARY KEY (org_id, id),

  CONSTRAINT org_ai_imports_provider_check
    CHECK (provider IN ('chatgpt', 'claude', 'copilot', 'gemini', 'other'))
);

CREATE INDEX IF NOT EXISTS org_ai_imports_member_idx
  ON org_ai_imports (org_id, amber_id, created_at DESC);

-- The batch an interaction arrived in, so undo is a delete by batch.
--
-- Separate from connection_id, which belongs to a consent grant: an import is
-- a one-off act, a grant is a standing permission, and conflating them would
-- mean revoking a calendar connection deleted somebody's AI history.
ALTER TABLE org_interactions ADD COLUMN IF NOT EXISTS import_id uuid NULL;

CREATE INDEX IF NOT EXISTS org_interactions_import_idx
  ON org_interactions (org_id, import_id) WHERE import_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- ONE PERSON DECIDING THAT ONE ROW IS WORTH THE TEAM SEEING.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS org_interaction_shares (
  org_id         uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  interaction_id uuid        NOT NULL,

  -- Kept even though only the owner may share, because "who published this"
  -- is the first question asked about anything surprising on a timeline, and
  -- deriving it later from the interaction's member_id assumes a rule that
  -- might not hold forever.
  --
  -- SET NULL, NOT CASCADE, AND THIS IS THE WHOLE POINT OF THE PRODUCT.
  -- Cascading would mean that when somebody leaves, the research they
  -- deliberately published to their team becomes invisible to everyone --
  -- which is precisely the loss this system exists to prevent. A share is an
  -- act of publication: once made, it belongs to the company, and the author
  -- leaving does not retract it. The row survives with no author, the same
  -- way org_interactions.member_id already does.
  shared_by      uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,
  shared_at      timestamptz NOT NULL DEFAULT now(),

  -- Optional one line on why, written by the person sharing. The research
  -- somebody deliberately publishes to the team is worth a sentence of
  -- framing, and a share with no context gets ignored.
  note           text        NULL,

  CONSTRAINT org_interaction_shares_pkey PRIMARY KEY (org_id, interaction_id),

  CONSTRAINT org_interaction_shares_fk
    FOREIGN KEY (org_id, interaction_id)
    REFERENCES org_interactions (org_id, id) ON DELETE CASCADE
);

-- The visibility predicate reads this on every ledger read, so it has to be
-- an index lookup rather than a scan.
CREATE INDEX IF NOT EXISTS org_interaction_shares_by_idx
  ON org_interaction_shares (org_id, shared_by, shared_at DESC);

-- ---------------------------------------------------------------------------
-- Both new tables join the tenant policy. Same linchpin, same name, same
-- failure mode as every other org table.
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_ai_imports', 'org_interaction_shares'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS amber_tenant ON %I', t);
    EXECUTE format($f$
      CREATE POLICY amber_tenant ON %I
        USING (amber_current_org() IS NOT NULL AND org_id = amber_current_org())
        WITH CHECK (amber_current_org() IS NOT NULL AND org_id = amber_current_org())
    $f$, t);
  END LOOP;
END $$;
