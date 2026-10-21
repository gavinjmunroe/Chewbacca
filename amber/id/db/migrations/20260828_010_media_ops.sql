-- MEDIA, THE VOICE DICTIONARY, AND AUDIT.

-- Bytes live in GCS; this row is the pointer and the upload state machine.
-- status flips to 'ready' only after the server has HEADed the object and
-- confirmed a real size -- a client never declares its own upload complete.
CREATE TABLE media_assets (
  media_id       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       uuid        NOT NULL,
  contact_id     uuid,
  observation_id uuid        REFERENCES observations (observation_id) ON DELETE SET NULL,
  storage_key    text        NOT NULL,
  content_type   text        NOT NULL DEFAULT 'audio/m4a',
  duration_ms    integer     NOT NULL DEFAULT 0,
  byte_size      integer     NOT NULL DEFAULT 0,
  peaks          smallint[]  NOT NULL DEFAULT '{}',
  status         text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CONSTRAINT media_owner_contact_fk FOREIGN KEY (owner_id, contact_id)
    REFERENCES contacts (owner_id, id) ON DELETE CASCADE
);
CREATE INDEX media_owner_contact_idx ON media_assets (owner_id, contact_id) WHERE deleted_at IS NULL;
CREATE INDEX media_observation_idx   ON media_assets (observation_id) WHERE observation_id IS NOT NULL;

-- THE DICTIONARY. Per-owner transcription corrections: names, jargon, the way
-- this particular person says things. Read as a bias prompt before transcription
-- and applied again after, so a correction sticks the first time.
CREATE TABLE voice_vocabulary (
  owner_id     uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  heard        text        NOT NULL,
  corrected_to text        NOT NULL,
  hit_count    integer     NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, heard)
);

-- Who read or wrote what. Not optional for a system holding health-adjacent
-- information about people who never signed up for it.
CREATE TABLE audit_log (
  id             bigserial   PRIMARY KEY,
  actor_amber_id uuid,
  action         text        NOT NULL,
  subject_type   text,
  subject_id     uuid,
  detail         jsonb,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_at_brin    ON audit_log USING BRIN (at);
CREATE INDEX audit_actor_idx  ON audit_log (actor_amber_id, at DESC);
