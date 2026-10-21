-- SIGNAL — what happened, when, and where.

-- PLACES. A seeded lookup with aliases, NOT a resolver. Amber's raw input is
-- "she mentioned she's in SF" -- a place mention, not a coordinate. Seed the few
-- hundred cities that matter, match mentions with trigram, and write place_id
-- only on a confident match. An unresolved mention stays as searchable text and
-- simply does not participate in geo queries: missing someone beats filing them
-- in the wrong Austin.
--
-- geog arrives with PostGIS the day a radius query exists. Not before.
CREATE TABLE places (
  place_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  aliases    text[]      NOT NULL DEFAULT '{}',
  city       text,
  region     text,
  country    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX places_name_trgm_idx  ON places USING GIN (name gin_trgm_ops);
CREATE INDEX places_alias_idx      ON places USING GIN (aliases);

-- EVENTS. Separate from observations because a start and an end need a range
-- index -- that is what turns "free Friday evening" into a lookup instead of a
-- scan. Modality carries the granularity: an occurrence, an availability, and a
-- hypothetical all live here and are told apart by one column.
CREATE TABLE events (
  event_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid        NOT NULL,
  contact_id uuid,
  circle_id  uuid,
  modality   text        NOT NULL DEFAULT 'actual'
                         CHECK (modality IN ('actual','planned','hypothetical',
                                             'desired','available','declined')),
  kind       text,
  title      text,
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz,
  place_id   uuid        REFERENCES places (place_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT events_subject_chk CHECK (contact_id IS NULL OR circle_id IS NULL),
  CONSTRAINT events_range_chk   CHECK (ends_at IS NULL OR starts_at <= ends_at),
  CONSTRAINT events_owner_contact_fk FOREIGN KEY (owner_id, contact_id)
    REFERENCES contacts (owner_id, id) ON DELETE CASCADE,
  CONSTRAINT events_owner_circle_fk  FOREIGN KEY (owner_id, circle_id)
    REFERENCES circles  (owner_id, id)  ON DELETE CASCADE
);

CREATE INDEX events_owner_start_idx ON events (owner_id, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX events_place_idx       ON events (place_id) WHERE deleted_at IS NULL;

-- OVERLAP, OWNER-SCOPED, IN ONE INDEX. btree_gist is what lets a uuid sit
-- beside a range in the same GiST index, so "who of mine is free Friday" never
-- touches another owner's rows.
CREATE INDEX events_availability_idx ON events
  USING GIST (owner_id, tstzrange(starts_at, COALESCE(ends_at, starts_at), '[]'))
  WHERE deleted_at IS NULL;

-- INTERACTION SUMMARY, ONE ROW PER CONTACT -- NOT ONE PER MESSAGE.
-- An iMessage backfill is tens of thousands of rows per user on day one; at a
-- million users that is billions of rows in the OLTP database for no read that
-- needs them. The raw stream goes to BigQuery via CDC. Cloud SQL then scales
-- with CONTACTS, which grows slowly, instead of with MESSAGES, which does not.
--
-- last_interaction_at IS A TIMESTAMP, NOT A COUNT OF DAYS. A stored delta rots:
-- if nobody interacts, "days since" never ticks up, so the person never becomes
-- "haven't seen recently" -- exactly backwards. Timestamps do not rot.
CREATE TABLE contact_interaction_stats (
  owner_id            uuid        NOT NULL,
  contact_id          uuid        NOT NULL,
  last_interaction_at timestamptz,
  first_interaction_at timestamptz,
  count_30d           integer     NOT NULL DEFAULT 0,
  count_90d           integer     NOT NULL DEFAULT 0,
  count_all           integer     NOT NULL DEFAULT 0,
  computed_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, contact_id),
  CONSTRAINT cis_owner_contact_fk FOREIGN KEY (owner_id, contact_id)
    REFERENCES contacts (owner_id, id) ON DELETE CASCADE
);
CREATE INDEX cis_recency_idx ON contact_interaction_stats (owner_id, last_interaction_at);
