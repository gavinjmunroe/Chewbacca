-- FIVE COLUMNS SIGN IN WITH APPLE NEEDS BACK.
--
-- Migration 002 rebuilt user_identities as
-- (provider, subject, amber_id, verified_at, created_at) with
-- PRIMARY KEY (provider, subject). src/db/user-identities-store.js was written
-- against a richer shape and reads six columns that no longer exist -- id, email,
-- email_verified, is_private_email, last_used_at, deleted_at -- so every query in
-- that file throws and Apple identity linking has been dead since the rebuild.
--
-- THIS IS THE ONE PLACE WHERE THE CODE WAS RIGHT AND THE MIGRATION WAS WRONG, and
-- the reason is Apple's, not ours:
--
--   APPLE SENDS THE EMAIL EXACTLY ONCE, on the first authorization. Every later
--   sign-in carries the subject and nothing else. Drop the column and the address
--   is not "recomputable later" -- it is gone, for that user, permanently.
--
--   is_private_email marks a @privaterelay.appleid.com address, which behaves
--   differently: mail to it can be switched off by the user at any time, so it
--   cannot be treated as a durable contact address.
--
--   email_verified is Apple's own claim about the address and belongs with it.
--
--   last_used_at answers "is this login still in use", which is what you want
--   before removing a provider or diagnosing a locked-out account.
--
--   deleted_at makes "remove Sign in with Apple" reversible and keeps the history
--   of a link that existed, rather than erasing the fact.
--
-- NO SURROGATE id. The store used one; (provider, subject) is already the primary
-- key and is the natural identity of a provider login. Adding a serial would give
-- the table two identities and let them disagree.
--
-- NO NEW INDEX. One row per provider per user; the primary key serves the lookup
-- that matters (provider, subject). listIdentitiesForUser filters on amber_id
-- without one, which is a sequential scan over a table with a handful of rows per
-- account and thousands overall -- worth revisiting if that ever stops being true,
-- not worth an index today.

ALTER TABLE user_identities
  ADD COLUMN IF NOT EXISTS email            text,
  ADD COLUMN IF NOT EXISTS email_verified   boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_private_email boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_used_at     timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at       timestamptz;

-- verified_at predates this and means "the provider assertion was verified".
-- email_verified is a different claim about a different thing; neither replaces
-- the other, and this comment exists so nobody merges them later.
COMMENT ON COLUMN user_identities.verified_at IS
  'When the provider assertion itself was verified. Not about the email address.';
COMMENT ON COLUMN user_identities.email_verified IS
  'Apple''s claim that the address on this identity is verified. Not about the assertion.';
