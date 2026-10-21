-- Migration 019: Expand EGATS from dance-only to all creative professionals
-- This adds 'creative' as a new role (keeping 'dancer' for existing accounts)
-- and adds a creative_type column to dancer_profiles so each creative
-- can self-identify their primary discipline.

-- ============================================================
-- 1. Add 'creative' to the user_role enum
--    ALTER TYPE ... ADD VALUE is irreversible but safe to run multiple times
--    with the IF NOT EXISTS guard (requires Postgres 9.6+).
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'creative'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
  ) THEN
    ALTER TYPE user_role ADD VALUE 'creative';
  END IF;
END $$;

-- ============================================================
-- 2. Add creative_type column to dancer_profiles
--    Default is 'dancer' so all existing rows stay valid.
-- ============================================================
ALTER TABLE dancer_profiles
  ADD COLUMN IF NOT EXISTS creative_type text NOT NULL DEFAULT 'dancer';

ALTER TABLE dancer_profiles
  ADD CONSTRAINT IF NOT EXISTS creative_type_valid CHECK (
    creative_type IN (
      'dancer', 'musician', 'actor', 'model', 'photographer',
      'videographer', 'director', 'stylist', 'makeup_artist',
      'comedian', 'host', 'visual_artist', 'producer', 'other'
    )
  );

-- ============================================================
-- 3. Add stage_name column if missing (some environments may not have it)
-- ============================================================
ALTER TABLE dancer_profiles
  ADD COLUMN IF NOT EXISTS stage_name text;

-- ============================================================
-- 4. Backfill creative_type from profile role for existing users
-- ============================================================
UPDATE dancer_profiles dp
SET creative_type = 'dancer'
WHERE dp.creative_type = 'dancer';  -- no-op but explicit intent

-- ============================================================
-- 5. Update search index to include creative_type
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_dancer_profiles_creative_type
  ON dancer_profiles (creative_type);

-- ============================================================
-- 6. Add display_order to portfolio_clips if missing
-- ============================================================
ALTER TABLE portfolio_clips
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;
