CREATE TABLE IF NOT EXISTS camp_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id uuid NOT NULL REFERENCES camps(id) ON DELETE CASCADE,
  dancer_id uuid NOT NULL REFERENCES dancer_profiles(id) ON DELETE CASCADE,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  UNIQUE(camp_id, dancer_id)
);

CREATE INDEX IF NOT EXISTS idx_camp_waitlist_camp ON camp_waitlist(camp_id, position);

ALTER TABLE camp_waitlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dancers view own waitlist" ON camp_waitlist FOR SELECT USING (
  dancer_id IN (SELECT id FROM dancer_profiles WHERE user_id = auth.uid())
);
CREATE POLICY "Dancers join waitlist" ON camp_waitlist FOR INSERT WITH CHECK (
  dancer_id IN (SELECT id FROM dancer_profiles WHERE user_id = auth.uid())
);
CREATE POLICY "Dancers leave waitlist" ON camp_waitlist FOR DELETE USING (
  dancer_id IN (SELECT id FROM dancer_profiles WHERE user_id = auth.uid())
);
