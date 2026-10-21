CREATE TABLE IF NOT EXISTS terms_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version text NOT NULL DEFAULT '1.0',
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip_address text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_terms_user_version ON terms_acceptances(user_id, version);
ALTER TABLE terms_acceptances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own acceptances" ON terms_acceptances
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
