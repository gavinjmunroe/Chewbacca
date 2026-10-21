-- PROVENANCE FOR CIRCLE-DERIVED FACTS, and a bug in my own compat layer.
--
-- circle-enrichment.js writes a fact onto every member of a circle ("everyone in
-- Stanford GSB 2019 went to business school") and has to be able to REVOKE them
-- when the circle is deleted or its membership changes. It did that with
-- contact_facts.source = 'circle' AND source_ref = <circle id>.
--
-- observations has no source_ref. It has source_conversation_id, and my compat
-- layer mapped EVERY sourceRef onto it:
--
--     sourceConversationId: asUuid(sourceRef)
--
-- A circle id is a uuid, so asUuid accepts it happily, and the value lands in a
-- column with a foreign key to conversations(conversation_id) -- where no such
-- row exists. Every circle-derived fact would have failed its insert with a
-- foreign key violation, inside a catch that returns null. Circle enrichment
-- would have silently stopped working, and the revoke would have had nothing to
-- find even if it had.
--
-- WHY A SECOND COLUMN AND NOT A GENERIC source_ref. A generic uuid with a
-- companion type string is a polymorphic reference: no foreign key, nothing
-- stopping a circle id pointing at a deleted circle, and exactly the "convention
-- in application code" this rebuild exists to remove. Two nullable, FK'd columns
-- say what they mean and Postgres enforces both.
--
-- THE XOR CHECK IS NOT VIOLATED. observations already forbids contact_id AND
-- circle_id together, because those name the SUBJECT -- a fact is about a person
-- or about a circle, not both. This is PROVENANCE: a fact about Maggie that we
-- learned from her circle. Different question, different column.
ALTER TABLE observations
  ADD COLUMN source_circle_id uuid REFERENCES circles (id) ON DELETE CASCADE;

-- The revoke path: "every fact this circle produced". ON DELETE CASCADE above
-- means deleting a circle outright takes its derived facts with it; this index
-- serves the softer reconcile, where the circle lives and its membership or its
-- classification changed.
CREATE INDEX obs_source_circle_idx ON observations (owner_id, source_circle_id)
  WHERE source_circle_id IS NOT NULL AND deleted_at IS NULL;
