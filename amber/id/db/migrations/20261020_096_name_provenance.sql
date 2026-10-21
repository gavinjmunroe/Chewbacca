-- ---------------------------------------------------------------------------
-- WHERE A NAME CAME FROM, SO A BETTER ONE CAN REPLACE IT.
--
-- A person first seen as an address is named by chopping up that address:
-- ipandey@stanford.edu became "Ipandey". That is a reasonable placeholder and
-- a terrible name, and the upgrade path could never replace it, because it
-- only overwrote a display_name that still contained an "@". So the one case
-- the upgrade existed for -- Google hands us "Ipsha Pandey" on the next
-- invite -- was the case it skipped, and every node in the graph stayed a
-- mangled address forever.
--
-- The missing fact is not "is this name good" but "who said it". A name we
-- invented from an address yields to a name a provider sent. A name a person
-- typed yields to nobody.
-- ---------------------------------------------------------------------------

ALTER TABLE org_people
  ADD COLUMN IF NOT EXISTS name_source text NOT NULL DEFAULT 'address';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_people_name_source_known'
  ) THEN
    ALTER TABLE org_people
      ADD CONSTRAINT org_people_name_source_known
      CHECK (name_source IN ('address', 'provider', 'human'));
  END IF;
END $$;

-- Everything that exists today is treated as address-derived, which is what
-- nearly all of it is. A provider name that is already correct is simply
-- written again with the same value on the next pass: a no-op, not a loss.
