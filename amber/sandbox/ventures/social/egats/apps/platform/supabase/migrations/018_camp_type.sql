-- Add camp type categorization
DO $$ BEGIN
  CREATE TYPE camp_type AS ENUM ('masterclass', 'workshop', 'audition_prep', 'residency', 'open_call', 'competition');
EXCEPTION WHEN duplicate_object THEN NULL;
END; $$;

ALTER TABLE camps ADD COLUMN IF NOT EXISTS camp_type camp_type DEFAULT 'workshop';
ALTER TABLE camps ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';

COMMENT ON COLUMN camps.camp_type IS 'Category of camp: masterclass, workshop, audition_prep, residency, open_call, competition';
