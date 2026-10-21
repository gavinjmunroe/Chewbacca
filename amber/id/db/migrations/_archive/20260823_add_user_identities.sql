-- user_identities — one row per (provider, subject) that can sign in as a user.
--
-- WHY THIS EXISTS
-- Identity in this service has been phone-shaped since the beginning:
-- resolveAmberIdByPhone is a get-or-create on users.phone, and 28 route files
-- read request.privyUser.phone. That works exactly until someone signs in with
-- Apple, which never yields a phone number. Rather than widen `users` with an
-- apple_sub column (and then a google_sub column, and then a passkey column),
-- identities get their own table and `users` stays the person.
--
-- ONE HUMAN, ONE ROW IN users. That is the whole point. The Apple sign-in flow
-- deliberately requires a phone + OTP before the account is usable, so the Apple
-- identity is always ATTACHED to a phone-resolved users row rather than creating a
-- parallel one. Without that step Apple's private-relay addresses would guarantee
-- duplicates: a person who signed up by phone in June and taps Sign in with Apple
-- in September has no shared field for us to match on.
--
-- UNIQUENESS
--   (provider, subject) is unique -> an Apple sub can attach to exactly one user,
--   so nobody can bind their Apple ID to somebody else's account by racing.
--   A user MAY have several identities (apple + google + future passkey), and a
--   partial unique index keeps at most one LIVE identity per provider per user.

CREATE TABLE IF NOT EXISTS user_identities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amber_id     uuid        NOT NULL,
  provider     text        NOT NULL CHECK (provider IN ('apple', 'google')),
  -- The provider's stable, app-scoped user id. Apple's `sub`; Google's `sub`.
  subject      text        NOT NULL,
  -- Apple sends this ONLY on the first authorization for an Apple ID, ever. If it
  -- is missed it cannot be recovered without the user revoking the app in iOS
  -- Settings, so it is written once and never overwritten with NULL.
  email        text,
  is_private_email boolean NOT NULL DEFAULT false,
  email_verified   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  deleted_at   timestamptz
);

-- The anti-hijack constraint. Live rows only, so a user who unlinks and relinks
-- their Apple ID is not blocked by their own tombstone.
CREATE UNIQUE INDEX IF NOT EXISTS user_identities_provider_subject_uidx
  ON user_identities (provider, subject)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_identities_user_provider_uidx
  ON user_identities (amber_id, provider)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS user_identities_amber_id_idx
  ON user_identities (amber_id)
  WHERE deleted_at IS NULL;
