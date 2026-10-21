-- ============================================================================
-- A SIGN-IN NAME IS NOT A PROFILE HANDLE, AND MIGRATION 069 CONFLATED THEM.
--
-- users.username already existed. It has been there since the first identity
-- migration in August, it is a consumer PROFILE field -- free-form, listed in
-- field-policy.js as baseline-visible, shown to people in your network -- and
-- 069's `ADD COLUMN IF NOT EXISTS username` was therefore a silent no-op that
-- quietly adopted it as a credential.
--
-- THREE THINGS WERE WRONG WITH THAT, and the first is the one that showed up:
--
-- 1. The same human's two accounts collide. A personal Amber with the handle
--    "karthik" makes "karthik" unavailable to that same person's work account,
--    with the error "that username is already in use" -- which is true and
--    reads as a lie.
--
-- 2. Changing a display name would change a credential. Someone editing their
--    profile handle in the iOS app would silently change what they sign in
--    with, and find out the next time they tried.
--
-- 3. A login identifier would be a baseline-visible profile field. Half of a
--    credential, published to everyone you know, by a policy written for a
--    display name.
--
-- AND 069's CHECK CONSTRAINT WAS A LATENT BREAK OF THE CONSUMER APP. It
-- required lowercase and a narrow character set on a column the app has always
-- let people type freely into, so the first person to set a profile handle
-- with a capital letter would have hit a constraint violation from a feature
-- they were not using.
--
-- So: a separate column. login_username is a credential and nothing else --
-- not in field-policy, not returned by any profile read, never shown to
-- anybody but its owner. users.username goes back to being what it was.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- PUT THE PROFILE FIELD BACK
-- ---------------------------------------------------------------------------

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_shape;
DROP INDEX IF EXISTS users_username_unique;

COMMENT ON COLUMN users.username IS
  'A consumer PROFILE handle, free-form and visible. NOT a credential --
   see login_username, and migration 072 for why they are two columns.';

-- ---------------------------------------------------------------------------
-- THE CREDENTIAL
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS login_username text NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_login_username_shape;
ALTER TABLE users ADD CONSTRAINT users_login_username_shape
  CHECK (login_username IS NULL OR login_username ~ '^[a-z0-9][a-z0-9._-]{2,31}$');

CREATE UNIQUE INDEX IF NOT EXISTS users_login_username_unique
  ON users (login_username)
  WHERE login_username IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN users.login_username IS
  'What this account signs in with, alongside its email. Lowercase; the CHECK
   is the only normalizer, so there is one spelling of any login name. Never
   returned by a profile read and never shown to anybody but its owner.';

COMMIT;
