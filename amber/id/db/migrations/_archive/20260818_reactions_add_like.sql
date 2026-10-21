-- Widen the tapback vocabulary: add 'like' (thumbs up).
--
-- The client's reaction set grew from four to five (emphasis, like, dislike, laugh,
-- question). `kind` is guarded by a CHECK constraint rather than an enum type, so the
-- constraint has to be replaced before any client can write the new value — until it
-- is, every thumbs-up tap fails the check, the transaction rolls back, and the app
-- shows "Couldn't save that reaction."
--
-- SAFE TO RE-RUN, and safe to run while the old app version is live: this only WIDENS
-- what is accepted. No existing row can violate the new constraint, because the new
-- set is a superset of the old one, so there is nothing to backfill and nothing to
-- fix up afterwards. Deliberately does not use NOT VALID: note_reactions is small and
-- a full validation scan here costs nothing.
--
--   railway run node scripts/apply-reactions-migration.js
--
-- Rolling BACK the client without rolling back this migration is fine (a wider
-- constraint accepts a narrower client). Rolling back this migration while the new
-- client is live is not — drop it only after any 'like' rows are gone.

ALTER TABLE note_reactions
  DROP CONSTRAINT IF EXISTS note_reactions_kind_chk;

ALTER TABLE note_reactions
  ADD CONSTRAINT note_reactions_kind_chk
  CHECK (kind IN ('emphasis','like','dislike','laugh','question'));
