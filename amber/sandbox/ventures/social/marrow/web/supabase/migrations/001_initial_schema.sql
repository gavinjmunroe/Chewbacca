-- Marrow Initial Schema
-- Run this against a fresh Supabase project

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
CREATE TABLE profiles (
  id            uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email         text UNIQUE NOT NULL,
  first_name    text,
  last_name     text,
  headline      text,          -- e.g. "Junior at USC · Computer Science"
  school        text,
  graduation_year int,
  major         text,
  avatar_url    text,
  bio           text,
  linkedin_url  text,
  github_url    text,
  website_url   text,
  created_at    timestamptz DEFAULT now() NOT NULL,
  updated_at    timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view any profile"
  ON profiles FOR SELECT USING (true);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- ============================================================
-- ORGANIZATIONS
-- ============================================================
CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  description text,
  logo_url    text,
  cover_url   text,
  website     text,
  school      text,
  category    text,   -- 'consulting', 'finance', 'tech', 'pre-med', 'other'
  is_verified boolean DEFAULT false,
  is_active   boolean DEFAULT true,
  created_by  uuid REFERENCES profiles(id),
  created_at  timestamptz DEFAULT now() NOT NULL,
  updated_at  timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active orgs"
  ON organizations FOR SELECT USING (is_active = true);

CREATE POLICY "Org admins can update their org"
  ON organizations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.org_id = id
        AND org_members.user_id = auth.uid()
        AND org_members.role IN ('owner','admin')
    )
  );

-- ============================================================
-- ORG MEMBERS (admins, reviewers)
-- ============================================================
CREATE TABLE org_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  user_id     uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  role        text NOT NULL DEFAULT 'reviewer', -- 'owner','admin','reviewer'
  invited_by  uuid REFERENCES profiles(id),
  invited_at  timestamptz DEFAULT now(),
  accepted_at timestamptz,
  UNIQUE(org_id, user_id)
);

ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view their org membership"
  ON org_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM org_members om
      WHERE om.org_id = org_members.org_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner','admin')
    )
  );

CREATE POLICY "Org admins can manage members"
  ON org_members FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM org_members om
      WHERE om.org_id = org_members.org_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner','admin')
    )
  );

-- ============================================================
-- RECRUITING CYCLES
-- ============================================================
CREATE TABLE cycles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  name                  text NOT NULL,
  description           text,
  status                text DEFAULT 'draft' NOT NULL,
  -- 'draft','active','paused','closed','archived'
  application_open_at   timestamptz,
  application_close_at  timestamptz,
  max_applicants        int,
  target_class_size     int,
  is_public             boolean DEFAULT true,
  settings              jsonb DEFAULT '{}',
  created_by            uuid REFERENCES profiles(id),
  created_at            timestamptz DEFAULT now() NOT NULL,
  updated_at            timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public cycles are visible to all"
  ON cycles FOR SELECT USING (
    is_public = true
    OR EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.org_id = cycles.org_id
        AND org_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Org admins can manage cycles"
  ON cycles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.org_id = cycles.org_id
        AND org_members.user_id = auth.uid()
        AND org_members.role IN ('owner','admin')
    )
  );

-- ============================================================
-- STAGES (within a cycle)
-- ============================================================
CREATE TABLE stages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id      uuid REFERENCES cycles(id) ON DELETE CASCADE NOT NULL,
  name          text NOT NULL,
  description   text,
  stage_order   int NOT NULL,
  stage_type    text DEFAULT 'application',
  -- 'application','event','interview','decision'
  is_blind      boolean DEFAULT false,
  is_required   boolean DEFAULT true,
  created_at    timestamptz DEFAULT now() NOT NULL,
  UNIQUE(cycle_id, stage_order)
);

ALTER TABLE stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view stages"
  ON stages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM cycles
      JOIN org_members ON org_members.org_id = cycles.org_id
      WHERE cycles.id = stages.cycle_id
        AND org_members.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM cycles WHERE cycles.id = stages.cycle_id AND cycles.is_public = true
    )
  );

CREATE POLICY "Org admins can manage stages"
  ON stages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM cycles
      JOIN org_members ON org_members.org_id = cycles.org_id
      WHERE cycles.id = stages.cycle_id
        AND org_members.user_id = auth.uid()
        AND org_members.role IN ('owner','admin')
    )
  );

-- ============================================================
-- STAGE QUESTIONS
-- ============================================================
CREATE TABLE stage_questions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id        uuid REFERENCES stages(id) ON DELETE CASCADE NOT NULL,
  question_text   text NOT NULL,
  question_type   text NOT NULL DEFAULT 'long_text',
  -- 'short_text','long_text','single_choice','multi_choice','file_upload','url','number'
  is_required     boolean DEFAULT true,
  options         jsonb,
  word_limit      int,
  char_limit      int,
  placeholder     text,
  helper_text     text,
  question_order  int NOT NULL,
  created_at      timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE stage_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view questions"
  ON stage_questions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM stages
      JOIN cycles ON cycles.id = stages.cycle_id
      JOIN org_members ON org_members.org_id = cycles.org_id
      WHERE stages.id = stage_questions.stage_id
        AND org_members.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM stages
      JOIN cycles ON cycles.id = stages.cycle_id
      WHERE stages.id = stage_questions.stage_id AND cycles.is_public = true
    )
  );

CREATE POLICY "Org admins can manage questions"
  ON stage_questions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM stages
      JOIN cycles ON cycles.id = stages.cycle_id
      JOIN org_members ON org_members.org_id = cycles.org_id
      WHERE stages.id = stage_questions.stage_id
        AND org_members.user_id = auth.uid()
        AND org_members.role IN ('owner','admin')
    )
  );

-- ============================================================
-- RUBRIC CRITERIA
-- ============================================================
CREATE TABLE rubric_criteria (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id         uuid REFERENCES stages(id) ON DELETE CASCADE NOT NULL,
  criterion_name   text NOT NULL,
  description      text,
  max_score        int DEFAULT 5 NOT NULL,
  weight           decimal DEFAULT 1.0 NOT NULL,
  criterion_order  int NOT NULL,
  created_at       timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE rubric_criteria ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view rubrics"
  ON rubric_criteria FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM stages
      JOIN cycles ON cycles.id = stages.cycle_id
      JOIN org_members ON org_members.org_id = cycles.org_id
      WHERE stages.id = rubric_criteria.stage_id
        AND org_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Org admins can manage rubrics"
  ON rubric_criteria FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM stages
      JOIN cycles ON cycles.id = stages.cycle_id
      JOIN org_members ON org_members.org_id = cycles.org_id
      WHERE stages.id = rubric_criteria.stage_id
        AND org_members.user_id = auth.uid()
        AND org_members.role IN ('owner','admin')
    )
  );

-- ============================================================
-- APPLICATIONS
-- ============================================================
CREATE TABLE applications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id         uuid REFERENCES cycles(id) ON DELETE CASCADE NOT NULL,
  applicant_id     uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  current_stage_id uuid REFERENCES stages(id),
  status           text DEFAULT 'draft' NOT NULL,
  -- 'draft','submitted','under_review','advancing','accepted','waitlisted','rejected','withdrawn'
  submitted_at     timestamptz,
  decision_at      timestamptz,
  decision_note    text,
  internal_tags    text[],
  created_at       timestamptz DEFAULT now() NOT NULL,
  updated_at       timestamptz DEFAULT now() NOT NULL,
  UNIQUE(cycle_id, applicant_id)
);

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Applicants can view their own applications"
  ON applications FOR SELECT
  USING (
    applicant_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM cycles
      JOIN org_members ON org_members.org_id = cycles.org_id
      WHERE cycles.id = applications.cycle_id
        AND org_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Applicants can insert their own applications"
  ON applications FOR INSERT WITH CHECK (applicant_id = auth.uid());

CREATE POLICY "Applicants can update their draft applications"
  ON applications FOR UPDATE
  USING (
    (applicant_id = auth.uid() AND status = 'draft')
    OR EXISTS (
      SELECT 1 FROM cycles
      JOIN org_members ON org_members.org_id = cycles.org_id
      WHERE cycles.id = applications.cycle_id
        AND org_members.user_id = auth.uid()
        AND org_members.role IN ('owner','admin')
    )
  );

-- ============================================================
-- APPLICATION RESPONSES
-- ============================================================
CREATE TABLE application_responses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid REFERENCES applications(id) ON DELETE CASCADE NOT NULL,
  question_id     uuid REFERENCES stage_questions(id) ON DELETE CASCADE NOT NULL,
  response_text   text,
  response_files  jsonb DEFAULT '[]',
  created_at      timestamptz DEFAULT now() NOT NULL,
  updated_at      timestamptz DEFAULT now() NOT NULL,
  UNIQUE(application_id, question_id)
);

ALTER TABLE application_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Applicants can manage their responses"
  ON application_responses FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = application_responses.application_id
        AND applications.applicant_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM applications
      JOIN cycles ON cycles.id = applications.cycle_id
      JOIN org_members ON org_members.org_id = cycles.org_id
      WHERE applications.id = application_responses.application_id
        AND org_members.user_id = auth.uid()
    )
  );

-- ============================================================
-- ARTIFACTS (user file vault)
-- ============================================================
CREATE TABLE artifacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  artifact_type text NOT NULL DEFAULT 'other',
  -- 'resume','transcript','portfolio','writing_sample','other'
  name          text NOT NULL,
  file_url      text NOT NULL,
  file_size     bigint,
  mime_type     text,
  is_primary    boolean DEFAULT false,
  created_at    timestamptz DEFAULT now() NOT NULL,
  updated_at    timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own artifacts"
  ON artifacts FOR ALL USING (user_id = auth.uid());

CREATE POLICY "Org members can view applicant artifacts"
  ON artifacts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM applications
      JOIN cycles ON cycles.id = applications.cycle_id
      JOIN org_members ON org_members.org_id = cycles.org_id
      WHERE applications.applicant_id = artifacts.user_id
        AND org_members.user_id = auth.uid()
    )
  );

-- ============================================================
-- REVIEWS
-- ============================================================
CREATE TABLE reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid REFERENCES applications(id) ON DELETE CASCADE NOT NULL,
  stage_id        uuid REFERENCES stages(id) NOT NULL,
  reviewer_id     uuid REFERENCES profiles(id) NOT NULL,
  notes           text,
  recommendation  text,
  -- 'advance','reject','hold','undecided'
  is_submitted    boolean DEFAULT false,
  submitted_at    timestamptz,
  created_at      timestamptz DEFAULT now() NOT NULL,
  updated_at      timestamptz DEFAULT now() NOT NULL,
  UNIQUE(application_id, stage_id, reviewer_id)
);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reviewers can manage their own reviews"
  ON reviews FOR ALL
  USING (
    reviewer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM applications
      JOIN cycles ON cycles.id = applications.cycle_id
      JOIN org_members ON org_members.org_id = cycles.org_id
      WHERE applications.id = reviews.application_id
        AND org_members.user_id = auth.uid()
        AND org_members.role IN ('owner','admin')
    )
  );

-- ============================================================
-- REVIEW SCORES
-- ============================================================
CREATE TABLE review_scores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id     uuid REFERENCES reviews(id) ON DELETE CASCADE NOT NULL,
  criterion_id  uuid REFERENCES rubric_criteria(id) NOT NULL,
  score         int,
  created_at    timestamptz DEFAULT now() NOT NULL,
  UNIQUE(review_id, criterion_id)
);

ALTER TABLE review_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reviewers can manage their scores"
  ON review_scores FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM reviews
      WHERE reviews.id = review_scores.review_id
        AND reviews.reviewer_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM reviews
      JOIN applications ON applications.id = reviews.application_id
      JOIN cycles ON cycles.id = applications.cycle_id
      JOIN org_members ON org_members.org_id = cycles.org_id
      WHERE reviews.id = review_scores.review_id
        AND org_members.user_id = auth.uid()
        AND org_members.role IN ('owner','admin')
    )
  );

-- ============================================================
-- APPLICATION STAGE HISTORY (audit trail for stage movements)
-- ============================================================
CREATE TABLE application_stage_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid REFERENCES applications(id) ON DELETE CASCADE NOT NULL,
  from_stage_id   uuid REFERENCES stages(id),
  to_stage_id     uuid REFERENCES stages(id),
  from_status     text,
  to_status       text,
  moved_by        uuid REFERENCES profiles(id),
  note            text,
  moved_at        timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE application_stage_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view history"
  ON application_stage_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM applications
      JOIN cycles ON cycles.id = applications.cycle_id
      JOIN org_members ON org_members.org_id = cycles.org_id
      WHERE applications.id = application_stage_history.application_id
        AND org_members.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = application_stage_history.application_id
        AND applications.applicant_id = auth.uid()
    )
  );

CREATE POLICY "Org admins can insert history"
  ON application_stage_history FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM applications
      JOIN cycles ON cycles.id = applications.cycle_id
      JOIN org_members ON org_members.org_id = cycles.org_id
      WHERE applications.id = application_stage_history.application_id
        AND org_members.user_id = auth.uid()
        AND org_members.role IN ('owner','admin')
    )
  );

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id          uuid REFERENCES cycles(id) ON DELETE CASCADE NOT NULL,
  sent_by           uuid REFERENCES profiles(id) NOT NULL,
  recipient_type    text NOT NULL DEFAULT 'all',
  -- 'all','stage','status','individual'
  recipient_filter  jsonb DEFAULT '{}',
  subject           text NOT NULL,
  body              text NOT NULL,
  sent_at           timestamptz DEFAULT now() NOT NULL,
  recipient_count   int DEFAULT 0
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins can manage messages"
  ON messages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM cycles
      JOIN org_members ON org_members.org_id = cycles.org_id
      WHERE cycles.id = messages.cycle_id
        AND org_members.user_id = auth.uid()
        AND org_members.role IN ('owner','admin')
    )
  );

-- ============================================================
-- EVENTS (info sessions, coffee chats)
-- ============================================================
CREATE TABLE events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id     uuid REFERENCES cycles(id) ON DELETE CASCADE NOT NULL,
  stage_id     uuid REFERENCES stages(id),
  name         text NOT NULL,
  description  text,
  location     text,
  event_url    text,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz,
  max_capacity int,
  is_required  boolean DEFAULT false,
  created_at   timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members and applicants can view events"
  ON events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM cycles
      WHERE cycles.id = events.cycle_id AND cycles.is_public = true
    )
    OR EXISTS (
      SELECT 1 FROM cycles
      JOIN org_members ON org_members.org_id = cycles.org_id
      WHERE cycles.id = events.cycle_id
        AND org_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Org admins can manage events"
  ON events FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM cycles
      JOIN org_members ON org_members.org_id = cycles.org_id
      WHERE cycles.id = events.cycle_id
        AND org_members.user_id = auth.uid()
        AND org_members.role IN ('owner','admin')
    )
  );

-- ============================================================
-- EVENT RSVPs
-- ============================================================
CREATE TABLE event_rsvps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid REFERENCES events(id) ON DELETE CASCADE NOT NULL,
  user_id     uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  status      text DEFAULT 'attending',
  -- 'attending','waitlisted','cancelled'
  created_at  timestamptz DEFAULT now() NOT NULL,
  UNIQUE(event_id, user_id)
);

ALTER TABLE event_rsvps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own RSVPs"
  ON event_rsvps FOR ALL USING (user_id = auth.uid());

CREATE POLICY "Org admins can view all RSVPs"
  ON event_rsvps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events
      JOIN cycles ON cycles.id = events.cycle_id
      JOIN org_members ON org_members.org_id = cycles.org_id
      WHERE events.id = event_rsvps.event_id
        AND org_members.user_id = auth.uid()
    )
  );

-- ============================================================
-- ONBOARDING TASKS (post-acceptance)
-- ============================================================
CREATE TABLE onboarding_tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id         uuid REFERENCES cycles(id) ON DELETE CASCADE NOT NULL,
  title            text NOT NULL,
  description      text,
  due_date         timestamptz,
  task_type        text DEFAULT 'form',
  -- 'form','upload','link','payment','acknowledgment'
  task_config      jsonb DEFAULT '{}',
  task_order       int NOT NULL,
  is_required      boolean DEFAULT true,
  created_at       timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE onboarding_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins can manage onboarding tasks"
  ON onboarding_tasks FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM cycles
      JOIN org_members ON org_members.org_id = cycles.org_id
      WHERE cycles.id = onboarding_tasks.cycle_id
        AND org_members.user_id = auth.uid()
        AND org_members.role IN ('owner','admin')
    )
  );

-- ============================================================
-- ONBOARDING COMPLETIONS
-- ============================================================
CREATE TABLE onboarding_completions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid REFERENCES onboarding_tasks(id) ON DELETE CASCADE NOT NULL,
  user_id     uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  status      text DEFAULT 'pending',
  -- 'pending','completed','waived'
  response    jsonb,
  completed_at timestamptz,
  created_at  timestamptz DEFAULT now() NOT NULL,
  UNIQUE(task_id, user_id)
);

ALTER TABLE onboarding_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their completions"
  ON onboarding_completions FOR ALL USING (user_id = auth.uid());

-- ============================================================
-- AUDIT LOG
-- ============================================================
CREATE TABLE audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid REFERENCES organizations(id),
  cycle_id       uuid REFERENCES cycles(id),
  actor_id       uuid REFERENCES profiles(id),
  action         text NOT NULL,
  resource_type  text,
  resource_id    uuid,
  metadata       jsonb DEFAULT '{}',
  ip_address     text,
  created_at     timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins can view audit log"
  ON audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.org_id = audit_log.org_id
        AND org_members.user_id = auth.uid()
        AND org_members.role IN ('owner','admin')
    )
  );

CREATE POLICY "System can insert audit log"
  ON audit_log FOR INSERT WITH CHECK (true);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TRIGGER cycles_updated_at
  BEFORE UPDATE ON cycles
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TRIGGER applications_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TRIGGER application_responses_updated_at
  BEFORE UPDATE ON application_responses
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TRIGGER artifacts_updated_at
  BEFORE UPDATE ON artifacts
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TRIGGER reviews_updated_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Create profile on new user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_applications_cycle ON applications(cycle_id);
CREATE INDEX idx_applications_applicant ON applications(applicant_id);
CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_stages_cycle ON stages(cycle_id, stage_order);
CREATE INDEX idx_stage_questions_stage ON stage_questions(stage_id, question_order);
CREATE INDEX idx_reviews_application ON reviews(application_id);
CREATE INDEX idx_reviews_reviewer ON reviews(reviewer_id);
CREATE INDEX idx_audit_log_org ON audit_log(org_id, created_at DESC);
CREATE INDEX idx_org_members_org ON org_members(org_id);
CREATE INDEX idx_org_members_user ON org_members(user_id);
CREATE INDEX idx_artifacts_user ON artifacts(user_id);

-- ============================================================
-- STORAGE BUCKETS (run via Supabase dashboard or API)
-- ============================================================
-- Buckets needed:
-- 'avatars'      (public)  - user profile photos
-- 'artifacts'    (private) - user file vault (resumes, transcripts)
-- 'org-assets'   (public)  - org logos and cover images
-- 'responses'    (private) - file uploads in application responses
