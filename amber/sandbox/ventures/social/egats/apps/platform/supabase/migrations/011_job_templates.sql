CREATE TABLE IF NOT EXISTS job_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES recruiter_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_templates_recruiter ON job_templates(recruiter_id);

ALTER TABLE job_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Recruiters manage own templates" ON job_templates
  USING (recruiter_id IN (SELECT id FROM recruiter_profiles WHERE user_id = auth.uid()))
  WITH CHECK (recruiter_id IN (SELECT id FROM recruiter_profiles WHERE user_id = auth.uid()));
