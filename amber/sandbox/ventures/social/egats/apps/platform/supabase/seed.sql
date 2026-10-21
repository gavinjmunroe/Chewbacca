-- EGATS Development Seed Data
-- Run after all migrations to create representative test data

-- Test users are created via Supabase Auth — these are profile inserts only
-- Assumes you've manually created test auth users and have their UUIDs

-- Insert test admin profile
-- Replace 'ADMIN_USER_UUID' with actual UUID from auth.users
-- INSERT INTO profiles (id, role, display_name, created_at) VALUES
--   ('ADMIN_USER_UUID', 'admin', 'Admin User', now());

-- Sample verification_records data structure
COMMENT ON TABLE verification_records IS
  'verifier_id IS NULL AND revoked=false = pending review
   revoked=true = rejected
   verifier_id IS NOT NULL AND revoked=false = approved';

-- Sample dance styles reference
DO $$
BEGIN
  RAISE NOTICE 'EGATS seed.sql loaded. To seed test data:';
  RAISE NOTICE '1. Create auth users in Supabase dashboard';
  RAISE NOTICE '2. Insert profiles with role=dancer/recruiter/verifier/admin';
  RAISE NOTICE '3. Create dancer_profiles/recruiter_profiles records';
  RAISE NOTICE '4. Publish test camps and jobs';
END;
$$;
