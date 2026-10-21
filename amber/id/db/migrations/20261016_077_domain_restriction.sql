-- ============================================================================
-- THE EMAIL DOMAIN BECOMES A RULE, NOT A HINT.
--
-- organizations.email_domain has been stored since the org spine landed and
-- has never been enforced anywhere. The setup wizard called it "a check, not a
-- key: it warns you when you invite an address outside it" -- and it did not
-- even do that, because nothing read the column.
--
-- A company that says "only @paychex.com" means it. So the domain gets a
-- companion flag and createInvite refuses an address outside it.
--
-- WHY A FLAG AND NOT JUST "THE DOMAIN IS SET".
--
-- Those are two different sentences and both are wanted. A company with
-- contractors, agency partners or a founder still on a personal address needs
-- to say "we are paychex.com" -- for labelling, for the join screen, for
-- knowing which address to suggest -- without locking the door on everybody
-- who is not. Collapsing the two would force a company to delete its own
-- domain in order to invite one consultant.
--
-- WHAT THIS IS NOT: an auto-join. Matching the domain never admits anybody.
-- An invitation is still the only way in, and this only narrows which
-- addresses may be sent one. A domain that let anybody in would make every
-- ex-employee's lingering Google account a live key.
-- ============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS restrict_domain boolean NOT NULL DEFAULT false;

-- A restriction with nothing to restrict against would silently refuse every
-- invitation, which is the kind of setting that looks like an outage.
ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_restrict_needs_domain;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_restrict_needs_domain
  CHECK (restrict_domain = false OR email_domain IS NOT NULL);
