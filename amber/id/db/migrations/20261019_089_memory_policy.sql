-- ---------------------------------------------------------------------------
-- 089 — WHAT AN ADMIN MAY DECIDE ABOUT THE RELATIONSHIP GRAPH.
--
-- A CEILING, NOT A DEFAULT, and the distinction is the whole design.
--
-- An admin who can make everyone's interactions company-visible destroys the
-- property that makes a rep connect their calendar at all. That switch gets
-- flipped within a quarter by somebody with a dashboard to fill, and the
-- graph goes empty quietly, because people stop connecting rather than
-- complain. Nobody files a ticket saying "I declined to adopt your product".
--
-- So every lever here RESTRICTS. An admin can forbid a source, forbid data
-- leaving, cap how long touches are kept, and require that agent writes pass
-- a check. None of them can expose one person's private history to another.
-- There is deliberately no column for it, so no future handler can grow one
-- by accident.
--
-- This is also the stronger position commercially. "Your administrator can
-- tighten and never loosen" is what a compliance officer needs to hear
-- before a 16,000-person rollout, and an admin screen full of levers that
-- EXPAND access reads to that person as a liability they have to sign for.
--
-- ONE ROW PER COMPANY, created on read rather than at signup, because a
-- company that has never opened the screen has the defaults and a missing
-- row is not a different state from an untouched one.
--
-- VERSION IS WHAT MAKES THIS EVIDENCE. Every interaction records the policy
-- version in force when it was written. Without that, "we had a rule" is a
-- claim about the present tense applied to the past, which is exactly the
-- thing an auditor is paid not to accept. With it, a row from March can be
-- checked against the rules that actually existed in March.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS org_memory_policy (
  org_id uuid NOT NULL PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,

  /*
   * Bumped on every change. Not a timestamp: two edits in the same second
   * are two policies, and an interaction has to be able to name exactly one.
   */
  version int NOT NULL DEFAULT 1,

  /*
   * WHICH SOURCES MAY FEED THE GRAPH AT ALL.
   *
   * A member may decline a permitted source. A member may not enable a
   * forbidden one -- that is the ceiling, in one sentence. Removing a source
   * here stops future writes; it does not delete what is already there,
   * because silently destroying history on a settings change is the kind of
   * thing that should require somebody to type the word delete.
   */
  sources text[] NOT NULL
    DEFAULT ARRAY['calendar', 'mail', 'transcript', 'crm', 'enrichment', 'manual']::text[],

  /*
   * WHETHER PERSON-LEVEL DATA MAY LEAVE THE COMPANY.
   *
   * Off by default, and off is the honest default for a payroll company's
   * contact graph. When off, the key-authenticated API serves aggregates and
   * refuses people -- not by filtering the rows out, but by refusing the
   * route, so nobody mistakes an empty list for an empty graph.
   */
  allow_external boolean NOT NULL DEFAULT false,

  /*
   * HOW LONG A TOUCH IS KEPT. NULL means indefinitely.
   *
   * The first question a regulated industry asks about a new store of
   * personal data, and "forever, by default" is not an answer that survives
   * the meeting.
   */
  retention_months int NULL CHECK (retention_months IS NULL OR retention_months BETWEEN 1 AND 240),

  /*
   * WHETHER AN AGENT'S WRITE MUST PASS A CHECK BEFORE IT IS RECORDED.
   *
   * THE GAP THIS FILLS IS ONE PAYCHEX NAMED IN WRITING: their Copilot
   * integration does post-hoc analysis, not runtime enforcement. Post-hoc
   * means nothing is ever stopped, only found later.
   *
   * We can stop it, for one specific reason that is worth being precise
   * about rather than overclaiming: we are ON the write path. Every
   * interaction enters through one function. A door can refuse; a report
   * cannot. This does not fix Copilot, it moves the durable record somewhere
   * that has a door.
   */
  require_gate boolean NOT NULL DEFAULT true,

  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES users (amber_id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- WHICH RULES WERE IN FORCE WHEN THIS HAPPENED.
--
-- Nullable because rows written before this migration were written under no
-- policy, and backfilling a version onto them would be inventing a rule that
-- did not exist. A null here means "before policy", which is true and
-- auditable; a 1 would be a lie that nothing could later detect.
-- ---------------------------------------------------------------------------

ALTER TABLE org_interactions ADD COLUMN IF NOT EXISTS policy_version int NULL;

-- ---------------------------------------------------------------------------
-- WHAT THE GATE REFUSED.
--
-- A gate that silently drops writes is indistinguishable from a broken sync,
-- and the first time somebody notices is when a relationship is missing from
-- a graph they were relying on. Refusals are recorded: what was attempted,
-- by whom, under which rule.
--
-- This is also the evidence half. "We enforce at runtime" is a claim; a table
-- of the things that were actually stopped is the proof, and it is the
-- artifact an auditor asks for.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS org_policy_refusals (
  org_id     uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),

  -- Null for an agent or a key, which have no amber_id. That is information,
  -- not a gap: it says the write did not come from a person.
  amber_id   uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,

  source     text        NOT NULL,
  reason     text        NOT NULL,
  detail     text        NULL,
  policy_version int     NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT org_policy_refusals_pkey PRIMARY KEY (org_id, id),
  CONSTRAINT org_policy_refusals_reason_check
    CHECK (reason IN ('source_forbidden', 'external_forbidden', 'retention', 'gate'))
);

CREATE INDEX IF NOT EXISTS org_policy_refusals_recent_idx
  ON org_policy_refusals (org_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Both tables join the tenant policy.
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_memory_policy', 'org_policy_refusals'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS amber_tenant ON %I', t);
    EXECUTE format($f$
      CREATE POLICY amber_tenant ON %I
        USING (amber_current_org() IS NOT NULL AND org_id = amber_current_org())
        WITH CHECK (amber_current_org() IS NOT NULL AND org_id = amber_current_org())
    $f$, t);
  END LOOP;
END $$;
