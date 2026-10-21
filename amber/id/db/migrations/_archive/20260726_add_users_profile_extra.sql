-- Chunk 4a: give amber `users` a home for profile fields that have no discrete
-- column, so getProfile/upsertProfile can move off Firestore without dropping
-- them. The Firestore users/{did}/profile/main doc stored arbitrary keys; the
-- fixed-column amber users table cannot. profile_extra jsonb holds the overflow
-- (pronouns, birthday, birthdayTime, birthLocation, almaMater, preferredTone,
-- scheduleAffinity, communicationStyle, contentHash, checkInSchedule, and any
-- future profile key the discrete columns don't cover).
--
-- Additive + idempotent: the discrete profile columns (full_name, current_city,
-- occupation, bio, mbti, school, hometown, horoscope, avatar_url, privacy_tier,
-- onboarding_completed_at, timezone, username) are unchanged.

ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_extra jsonb;
