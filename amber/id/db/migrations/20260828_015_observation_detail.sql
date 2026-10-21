-- WHAT THE OLD FACT/NOTE/EXPERIENCE ROWS CARRIED THAT observations DID NOT.
--
-- Two gaps, both found by reading the code that has to write these rows rather
-- than by looking at the table shapes.
--
-- GAP 1: A NOTE HAS MORE THAN ONE PERSON IN IT.
-- contact_notes and contact_experiences both carry participant_ids as an ARRAY.
-- "Had dinner with Maggie and Sagar" is one note about two people. `observations`
-- had a single contact_id, which would have forced either duplicating the text
-- per person or silently dropping everyone after the first.
--
-- So: contact_id stays as the PRIMARY subject and keeps the composite FK that
-- carries authorization, and observation_participants records everyone mentioned.
-- A fact sets contact_id. A multi-person note leaves it null and uses
-- participants. Retrieval reads both.
--
-- GAP 2: SENTIMENT, SALIENCE, AND RESOLUTION STATUS.
-- contact_facts carried sentiment, sentiment_strength, certainty, weight,
-- is_conditional, condition_text, is_past, status and raw_name. Some of those map
-- onto things observations already has; the rest are real signal that PeopleRank
-- reads, and dropping them would make ranking worse than it is today.
--
--   certainty     -> observations.confidence          (already present)
--   is_conditional-> observations.modality = 'hypothetical'
--   is_past       -> observations.temporal_shape / valid_until
--   category      -> dimensions + tags
--   the rest      -> added below

ALTER TABLE observations
  -- HOW THE OWNER FEELS ABOUT IT, separate from how confident the classifier is.
  -- "He got promoted" and "he got fired" are both certain; they are not both good.
  ADD COLUMN sentiment          text CHECK (sentiment IS NULL OR sentiment IN ('positive','negative','neutral','mixed')),
  ADD COLUMN sentiment_strength real CHECK (sentiment_strength IS NULL OR sentiment_strength BETWEEN 0 AND 1),

  -- HOW MUCH THIS FACT MATTERS AT ALL, independent of any dimension. Distinct
  -- from observation_dimensions.weight, which is "how much it matters TO THAT
  -- DIMENSION". "He drinks oat milk" is low salience everywhere; "he's getting
  -- divorced" is high salience and also heavily emotional.
  ADD COLUMN salience           real CHECK (salience IS NULL OR salience BETWEEN 0 AND 1),

  -- 'resolved'    we know who this is about
  -- 'pending'     waiting on "which Maggie?" -- must NEVER reach ranking
  -- 'soft'        resolved by inference, not confirmed; ranks at a discount
  ADD COLUMN status             text NOT NULL DEFAULT 'resolved'
                                CHECK (status IN ('resolved','pending','soft')),
  -- The name exactly as it was said, kept even after resolution so a wrong
  -- resolution can be traced back and corrected.
  ADD COLUMN raw_name           text,
  -- "if the funding closes" -- the antecedent of a hypothetical.
  ADD COLUMN condition_text     text;

-- A pending observation must never be ranked. This partial index is what makes
-- "everything I actually know about this person" cheap, and the pending sweep
-- cheap too.
CREATE INDEX obs_resolved_idx ON observations (owner_id, contact_id, observed_at DESC)
  WHERE status = 'resolved' AND deleted_at IS NULL;
CREATE INDEX obs_pending_idx  ON observations (owner_id, created_at)
  WHERE status = 'pending' AND deleted_at IS NULL;

-- EVERYONE AN OBSERVATION IS ABOUT.
-- role distinguishes the person a note is primarily about from the people merely
-- present, which matters for ranking: being mentioned in someone else's dinner
-- story is weaker evidence than the story being about you.
CREATE TABLE observation_participants (
  observation_id uuid        NOT NULL REFERENCES observations (observation_id) ON DELETE CASCADE,
  owner_id       uuid        NOT NULL,
  contact_id     uuid        NOT NULL,
  role           text        NOT NULL DEFAULT 'participant'
                             CHECK (role IN ('subject','participant','mentioned')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (observation_id, contact_id),
  CONSTRAINT op_owner_contact_fk FOREIGN KEY (owner_id, contact_id)
    REFERENCES contacts (owner_id, id) ON DELETE CASCADE
);
-- "Everything this person appears in", which is the other half of a contact's
-- timeline -- the half that single-subject facts alone would miss.
CREATE INDEX op_contact_idx ON observation_participants (owner_id, contact_id, role);

-- UNRESOLVED NAMES. "Had dinner with Mags" before Mags is matched to a card.
-- Kept alongside the participant rows so a note can be half-resolved: two people
-- matched, one still a bare string waiting on an answer.
CREATE TABLE observation_raw_names (
  observation_id uuid NOT NULL REFERENCES observations (observation_id) ON DELETE CASCADE,
  raw_name       text NOT NULL,
  resolved_to    uuid,
  PRIMARY KEY (observation_id, raw_name)
);

-- WHERE IT HAPPENED, as the speaker said it.
--
-- `contact_experiences` carried a free-text `location` and the shares feed
-- returns it, so dropping it on the way into observations would have quietly
-- emptied a field the API still promises. It stays free text on purpose: `places`
-- is for a resolved, reusable place with coordinates, and "at Sagar's place" is
-- neither -- forcing every utterance through the resolved table would either
-- invent place rows for phrases or throw the phrase away.
ALTER TABLE observations ADD COLUMN place_text text;
