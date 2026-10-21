-- Migration 007: Constraints and Defaults
-- Adds data integrity constraints and updated_at automation for culture tables

-- Ensure experience_years is reasonable
ALTER TABLE dancer_profiles ADD CONSTRAINT IF NOT EXISTS experience_years_range CHECK (experience_years >= 0 AND experience_years <= 80);

-- Ensure ratings are 1-5
ALTER TABLE reviews ADD CONSTRAINT IF NOT EXISTS rating_range CHECK (rating >= 1 AND rating <= 5);

-- Ensure tier scores are 1-5
ALTER TABLE verification_records ADD CONSTRAINT IF NOT EXISTS score_technique_range CHECK (score_technique IS NULL OR (score_technique >= 1 AND score_technique <= 5));
ALTER TABLE verification_records ADD CONSTRAINT IF NOT EXISTS score_professionalism_range CHECK (score_professionalism IS NULL OR (score_professionalism >= 1 AND score_professionalism <= 5));
ALTER TABLE verification_records ADD CONSTRAINT IF NOT EXISTS score_collaboration_range CHECK (score_collaboration IS NULL OR (score_collaboration >= 1 AND score_collaboration <= 5));
ALTER TABLE verification_records ADD CONSTRAINT IF NOT EXISTS score_on_camera_range CHECK (score_on_camera IS NULL OR (score_on_camera >= 1 AND score_on_camera <= 5));
ALTER TABLE verification_records ADD CONSTRAINT IF NOT EXISTS score_communication_range CHECK (score_communication IS NULL OR (score_communication >= 1 AND score_communication <= 5));
ALTER TABLE verification_records ADD CONSTRAINT IF NOT EXISTS score_learning_speed_range CHECK (score_learning_speed IS NULL OR (score_learning_speed >= 1 AND score_learning_speed <= 5));

-- Ensure bookings have valid date order
ALTER TABLE bookings ADD CONSTRAINT IF NOT EXISTS booking_date_order CHECK (end_date IS NULL OR end_date >= start_date);

-- Add updated_at to tables missing it
ALTER TABLE culture_posts ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE culture_circles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE culture_challenges ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- Triggers for culture tables
DROP TRIGGER IF EXISTS culture_posts_updated_at ON culture_posts;
CREATE TRIGGER culture_posts_updated_at BEFORE UPDATE ON culture_posts FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS culture_circles_updated_at ON culture_circles;
CREATE TRIGGER culture_circles_updated_at BEFORE UPDATE ON culture_circles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS culture_challenges_updated_at ON culture_challenges;
CREATE TRIGGER culture_challenges_updated_at BEFORE UPDATE ON culture_challenges FOR EACH ROW EXECUTE FUNCTION update_updated_at();
