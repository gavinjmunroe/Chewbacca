-- Migration 006: Performance Indexes
-- Adds indexes for common query patterns across the EGATS platform

-- Fast dancer search by style
CREATE INDEX IF NOT EXISTS idx_dancer_profiles_styles ON dancer_profiles USING GIN(styles);

-- Notification queries (unread count, user's notifications)
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);

-- Job search
CREATE INDEX IF NOT EXISTS idx_jobs_recruiter ON jobs(recruiter_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_styles ON jobs USING GIN(styles);

-- Applications
CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_id);
CREATE INDEX IF NOT EXISTS idx_applications_dancer ON applications(dancer_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);

-- Bookings
CREATE INDEX IF NOT EXISTS idx_bookings_dancer ON bookings(dancer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_recruiter ON bookings(recruiter_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status_start ON bookings(status, start_date);

-- Verification records
CREATE INDEX IF NOT EXISTS idx_verification_records_dancer ON verification_records(dancer_id);
CREATE INDEX IF NOT EXISTS idx_verification_records_pending ON verification_records(verifier_id, revoked) WHERE verifier_id IS NULL AND revoked = false;

-- Safety reports
CREATE INDEX IF NOT EXISTS idx_safety_reports_reported ON safety_reports(reported_user_id);
CREATE INDEX IF NOT EXISTS idx_safety_reports_status ON safety_reports(status);

-- Culture app
CREATE INDEX IF NOT EXISTS idx_culture_posts_circle ON culture_posts(circle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_culture_posts_author ON culture_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_culture_post_likes_post ON culture_post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_culture_circle_members_user ON culture_circle_members(user_id);

-- Reviews
CREATE INDEX IF NOT EXISTS idx_reviews_booking ON reviews(booking_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewed ON reviews(reviewed_id);

-- Portfolio clips
CREATE INDEX IF NOT EXISTS idx_portfolio_clips_dancer ON portfolio_clips(dancer_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_clips_featured ON portfolio_clips(dancer_id, is_featured) WHERE is_featured = true;
