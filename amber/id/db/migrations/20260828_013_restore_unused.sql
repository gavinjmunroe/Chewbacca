-- THE NINE TABLES THAT HAD NEVER HELD A ROW.
--
-- I dropped these on the reasoning that an empty table is a feature nobody uses.
-- That was wrong: they are empty because the features have not shipped yet, not
-- because they do not matter. Restored, and this time wired into the new core
-- rather than floating beside it -- every owner_id is uuid with a real foreign
-- key, every contact_id is uuid with a composite key, and the two that reference
-- other rows finally say so.
--
-- shares is NOT here: it is already defined in 004 with a forward-looking
-- item_type vocabulary. The old one accepted 'experience', 'post' and
-- 'interaction'; experiences and interactions are absorbed into observations, so
-- 004 now reads ('observation','event','media','post','circle_feed') -- 'post'
-- kept because wall_posts survives.

-- WHAT OTHERS MAY SEE OF *YOU*, field by field. A third permission concept,
-- distinct from the other two and deliberately so:
--   permissions         which of MY OWN fields are disclosed at all
--   shares              which of my ITEMS a given audience can see
--   network_visibility  how deep into my GRAPH a given audience may walk
CREATE TABLE permissions (
  id          bigserial   PRIMARY KEY,
  owner_id    uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  field_type  text        NOT NULL,
  allowed     boolean     NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, field_type)
);

-- Every change to the above, append-only. A permission that silently flipped is
-- the kind of thing you can only investigate if it was written down.
CREATE TABLE permission_audit (
  id         bigserial   PRIMARY KEY,
  owner_id   uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  entry      jsonb       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX permission_audit_owner_idx ON permission_audit (owner_id, created_at DESC);

-- Horoscope, Myers-Briggs, enneagram, big five. Deliberately NOT the six
-- dimensions of health: these describe a fixed disposition, dimensions describe
-- a changing situation. Conflating them would let a personality type decay on a
-- half-life, which is nonsense.
CREATE TABLE personality_profiles (
  id           bigserial   PRIMARY KEY,
  owner_id     uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  profile_type text        NOT NULL,
  data         jsonb       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  UNIQUE (owner_id, profile_type)
);

-- THE FEEDBACK LOOP, and the most consequential table in this file.
--
-- A thumbs up or down on a ranked person. This is the input that tunes
-- user_dimension_weights: when you reject a suggestion, the job looks at which
-- dimensions drove that contact's score and nudges YOUR weights down. That is
-- how "financial shouldn't count this much for me" gets learned -- parameter
-- fitting against a table you can read, not opaque model training.
--
-- dimension_id is nullable: a plain thumbs-down carries no dimension, while
-- feedback given on a dimension-specific answer does, and the second kind is far
-- more useful for tuning.
CREATE TABLE people_rank_feedback (
  id           bigserial   PRIMARY KEY,
  owner_id     uuid        NOT NULL,
  contact_id   uuid        NOT NULL,
  dimension_id smallint    REFERENCES dimensions (dimension_id),
  signal       integer     NOT NULL CHECK (signal BETWEEN -1 AND 1),
  query_text   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, contact_id, dimension_id),
  CONSTRAINT prf_owner_contact_fk FOREIGN KEY (owner_id, contact_id)
    REFERENCES contacts (owner_id, id) ON DELETE CASCADE
);
CREATE INDEX prf_dimension_idx ON people_rank_feedback (owner_id, dimension_id, created_at DESC);

-- Turns of an Amber<->user conversation inside a question thread. thread_id had
-- no foreign key in prod; it does now, so a thread cannot be deleted out from
-- under its own messages.
CREATE TABLE thread_messages (
  id         bigserial   PRIMARY KEY,
  thread_id  bigint      NOT NULL REFERENCES question_threads (id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('amber','user')),
  content    text        NOT NULL,
  metadata   jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX thread_messages_thread_created_idx ON thread_messages (thread_id, created_at);

-- "Introduce me to this person in your book." Three real references now: the
-- asker, the owner, and the card being asked about -- the last as a composite
-- key, so a request can never point at a contact its owner does not have.
CREATE TABLE intro_requests (
  id                 bigserial   PRIMARY KEY,
  requester_amber_id uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  owner_id           uuid        NOT NULL,
  contact_id         uuid        NOT NULL,
  message            text,
  status             text        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','approved','declined')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  responded_at       timestamptz,
  deleted_at         timestamptz,
  CONSTRAINT ir_owner_contact_fk FOREIGN KEY (owner_id, contact_id)
    REFERENCES contacts (owner_id, id) ON DELETE CASCADE
);
-- owner_amber_id in prod is owner_id here, so it matches every other table and
-- can carry the composite key.
CREATE INDEX intro_requests_owner_status_idx     ON intro_requests (owner_id, status) WHERE deleted_at IS NULL;
CREATE INDEX intro_requests_requester_status_idx ON intro_requests (requester_amber_id, status) WHERE deleted_at IS NULL;
-- One live ask per person per card. A second request while one is pending is a
-- duplicate, not a nudge.
CREATE UNIQUE INDEX intro_requests_pending_uidx ON intro_requests (requester_amber_id, owner_id, contact_id)
  WHERE status = 'pending' AND deleted_at IS NULL;

CREATE TABLE onboarding_progress (
  owner_id   uuid        PRIMARY KEY REFERENCES users (amber_id) ON DELETE CASCADE,
  progress   jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One Clay webhook per user. webhook_url IS A CREDENTIAL -- Clay's URLs end in an
-- opaque id and holding it is enough to write into someone's Clay table. Masked
-- for display, never logged.
CREATE TABLE clay_destinations (
  owner_id        uuid        PRIMARY KEY REFERENCES users (amber_id) ON DELETE CASCADE,
  webhook_url     text        NOT NULL,
  label           text,
  mode            text        NOT NULL DEFAULT 'object' CHECK (mode IN ('object','array')),
  auth_token      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_push_at    timestamptz,
  last_push_count integer     NOT NULL DEFAULT 0
);
