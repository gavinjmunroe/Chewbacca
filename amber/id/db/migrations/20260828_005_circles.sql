-- CIRCLES. Ported whole, same reasoning as contacts in 003: the live table's
-- columns are what the code reads, so they all survive and only id and owner_id
-- change.
--
-- MEMBERS ARE CONTACTS, NOT ACCOUNTS. You must be able to put someone in a circle
-- who has never heard of Amber; they simply see nothing until they sign up and
-- the card links. Visibility resolves at read time through the contact, so a
-- membership change takes effect instantly.

CREATE TABLE circles (
  id                       uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id                 uuid NOT NULL,
  name                     text NOT NULL,
  color                    text,
  created_at               timestamptz DEFAULT now() NOT NULL,
  updated_at               timestamptz DEFAULT now() NOT NULL,
  deleted_at               timestamptz,
  description              text,
  classified_kind          text,
  classified_fact          text,
  classified_at            timestamptz,
  CONSTRAINT circles_pkey PRIMARY KEY (id),
  CONSTRAINT circles_owner_fk FOREIGN KEY (owner_id) REFERENCES users (amber_id) ON DELETE CASCADE,
  CONSTRAINT circles_owner_id_uq UNIQUE (owner_id, id)
);
CREATE INDEX circles_owner_idx ON circles (owner_id) WHERE deleted_at IS NULL;

CREATE TABLE circle_members (
  circle_id  uuid        NOT NULL,
  contact_id uuid        NOT NULL,
  owner_id   uuid        NOT NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (circle_id, contact_id),
  CONSTRAINT cm_owner_circle_fk  FOREIGN KEY (owner_id, circle_id)
    REFERENCES circles  (owner_id, id) ON DELETE CASCADE,
  CONSTRAINT cm_owner_contact_fk FOREIGN KEY (owner_id, contact_id)
    REFERENCES contacts (owner_id, id) ON DELETE CASCADE
);
CREATE INDEX cm_contact_idx ON circle_members (owner_id, contact_id);

-- Per-viewer "opened" state, so a circle's unseen dot clears.
CREATE TABLE circle_member_seen (
  viewer_amber_id uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  circle_id       uuid        NOT NULL REFERENCES circles (id) ON DELETE CASCADE,
  seen_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (viewer_amber_id, circle_id)
);
