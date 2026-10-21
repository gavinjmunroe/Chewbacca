ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES auth.users(id);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referral_code text UNIQUE DEFAULT substring(gen_random_uuid()::text, 1, 8);

CREATE INDEX IF NOT EXISTS idx_profiles_referral_code ON profiles(referral_code);
