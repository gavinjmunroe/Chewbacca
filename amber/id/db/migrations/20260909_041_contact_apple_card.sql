-- THE SYNCED ADDRESS BOOK IS A GOLDMINE AND WE WERE THROWING IT AWAY.
--
-- "My cofounder has notes on every single one of his 2,000 Apple contacts --
--  where they met, how well he knows them, where they went to school, their
--  birthday, their nickname, their occupation, their company. He does the Apple
--  sync, asks 'who do I know in New York', and Amber says 'you haven't told me
--  anything about anyone in New York.' Meanwhile he has detailed information
--  about the 200 people he knows in New York. If someone syncs their Apple
--  contacts they have the right to assume that information is being utilized."
--
-- He is right, and it is worse than a missing feature: the sync asked iOS for
-- seven fields (id, name, first, last, phones, emails, company) out of the two
-- dozen it offers. Addresses, job title, department, URLs, dates, relationships,
-- nickname, birthday and notes were never requested, so a book full of answers
-- arrived as a list of names and numbers. Every "I don't have any information"
-- was true of our database and false of his phone.
--
-- WHAT GOES WHERE, and why it is not ten more scalar columns.
--
--   Queryable scalars get columns, because a question like "who do I know in
--   New York" or "whose birthday is today" has to be an indexed lookup and not
--   a jsonb scan over four thousand rows: region, department, contact_tags,
--   area_code, area_metro. (city, title, birthday, apple_notes already exist.)
--
--   Everything else goes in ONE jsonb blob. The full address list, URLs, extra
--   dates, relationships, middle name, country -- real information, rarely the
--   subject of a filter, and ten more columns on the sync path would mean ten
--   more parameters through a three-way merge that was just stabilized. Additive
--   and out of the way beats correct-shaped and destabilizing.
--
-- CONTACT_TAGS IS DERIVED, AND DERIVED FROM THE WHOLE BOOK AT ONCE.
--
-- "There are maybe 30 contacts that have the tag USC in their name. It might not
--  be in their school field, they just add it to their name field like everyone
--  does. If Caleb asks about that it should say 30 contacts have the USC tag."
--
-- A tagline can only be told from a name by comparing one card against all the
-- others -- USC on thirty cards belonging to thirty different people is a label;
-- Park on three is a family. So this column cannot be computed at insert from a
-- single row. It is written by a pass over the owner's whole book after a sync
-- (see retagAddressBook), which is also the only place the corpus exists.
--
-- AREA CODE IS THE FLOOR, NOT A FACT.
--
-- "Area code should be the very bottom ranking for understanding a person's
--  location, but it should still be a factor. If someone has a Chicago area code
--  but lives in Los Angeles, they probably still have connections in Chicago,
--  but their weight for Chicago goes down and Los Angeles goes up."
--
-- Stored separately from `city` on purpose. `city` is what somebody SAID; these
-- three are what a phone number IMPLIES. Keeping them in different columns means
-- a stated city automatically outranks a derived one with no precedence logic at
-- the query, and a mobile number that never moved still counts for something
-- when there is nothing else -- which is the common case for a new user.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS region        text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS department    text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS apple_card    jsonb;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_tags  text[];
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS area_code     text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS area_metro    text;

COMMENT ON COLUMN contacts.contact_tags IS
  'Labels the user typed into the contact NAME to identify the person ("USC", '
  '"BTG", "Plumber"), separated from the name itself by comparing the card '
  'against the rest of the owner''s book. Derived; rewritten by retagAddressBook.';
COMMENT ON COLUMN contacts.area_metro IS
  'The metro a phone number''s area code implies. The weakest location signal '
  'there is, and deliberately not written to `city`: a stated city must always '
  'outrank an inferred one.';

-- ── THE INDEXES, EACH FOR A QUESTION SOMEBODY ACTUALLY ASKED ────────────────
--
-- "Who do I know that goes to USC?" -- a tag containment test over an array.
CREATE INDEX IF NOT EXISTS contacts_tags_gin
  ON contacts USING GIN (contact_tags)
  WHERE deleted_at IS NULL;

-- "Do I know anyone in New York?" -- stated city first, then the inferred metro.
CREATE INDEX IF NOT EXISTS contacts_owner_city
  ON contacts (owner_id, lower(city))
  WHERE deleted_at IS NULL AND city IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_owner_area_metro
  ON contacts (owner_id, area_metro)
  WHERE deleted_at IS NULL AND area_metro IS NOT NULL;

-- "Whose birthday is it today?" -- MONTH AND DAY, not the date. A birthday is
-- indexed by the anniversary, so the year the person was born must not be part
-- of the key or every lookup is a full scan.
-- AT TIME ZONE 'UTC' IS NOT DECORATION, IT IS WHAT MAKES THIS INDEXABLE AT ALL.
-- EXTRACT on a timestamptz reads the SESSION TimeZone, so it is STABLE, not
-- IMMUTABLE, and Postgres refuses it in an index expression outright. Pinning
-- the zone makes the expression deterministic -- and, more importantly, makes
-- the anniversary the same day for every user regardless of what TimeZone the
-- server session happens to carry. A birthday is a calendar date, not an
-- instant; whichever zone it is read in has to be the SAME zone every time or
-- "whose birthday is it today" is off by one for half the world.
-- The query in src/db/gather.js pins 'UTC' the same way. If one side changes,
-- BOTH must, or this index silently stops being used.
CREATE INDEX IF NOT EXISTS contacts_owner_birthday_md
  ON contacts (owner_id,
               (EXTRACT(MONTH FROM (birthday AT TIME ZONE 'UTC'))::int),
               (EXTRACT(DAY   FROM (birthday AT TIME ZONE 'UTC'))::int))
  WHERE deleted_at IS NULL AND birthday IS NOT NULL;

-- "Who works at Stripe?" / "any lawyers?" -- company and title, case-folded.
CREATE INDEX IF NOT EXISTS contacts_owner_company
  ON contacts (owner_id, lower(company))
  WHERE deleted_at IS NULL AND company IS NOT NULL;
