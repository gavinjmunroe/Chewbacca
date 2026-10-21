-- REPAIR. 20260805_add_contact_favorites.sql is missing two columns and one index
-- that the application has depended on ever since.
--
-- favorites-store.js added `tags` and `position` as lazy ALTERs rather than by
-- amending the migration, so the migration and the running database diverged: any
-- database built from db/migrations alone came up without them, and every read in
-- favorites-store.js failed. This closes that gap.
--
-- Idempotent and additive. A database that already has these columns (i.e. every
-- environment the app has ever booted against) is unaffected.

ALTER TABLE contact_favorites
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

-- MANUAL ORDER. Favorites are a 4x4 grid the user arranges by hand, so the order
-- is data, not a side effect of when each was pinned. NULL means "never explicitly
-- placed" and sorts after everything that was, so existing rows keep their
-- newest-first order until the user drags something.
ALTER TABLE contact_favorites
  ADD COLUMN IF NOT EXISTS position integer;

-- GIN so "who do I know from work?" can filter by tag without a table scan.
CREATE INDEX IF NOT EXISTS idx_contact_favorites_tags
  ON contact_favorites USING GIN (tags);
