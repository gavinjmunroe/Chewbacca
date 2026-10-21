-- THE CIRCLE'S KIND IS SOMETHING THE USER SAYS, NOT SOMETHING A MODEL GUESSES.
--
-- `classified_kind` was written by an enrichment worker that sent the circle's
-- name and description to a model and got back one of four words: interest,
-- experience, affiliation, other. That decision drove the sectors of the
-- profile web and the flag on every node.
--
-- Three things were wrong with it. The vocabulary was the classifier's, so a
-- circle for your family came back "other" and a circle for your street came
-- back "affiliation" -- correct by the classifier's definitions and useless as a
-- label on a screen. It required a DESCRIPTION to work at all, which is why
-- creating a circle refused to proceed without one. And it was a model call on
-- a write path, for a fact the user knows and could simply have typed.
--
-- So: a free-text tag the user picks. Work, Friends, Family, School are offered;
-- anything else can be typed. Free text rather than an enum on purpose -- the
-- whole failure above was a fixed vocabulary imposed on people's actual lives,
-- and the app has no business telling someone that "Neighbours" or "Climbing"
-- is not a kind of circle. The length cap is enforced in the route.
--
-- classified_kind IS NOT DROPPED. It stays as the provenance of the backfill
-- below, it is what `classified_fact` was generated alongside, and dropping a
-- column in the same migration that stops writing it leaves no way to check the
-- mapping afterwards. It is simply no longer read for the kind.

ALTER TABLE circles ADD COLUMN IF NOT EXISTS kind_tag text;

-- THE BACKFILL, and it is a judgement call stated out loud.
--
--   affiliation -> Work      the classifier defines it as "shared institution,
--                            WORKPLACE, or community", and work is the leading
--                            case by a wide margin
--   experience  -> Friends   "something you did together", which is what a
--                            circle of friends is in practice
--   interest    -> null      an interest is a topic, not a relationship, and
--                            guessing between Friends and something else here
--                            would be inventing information
--   other       -> null      it already means "we could not tell"
--
-- Anything left null shows as untagged and takes one tap to set, which is the
-- honest outcome for a circle whose kind was never actually known.
UPDATE circles
   SET kind_tag = CASE lower(classified_kind)
                    WHEN 'affiliation' THEN 'Work'
                    WHEN 'experience'  THEN 'Friends'
                    ELSE NULL
                  END
 WHERE kind_tag IS NULL
   AND classified_kind IS NOT NULL;

-- The profile web groups by this, so it is read for every circle a user owns on
-- every render of that screen.
CREATE INDEX IF NOT EXISTS circles_kind_tag_idx
  ON circles (owner_id, kind_tag)
  WHERE deleted_at IS NULL;
