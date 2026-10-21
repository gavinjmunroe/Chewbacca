-- ---------------------------------------------------------------------------
-- 093 — WHAT THE COMPANY IS, IN ITS OWN WORDS.
--
-- WHY A DESCRIPTION IS NOT DECORATION HERE. Amber's answers are grounded in
-- one company's own material, and a model reading a relationship ledger with
-- no idea what the company DOES has to infer it from meeting titles. "Call
-- with Harris at Para" means something different at a venture fund, a
-- staffing firm and a medical device company, and the difference changes what
-- a useful answer looks like.
--
-- It is also the first thing an administrator can say about themselves during
-- setup, which matters for a reason that has nothing to do with models: a
-- setup flow that only takes extractive details -- your domain, your billing,
-- your seat count -- reads as a form. One that asks what you do reads as an
-- introduction.
--
-- NULLABLE, AND NOT PROMPTED TWICE. Somebody who skips it gets a product that
-- works slightly less well and is never nagged. A required field here would
-- be filled with "asdf" by a third of people, which is worse than empty
-- because it is indistinguishable from an answer.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS description text NULL;

-- A public page, when there is one. Kept separate from the description
-- because they answer different questions and one is a URL somebody can
-- click: "what do you do" and "where do I read more" are not the same field.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS website text NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS linkedin_url text NULL;

COMMENT ON COLUMN organizations.description IS
  'What this company does, in its own words. Grounds the assistant: a
   relationship ledger read without it has to infer the business from meeting
   titles, and the same meeting means different things at a fund and a
   staffing firm.';

COMMIT;
