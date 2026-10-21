-- ============================================================================
-- A PASSWORD, FOR THE ACCOUNTS THAT HAVE NO PHONE.
--
-- Every account in this service used to be a phone number, so every sign-in was
-- a phone OTP and nothing else was needed. The enterprise fork broke that
-- assumption: an account created from a work email has no phone, so its only
-- door was a link mailed to that address -- and when the mail provider is not
-- configured, or a DNS record has not propagated, that account has NO WAY IN AT
-- ALL. Not a degraded way in. None.
--
-- That is a bad place for a design to put somebody, and it is where this one
-- put its own author an hour before a demo.
--
-- So a work account can also have a password. It is additive and nothing else
-- changes: phone accounts keep signing in by OTP and never see this column,
-- magic links keep working for the people who prefer them.
--
-- WHAT IS STORED. scrypt, from node's own crypto -- no dependency, and the
-- parameters below are the ones that make it worth using: N=16384 is about
-- 100ms per attempt on the hardware this runs on, which is invisible to a
-- person typing their password once and expensive to anybody trying millions.
-- The salt is per-account and random, so two people choosing the same password
-- store different bytes and one cracked hash says nothing about the other.
--
-- The format is `scrypt$<N>$<salt hex>$<hash hex>`, with the parameters inside
-- the value rather than in code, so raising N later does not invalidate every
-- password already stored: an old hash still says how to verify itself.
-- ============================================================================

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash     text        NULL,
  ADD COLUMN IF NOT EXISTS password_set_at   timestamptz NULL;

COMMENT ON COLUMN users.password_hash IS
  'scrypt$N$salt$hash. Null for every phone account, which signs in by OTP.
   Set only on accounts that have no phone and would otherwise have no way in.';

COMMIT;
