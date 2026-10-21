-- CONTACTS -- the link table, ported whole. See 002 for why every column stays.
CREATE TABLE contacts (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_phone                text,
  full_name                  text,
  first_name                 text,
  last_name                  text,
  phone_primary              text,
  phones_all                 text,
  emails                     text,
  company                    text,
  title                      text,
  city                       text,
  apple_notes                text,
  created_at                 timestamptz DEFAULT now() NOT NULL,
  deleted_at                 timestamptz,
  owner_id                   uuid NOT NULL,
  external_id                text,
  source                     text,
  updated_at                 timestamptz DEFAULT now() NOT NULL,
  linked_amber_id            uuid,
  location                   text,
  birthday                   timestamptz,
  avatar_url                 text,
  linkedin_url               text,
  twitter_url                text,
  github_url                 text,
  website                    text,
  relationship_type          text,
  relationship_score         real,
  tags                       text[],
  message_frequency          real,
  interaction_count          integer DEFAULT 0 NOT NULL,
  last_interaction_at        timestamptz,
  last_contacted_at          timestamptz,
  metadata                   jsonb,
  raw                        jsonb,
  phone_primary_normalized   text,
  enrichment                 jsonb,
  enrichment_status          text,
  enriched_at                timestamptz,
  enrichment_candidates      jsonb,
  CONSTRAINT contacts_pkey PRIMARY KEY (id),
  CONSTRAINT contacts_owner_fk FOREIGN KEY (owner_id) REFERENCES users (amber_id) ON DELETE CASCADE,
  CONSTRAINT contacts_linked_fk FOREIGN KEY (linked_amber_id) REFERENCES users (amber_id) ON DELETE SET NULL,
  -- THE COMPOSITE FK TARGET. Every private table in the schema points here.,
  CONSTRAINT contacts_owner_id_uq UNIQUE (owner_id, id)
);

CREATE INDEX contacts_owner_name_idx  ON contacts (owner_id, full_name) WHERE deleted_at IS NULL;
CREATE INDEX contacts_name_trgm_idx   ON contacts USING GIN (full_name gin_trgm_ops);
CREATE INDEX contacts_linked_idx      ON contacts (linked_amber_id) WHERE linked_amber_id IS NOT NULL;
CREATE INDEX contacts_owner_phone_idx ON contacts (owner_id, phone_primary_normalized) WHERE deleted_at IS NULL;
CREATE INDEX contacts_tags_idx        ON contacts USING GIN (tags);
CREATE INDEX contacts_external_idx    ON contacts (owner_id, source, external_id) WHERE deleted_at IS NULL;

-- HASHED PHONE AND EMAIL PER CARD.
--
-- THE PRIMARY KEY IS THE DEDUP MECHANISM, not bookkeeping. Within one owner's
-- address book a key belongs to exactly ONE contact, and write-time dedup is
-- built entirely on that: claimIdentityKeys inserts ON CONFLICT DO NOTHING and
-- reads the rows that did NOT insert as "somebody already holds this number,
-- here is who." My first draft keyed this (owner_id, contact_id, key_type,
-- key_hash), which lets two contacts of one owner hold the same number -- the
-- conflict would never fire, no duplicate would ever be reported, and the exact
-- failure this table was created to end (2,245 contacts becoming 4,162 across
-- two syncs) would come back silently. One owner, one key, one contact.
--
-- A household line shared by "Mom" and "Dad" is not an exception to that: the
-- second card LOSES the claim and the pair is recorded as a same_phone_as review
-- link instead, which is invariant I2 in lib/contact-identity.js.
--
-- THE THREE INDEXES ARE THE WHOLE PRODUCT:
--   (owner_id, key_type, key_hash)  the PK. Dedupe your own book, and answer
--                         "who here already holds this key" in one lookup.
--   (owner_id, contact_id)  the reverse: every key one card claims, for merges
--                         and repointing.
--   (key_hash)            global. Answers "who has this number", which is what
--                         lets a signup notify everyone holding that contact.
--                         NO USER-FACING PATH MAY QUERY THIS -- only the signup
--                         job. A user-facing reverse lookup turns the product
--                         into a surveillance tool.
CREATE TABLE contact_identity_keys (
  owner_id   uuid        NOT NULL,
  contact_id uuid        NOT NULL,
  -- 1 phone, 2 email, 3 source (a provider's own id for the card). All three
  -- hashed, so the claim mechanism has no special case -- see lib/identity-keys.js.
  key_type   smallint    NOT NULL CHECK (key_type IN (1, 2, 3)),
  key_hash   bytea       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, key_type, key_hash),
  CONSTRAINT cik_len_chk CHECK (octet_length(key_hash) = 16),
  CONSTRAINT cik_owner_contact_fk FOREIGN KEY (owner_id, contact_id)
    REFERENCES contacts (owner_id, id) ON DELETE CASCADE
);
CREATE INDEX cik_owner_contact_idx ON contact_identity_keys (owner_id, contact_id);
CREATE INDEX cik_hash_idx          ON contact_identity_keys (key_hash);

-- Favorites: the people hand-picked into the Amber Network grid. contact_id was
-- TEXT here while contacts.id was BIGINT, which is the exact pair that made the
-- join raise and the screen say "no favorites" for weeks.
CREATE TABLE contact_favorites (
  id         bigserial   PRIMARY KEY,
  owner_id   uuid        NOT NULL,
  contact_id uuid        NOT NULL,
  tags       text[]      NOT NULL DEFAULT '{}',
  position   integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, contact_id),
  CONSTRAINT fav_owner_contact_fk FOREIGN KEY (owner_id, contact_id)
    REFERENCES contacts (owner_id, id) ON DELETE CASCADE
);
CREATE INDEX contact_favorites_owner_idx ON contact_favorites (owner_id);
CREATE INDEX contact_favorites_tags_idx  ON contact_favorites USING GIN (tags);
