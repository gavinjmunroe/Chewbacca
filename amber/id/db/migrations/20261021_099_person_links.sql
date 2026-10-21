-- ---------------------------------------------------------------------------
-- HOW TWO PEOPLE ARE CONNECTED TO EACH OTHER.
--
-- The graph has always been a star: every edge runs from a member to a person
-- and says how warm it is. That answers "who do I know" and cannot answer the
-- question people actually ask about a network -- "how do these two know each
-- other", "who got me in the door", "who else is in that room".
--
-- WHAT DOES NOT NEED A ROW. Two people at the same company are already
-- grouped: they share a firm, and the firm is a pill you can press. Storing a
-- works_with edge for every pair in an account would be n-squared rows
-- restating a fact one column already holds. This table is for what the data
-- cannot derive: somebody made an introduction, two people met somewhere,
-- one person told you about another.
--
-- DIRECTION IS KEPT AND USUALLY IGNORED. "Sagar introduced me to Jonah" has a
-- direction and losing it loses the meaning. "They were at school together"
-- does not. The column stores it; the renderer draws an undirected line
-- unless the kind is one where the arrow is the point.
--
-- SOURCE IS THE SAME DISCIPLINE AS A NAME. A link somebody drew or typed is
-- 'human'. A link a model proposed from a note is 'inferred' and is drawn
-- dashed and faint until somebody accepts it. An inferred link never
-- overwrites a human one, and a human one is never silently replaced -- the
-- lesson from names, applied before it costs anything.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS org_person_links (
  org_id      uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),

  from_person uuid        NOT NULL,
  to_person   uuid        NOT NULL,

  -- introduced: from_person put the viewer (or to_person) in touch.
  -- met_at / knows / worked_with: symmetric, context lives in `note`.
  kind        text        NOT NULL DEFAULT 'knows'
                          CHECK (kind IN ('introduced', 'knows', 'met_at', 'worked_with')),

  -- Why anybody thinks so, in words. This is the thing somebody reads.
  note        text        NULL,

  -- 'human' when a person drew or typed it, 'inferred' when a model read it
  -- out of a note and is proposing it.
  source      text        NOT NULL DEFAULT 'human'
                          CHECK (source IN ('human', 'inferred')),

  -- Null until somebody accepts an inferred link. Human links are born accepted.
  accepted_at timestamptz NULL,

  created_by  uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz NULL,

  PRIMARY KEY (org_id, id),

  CONSTRAINT org_person_links_from_fk
    FOREIGN KEY (org_id, from_person) REFERENCES org_people (org_id, id) ON DELETE CASCADE,
  CONSTRAINT org_person_links_to_fk
    FOREIGN KEY (org_id, to_person) REFERENCES org_people (org_id, id) ON DELETE CASCADE,

  -- A link from somebody to themselves is a data-entry slip, not a relationship.
  CONSTRAINT org_person_links_distinct CHECK (from_person <> to_person)
);

-- One live link per pair per kind. Drawing the same line twice is the same
-- claim, not a second one; partial on deleted_at so a removed link can be
-- drawn again later.
CREATE UNIQUE INDEX IF NOT EXISTS org_person_links_pair_idx
  ON org_person_links (org_id, from_person, to_person, kind)
  WHERE deleted_at IS NULL;

-- The only read: every live link in one org, to draw them all at once.
CREATE INDEX IF NOT EXISTS org_person_links_org_idx
  ON org_person_links (org_id) WHERE deleted_at IS NULL;

-- Same isolation as every other relationship table. A link is as sensitive as
-- the two people it names.
ALTER TABLE org_person_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS amber_tenant ON org_person_links;
CREATE POLICY amber_tenant ON org_person_links
  USING (amber_current_org() IS NOT NULL AND org_id = amber_current_org())
  WITH CHECK (amber_current_org() IS NOT NULL AND org_id = amber_current_org());
