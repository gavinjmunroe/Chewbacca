-- EVENTS CAN INVOLVE MORE THAN ONE PERSON.
--
-- events carries contact_id OR circle_id and nothing else, so "dinner with
-- Maya, John and David" had no representation: one event named one person, or
-- three events named one each. Facts already solved this with
-- observation_participants; events did not, and events are what recency and
-- cadence in PeopleRank are computed from -- so a group dinner credited exactly
-- one of the three people who were there.
--
-- WHY A TABLE AND NOT A uuid[] COLUMN ON events. An array cannot carry the
-- composite foreign key, so deleting a contact would leave their id sitting in
-- the array pointing at nothing. It cannot carry per-person information --
-- who organised it, who declined -- which is the first thing anyone asks for.
-- And "which events involved this contact" becomes an array scan rather than an
-- index seek. observation_participants is the same shape and has been fine.
--
-- events.contact_id STAYS. The one-person case is the common one and every
-- existing query keeps working; this table carries the rest. A single-participant
-- event may appear in both, which is not duplication -- contact_id is the
-- event's subject, participants are everyone present.
--
-- OWNERSHIP IS UNCHANGED: owner_id -> users.amber_id, contact_id is one of that
-- owner's own contacts, and the composite FK makes it impossible to attach one
-- tenant's contact to another tenant's event.

CREATE TABLE event_participants (
  event_id   uuid NOT NULL REFERENCES events (event_id) ON DELETE CASCADE,
  owner_id   uuid NOT NULL,
  contact_id uuid NOT NULL,
  role       text NOT NULL DEFAULT 'participant'
             CHECK (role IN ('participant', 'organizer', 'declined')),
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, contact_id),
  CONSTRAINT ep_owner_contact_fk FOREIGN KEY (owner_id, contact_id)
    REFERENCES contacts (owner_id, id) ON DELETE CASCADE
);

-- The reverse lookup: every event a given contact was part of. This is the
-- direction the rollup reads, so it is the direction that needs the index --
-- the primary key already covers event_id.
CREATE INDEX event_participants_contact_idx
  ON event_participants (owner_id, contact_id);
