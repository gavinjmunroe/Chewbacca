ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notification_email_bookings boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notification_email_applications boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notification_email_messages boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notification_push_enabled boolean NOT NULL DEFAULT false;
