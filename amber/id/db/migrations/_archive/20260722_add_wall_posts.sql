-- Wall posts: per-user Amber Wall entries, owner-scoped like circles.
-- Apply manually to Cloud SQL before deploying the wall routes.

CREATE TABLE IF NOT EXISTS wall_posts (
  id          bigserial                   PRIMARY KEY,
  owner_id    text                        NOT NULL,
  text        text                        NOT NULL,
  visibility  text                        NOT NULL DEFAULT 'private',
  created_at  timestamptz                 NOT NULL DEFAULT now(),
  updated_at  timestamptz                 NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE INDEX IF NOT EXISTS wall_posts_owner_deleted_idx
  ON wall_posts (owner_id, deleted_at);
