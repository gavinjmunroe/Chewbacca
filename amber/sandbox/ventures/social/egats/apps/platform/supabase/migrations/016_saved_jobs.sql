CREATE TABLE IF NOT EXISTS saved_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dancer_id uuid NOT NULL REFERENCES dancer_profiles(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(dancer_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_jobs_dancer ON saved_jobs(dancer_id, created_at DESC);

ALTER TABLE saved_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dancers manage own saved jobs" ON saved_jobs
  USING (dancer_id IN (SELECT id FROM dancer_profiles WHERE user_id = auth.uid()))
  WITH CHECK (dancer_id IN (SELECT id FROM dancer_profiles WHERE user_id = auth.uid()));
