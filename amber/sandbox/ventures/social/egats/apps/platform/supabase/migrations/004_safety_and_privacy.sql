-- ============================================================
-- Migration 004: Safety and Privacy Features
-- Covers:
--   1. safety_reports table (harassment/misconduct reporting)
--   2. privacy_settings table (dancer visibility controls)
--   3. consent_records table (photo/video release at camps)
--   4. blocked_users table
--   5. RLS policies for all four tables
--   6. Trigger: auto-create default privacy_settings on new profile
-- ============================================================


-- ============================================================
-- 1. SAFETY REPORTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.safety_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reported_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('harassment', 'inappropriate_content', 'fraud', 'impersonation', 'underage', 'other')),
  description text NOT NULL,
  related_booking_id uuid REFERENCES public.bookings(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'resolved', 'dismissed')),
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.safety_reports ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can file a report
CREATE POLICY "safety_reports_auth_insert" ON public.safety_reports
  FOR INSERT WITH CHECK (auth.uid() = reporter_id);

-- Reporters can only see their own reports
CREATE POLICY "safety_reports_own_select" ON public.safety_reports
  FOR SELECT USING (auth.uid() = reporter_id);

-- Admins can see and update all reports
CREATE POLICY "safety_reports_admin_select" ON public.safety_reports
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'admin'
    )
  );

CREATE POLICY "safety_reports_admin_update" ON public.safety_reports
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'admin'
    )
  );

-- Index for admin queue lookups
CREATE INDEX IF NOT EXISTS idx_safety_reports_status ON public.safety_reports(status);
CREATE INDEX IF NOT EXISTS idx_safety_reports_reporter ON public.safety_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_safety_reports_reported ON public.safety_reports(reported_user_id);


-- ============================================================
-- 2. PRIVACY SETTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.privacy_settings (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  profile_visible_to text NOT NULL DEFAULT 'verified_recruiters' CHECK (
    profile_visible_to IN ('everyone', 'verified_recruiters', 'tier2_recruiters', 'nobody')
  ),
  show_contact_info boolean NOT NULL DEFAULT false,
  show_phone boolean NOT NULL DEFAULT false,
  allow_ai_matching boolean NOT NULL DEFAULT true,
  allow_direct_messages boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.privacy_settings ENABLE ROW LEVEL SECURITY;

-- Users manage their own settings
CREATE POLICY "privacy_settings_own_select" ON public.privacy_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "privacy_settings_own_insert" ON public.privacy_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "privacy_settings_own_update" ON public.privacy_settings
  FOR UPDATE USING (auth.uid() = user_id);

-- Verified recruiters can read privacy settings for dancers who have not set visibility to 'nobody'
-- This lets the API decide whether to surface profile data
CREATE POLICY "privacy_settings_recruiter_select" ON public.privacy_settings
  FOR SELECT USING (
    profile_visible_to != 'nobody'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'recruiter'
    )
  );


-- ============================================================
-- 3. CONSENT RECORDS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  camp_id uuid NOT NULL REFERENCES public.camps(id) ON DELETE CASCADE,
  photo_video_release boolean NOT NULL DEFAULT false,
  terms_accepted boolean NOT NULL DEFAULT false,
  code_of_conduct boolean NOT NULL DEFAULT false,
  guardian_name text,
  guardian_signature text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, camp_id)
);

ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;

-- Users can insert and read their own consent records
CREATE POLICY "consent_records_own_insert" ON public.consent_records
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "consent_records_own_select" ON public.consent_records
  FOR SELECT USING (auth.uid() = user_id);

-- Admins can read all consent records (for audit/compliance)
CREATE POLICY "consent_records_admin_select" ON public.consent_records
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'admin'
    )
  );

CREATE INDEX IF NOT EXISTS idx_consent_records_user ON public.consent_records(user_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_camp ON public.consent_records(camp_id);


-- ============================================================
-- 4. BLOCKED USERS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.blocked_users (
  blocker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;

-- Users manage their own block list
CREATE POLICY "blocked_users_own_insert" ON public.blocked_users
  FOR INSERT WITH CHECK (auth.uid() = blocker_id);

CREATE POLICY "blocked_users_own_delete" ON public.blocked_users
  FOR DELETE USING (auth.uid() = blocker_id);

CREATE POLICY "blocked_users_own_select" ON public.blocked_users
  FOR SELECT USING (auth.uid() = blocker_id);

CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker ON public.blocked_users(blocker_id);


-- ============================================================
-- 5. TRIGGER: auto-create default privacy_settings on new profile
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_profile_privacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.privacy_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created_privacy ON public.profiles;
CREATE TRIGGER on_profile_created_privacy
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_profile_privacy();


-- ============================================================
-- 6. UPDATED_AT TRIGGER FOR SAFETY REPORTS
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_safety_report_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_safety_report_update ON public.safety_reports;
CREATE TRIGGER on_safety_report_update
  BEFORE UPDATE ON public.safety_reports
  FOR EACH ROW EXECUTE PROCEDURE public.set_safety_report_updated_at();
