-- PINNED CIRCLES. The nine circles the user wants on their profile, in the
-- order they dragged them into.
--
-- A DELIBERATE MIRROR of contact_favorites (003), down to the nullable
-- `position` and the composite owner FK, because the two features are the same
-- feature pointed at different rows and the client reuses the same drag
-- machinery for both. Anything clever here would be a second set of rules for
-- one interaction.
--
--   * position IS NULLABLE, and that is what lets hand-arranged order and
--     never-dragged order coexist without a backfill: the read is
--     `ORDER BY position ASC NULLS LAST, created_at DESC`, so a circle the user
--     has placed leads and anything they have only pinned trails behind it
--     newest-first. Making it NOT NULL DEFAULT 0 would have put every unplaced
--     circle in a tie the database breaks however it likes, which reads as the
--     grid shuffling itself.
--
--   * THE COMPOSITE FK (owner_id, circle_id) -> circles (owner_id, id) does two
--     jobs. It cascades the pin away when the circle is hard-deleted, and it
--     makes it structurally impossible to pin a circle belonging to somebody
--     else -- the pair has to exist in `circles`, so a stolen circle id with
--     your own owner_id matches no row and the insert fails. A single-column FK
--     on circle_id would have accepted it.
--
--   * NO CAP HERE. Nine is enforced in the route, for the same reason sixteen
--     is for contacts: the pin write is an upsert, and re-pinning something
--     already in the nine must not be rejected for being over the limit. The
--     route knows which case it is; the table just holds rows.
--
-- Soft-deleted circles (circles.deleted_at) keep their pin row on purpose. The
-- read joins on deleted_at IS NULL so they vanish from the grid, and if the
-- circle is ever restored its place comes back with it.

CREATE TABLE IF NOT EXISTS circle_favorites (
  id         bigserial   PRIMARY KEY,
  owner_id   uuid        NOT NULL,
  circle_id  uuid        NOT NULL,
  position   integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, circle_id),
  CONSTRAINT circle_fav_owner_circle_fk FOREIGN KEY (owner_id, circle_id)
    REFERENCES circles (owner_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS circle_favorites_owner_idx ON circle_favorites (owner_id);
