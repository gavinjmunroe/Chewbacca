CREATE TABLE IF NOT EXISTS endorsements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endorser_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dancer_id uuid NOT NULL REFERENCES dancer_profiles(id) ON DELETE CASCADE,
  skill text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(endorser_id, dancer_id, skill)
);

CREATE INDEX IF NOT EXISTS idx_endorsements_dancer ON endorsements(dancer_id);

ALTER TABLE endorsements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view endorsements" ON endorsements FOR SELECT USING (true);
CREATE POLICY "Users can endorse others" ON endorsements FOR INSERT WITH CHECK (endorser_id = auth.uid() AND dancer_id NOT IN (SELECT id FROM dancer_profiles WHERE user_id = auth.uid()));
CREATE POLICY "Users can remove own endorsements" ON endorsements FOR DELETE USING (endorser_id = auth.uid());
