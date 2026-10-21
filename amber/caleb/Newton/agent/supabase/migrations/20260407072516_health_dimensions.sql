-- 6 Dimensions of Health Framework
-- Masculine: Social, Financial, Intellectual
-- Feminine: Spiritual, Physical, Emotional
-- Tracks perceived health scores per contact over time
-- Powers daily check-ins and agent decision-making

-- Daily check-in snapshots: one row per person per day
CREATE TABLE IF NOT EXISTS health_checkins (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  handle text NOT NULL,
  checkin_date date NOT NULL DEFAULT CURRENT_DATE,

  -- Masculine dimensions (0-10)
  social numeric(4,1) CHECK (social BETWEEN 0 AND 10),
  financial numeric(4,1) CHECK (financial BETWEEN 0 AND 10),
  intellectual numeric(4,1) CHECK (intellectual BETWEEN 0 AND 10),

  -- Feminine dimensions (0-10)
  spiritual numeric(4,1) CHECK (spiritual BETWEEN 0 AND 10),
  physical numeric(4,1) CHECK (physical BETWEEN 0 AND 10),
  emotional numeric(4,1) CHECK (emotional BETWEEN 0 AND 10),

  -- How the score was collected
  source text NOT NULL DEFAULT 'self_report',
  -- 'self_report' = user said it directly
  -- 'inferred' = agent inferred from conversation
  -- 'checkin' = structured daily check-in

  notes text,
  raw_message text, -- the message that triggered this reading, for audit
  created_at timestamptz DEFAULT now(),

  UNIQUE (handle, checkin_date, source)
);

-- Current health profile: latest aggregated scores per contact
-- Updated after every check-in or inference
CREATE TABLE IF NOT EXISTS health_profiles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  handle text UNIQUE NOT NULL,

  -- Current scores (rolling 7-day average)
  social numeric(4,1),
  financial numeric(4,1),
  intellectual numeric(4,1),
  spiritual numeric(4,1),
  physical numeric(4,1),
  emotional numeric(4,1),

  -- Trend metadata
  lowest_dimension text, -- which dimension needs the most attention
  highest_dimension text,
  overall_score numeric(4,1), -- simple average of all 6
  checkin_streak integer DEFAULT 0,
  last_checkin_date date,
  total_checkins integer DEFAULT 0,

  updated_at timestamptz DEFAULT now()
);

CREATE TRIGGER health_profiles_updated_at
  BEFORE UPDATE ON health_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS health_checkins_handle_date_idx ON health_checkins(handle, checkin_date DESC);
CREATE INDEX IF NOT EXISTS health_profiles_handle_idx ON health_profiles(handle);
CREATE INDEX IF NOT EXISTS health_checkins_date_idx ON health_checkins(checkin_date DESC);

-- RLS
ALTER TABLE health_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_profiles ENABLE ROW LEVEL SECURITY;
