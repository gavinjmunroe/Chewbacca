-- ============================================================================
-- WHERE PEOPLE ARE, AND WHERE THEY WANT TO BE.
--
-- "High level location sharing. Where you and your desired locations can see
--  each other on a map interface."
--
-- THE SHAPE OF THIS IS THE SAME AS INTENTS AND FOR THE SAME REASON. A location
-- is not a position the system tracks. It is a STATEMENT somebody made to an
-- audience they chose, exactly like a note or an intent, and it uses the same
-- four scopes so a person choosing who may see where they are is not learning a
-- second vocabulary for it.
--
-- THERE IS NO 'exact' PRECISION AND THERE IS NO COORDINATE COLUMN ON A PERSON.
-- This is the load-bearing decision in the whole file. A person's row points at
-- a PLACE -- a named region that already existed in `places` before they chose
-- it -- and the map draws that place's centroid. Two people who share "Chicago"
-- are drawn at the identical point, because it is Chicago's point and not
-- either of theirs. Nothing in this schema can answer "where is Karthik
-- standing", so no bug, no leaky join and no compromised account can answer it
-- either. That is a cheaper guarantee to keep than any amount of care with a
-- lat/lng column, and "high level" is what was asked for.
--
-- COARSENING MUST BE EXACT, NOT ROUNDED. If I show my metro to my network and
-- my neighborhood to one circle, the metro I show must be the REAL metro row --
-- the same one everybody else in it shows -- and never my neighborhood's point
-- with digits knocked off. Rounded coordinates are triangulable: collect a
-- person's answer at three precisions and the error bars intersect over their
-- street. Pointing at a coarser place instead leaks nothing, because the
-- coarser place is a landmark everyone shares.
--
-- Which is why the rollup lives on `places` as three direct columns rather than
-- a parent chain walked at read time. The coarsening is then a JOIN inside the
-- same query that checks the audience, so the finer place never reaches
-- JavaScript at all. A recursive walk would work and would also mean the
-- precise row is in memory while we decide whether the viewer may have it.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- PLACES GROW A GEOGRAPHY.
--
-- `places` has been a seeded name-and-alias lookup since migration 008, whose
-- header said: "geog arrives with PostGIS the day a radius query exists. Not
-- before." That day still has not come and this does not bring it. Co-presence
-- at metro level is an EQUALITY on metro_place_id, not a radius -- "are we in
-- the same place" rather than "are we within 40km" -- so the whole feature is
-- plain integers and a join. lat/lon are here to DRAW a dot, never to decide
-- one.
-- ---------------------------------------------------------------------------
ALTER TABLE places ADD COLUMN IF NOT EXISTS kind text
  CHECK (kind IS NULL OR kind IN ('country', 'region', 'metro', 'neighborhood'));

-- Centroid, for drawing. Nullable: a place nobody has given coordinates to is
-- still a usable place, it just does not appear on the map until it has them.
ALTER TABLE places ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE places ADD COLUMN IF NOT EXISTS lon double precision;

-- THE ROLLUP. A metro points at itself; a neighborhood points at its metro.
-- Self-referencing and nullable, because an unseeded rollup must make a share
-- COARSER (see the resolver), never finer.
ALTER TABLE places ADD COLUMN IF NOT EXISTS metro_place_id uuid
  REFERENCES places (place_id) ON DELETE SET NULL;
ALTER TABLE places ADD COLUMN IF NOT EXISTS region_place_id uuid
  REFERENCES places (place_id) ON DELETE SET NULL;
ALTER TABLE places ADD COLUMN IF NOT EXISTS country_place_id uuid
  REFERENCES places (place_id) ON DELETE SET NULL;

-- A stable handle for seeding and for tests, so a seed script is idempotent and
-- a fixture can name "us-il-chicago" instead of carrying a uuid.
ALTER TABLE places ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS places_slug_idx ON places (slug) WHERE slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS places_metro_idx ON places (metro_place_id);
CREATE INDEX IF NOT EXISTS places_kind_idx  ON places (kind);

-- ---------------------------------------------------------------------------
-- WHAT A PERSON SAID ABOUT WHERE THEY ARE.
--
-- One row is ONE STATEMENT TO ONE AUDIENCE. Showing your metro to your network
-- and your neighborhood to one circle is two rows, not one row with a precision
-- table hanging off it. That keeps the read path trivial -- every row carries
-- its own audience and its own precision, so "what may this viewer see" is a
-- filter and a sort, with no second resolution step where the two could
-- disagree.
--
-- KIND IS WHY THIS IS NOT JUST A PROFILE FIELD. `users.current_city` has
-- existed since migration 002 and is a single free-text line visible to every
-- audience at once. It cannot say "and I am in Lisbon until Friday", it cannot
-- say "I would move to Tokyo", and it cannot be shown to one circle and not
-- another. Those three are the entire feature.
--
--   home / work   ongoing. No dates.
--   current       where I am now, which is a claim with a shelf life.
--   trip          dated. The thing that actually produces a meeting.
--   wish          somewhere I want to be. "Your desired locations."
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_locations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  place_id    uuid        NOT NULL REFERENCES places (place_id) ON DELETE CASCADE,

  kind        text        NOT NULL
                          CHECK (kind IN ('home', 'work', 'current', 'trip', 'wish')),

  -- THE FINEST THIS ROW MAY EVER BE DRAWN AT. Not a hint -- the resolver treats
  -- it as a ceiling and will go coarser on its own when the rollup is missing.
  -- There is deliberately no 'exact'.
  precision   text        NOT NULL DEFAULT 'metro'
                          CHECK (precision IN ('country', 'region', 'metro', 'neighborhood')),

  -- Same four audiences as `shares`, `intents` and `network_visibility`.
  scope_type  text        NOT NULL
                          CHECK (scope_type IN ('network', 'circle', 'contact', 'cohort')),
  scope_ref   uuid        NULL,
  max_degree  smallint    NOT NULL DEFAULT 1 CHECK (max_degree BETWEEN 1 AND 3),

  -- A trip has dates. A home does not. `ends_at` null on a dated row means
  -- open-ended, which is a real thing people say ("I moved to Lisbon").
  starts_at   timestamptz NULL,
  ends_at     timestamptz NULL,

  -- What they called it. "Sagar's wedding", "Q4 offsite". Shown with the dot.
  label       text        NULL,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz NULL,

  CONSTRAINT user_locations_scope_ref_chk CHECK (
    (scope_type = 'network' AND scope_ref IS NULL) OR
    (scope_type <> 'network' AND scope_ref IS NOT NULL)),

  -- A trip with no start is not a trip, it is a home with a rumour attached.
  CONSTRAINT user_locations_trip_dated_chk CHECK (
    kind <> 'trip' OR starts_at IS NOT NULL),

  -- Time runs forwards.
  CONSTRAINT user_locations_order_chk CHECK (
    starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at)
);

CREATE INDEX IF NOT EXISTS user_locations_owner_idx
  ON user_locations (owner_id, kind) WHERE deleted_at IS NULL;

-- The map query's access path: live rows, by place, by window.
CREATE INDEX IF NOT EXISTS user_locations_live_idx
  ON user_locations (place_id, starts_at, ends_at) WHERE deleted_at IS NULL;

-- ONE STATEMENT PER PLACE PER AUDIENCE PER KIND. Saying "I am in Chicago" to
-- your network twice is one fact and an edit, not two rows that can drift to
-- different precisions and leave the resolver picking the looser one.
CREATE UNIQUE INDEX IF NOT EXISTS user_locations_unique_live
  ON user_locations (owner_id, kind, place_id, scope_type,
                     COALESCE(scope_ref, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE deleted_at IS NULL;

COMMIT;
