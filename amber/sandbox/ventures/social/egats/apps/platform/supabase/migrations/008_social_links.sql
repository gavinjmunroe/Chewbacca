-- Add social link columns to profiles
-- instagram_handle and tiktok_handle already exist from prior migrations
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS youtube_url text,
  ADD COLUMN IF NOT EXISTS twitter_handle text,
  ADD COLUMN IF NOT EXISTS website_url text;

-- Add display_order to portfolio clips (if not exists)
ALTER TABLE portfolio_clips ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;

-- Index for ordered portfolio display
CREATE INDEX IF NOT EXISTS idx_portfolio_clips_order ON portfolio_clips(dancer_id, display_order);
