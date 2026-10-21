-- ClearOut Initial Schema
-- Migration: 001_initial_schema

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  timezone TEXT DEFAULT 'UTC',
  onboarding_complete BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- CHANNELS (connected communication accounts)
-- ============================================================
CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('gmail', 'slack', 'imessage', 'sms', 'outlook', 'whatsapp')),
  display_name TEXT,
  account_email TEXT,
  account_id TEXT, -- external account identifier
  access_token TEXT, -- encrypted at rest via Supabase vault ideally
  refresh_token TEXT,
  token_expiry TIMESTAMPTZ,
  workspace_id TEXT, -- for Slack
  workspace_name TEXT, -- for Slack
  scopes TEXT[] DEFAULT '{}',
  last_synced_at TIMESTAMPTZ,
  sync_cursor TEXT, -- Gmail historyId, Slack latest_ts, etc.
  is_active BOOLEAN DEFAULT TRUE,
  sync_status TEXT DEFAULT 'idle' CHECK (sync_status IN ('idle', 'syncing', 'error', 'paused')),
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, type, account_email)
);

ALTER TABLE channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own channels"
  ON channels FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- CONTACTS (relationship graph)
-- ============================================================
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT,
  email TEXT,
  phone TEXT,
  slack_user_id TEXT,
  relationship_type TEXT DEFAULT 'unknown' CHECK (
    relationship_type IN ('family', 'close_friend', 'friend', 'coworker', 'manager', 'direct_report', 'client', 'investor', 'recruiter', 'vendor', 'unknown')
  ),
  importance_score INTEGER DEFAULT 50 CHECK (importance_score BETWEEN 0 AND 100),
  tone_profile JSONB DEFAULT '{}', -- how user speaks to this person
  custom_rules JSONB DEFAULT '{}', -- special handling rules
  always_surface BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX contacts_user_email_idx ON contacts(user_id, email);
CREATE INDEX contacts_user_importance_idx ON contacts(user_id, importance_score DESC);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own contacts"
  ON contacts FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- THREADS (grouped conversation threads)
-- ============================================================
CREATE TABLE IF NOT EXISTS threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE NOT NULL,
  external_thread_id TEXT NOT NULL, -- Gmail thread ID, Slack channel+ts, etc.
  subject TEXT,
  participants JSONB DEFAULT '[]', -- array of {name, email, phone, role}

  -- AI triage fields
  urgency_score INTEGER DEFAULT 0 CHECK (urgency_score BETWEEN 0 AND 100),
  importance_score INTEGER DEFAULT 0 CHECK (importance_score BETWEEN 0 AND 100),
  sentiment TEXT DEFAULT 'neutral' CHECK (sentiment IN ('positive', 'neutral', 'negative', 'urgent', 'emotional')),
  action_required BOOLEAN DEFAULT FALSE,
  action_type TEXT CHECK (action_type IN ('reply', 'decide', 'schedule', 'file', 'escalate', 'ignore', NULL)),
  triage_reason TEXT, -- why it was triaged this way
  triage_tags TEXT[] DEFAULT '{}',

  -- Status
  status TEXT DEFAULT 'unread' CHECK (
    status IN ('unread', 'read', 'in_progress', 'done', 'snoozed', 'archived', 'delegated')
  ),
  snoozed_until TIMESTAMPTZ,
  labels TEXT[] DEFAULT '{}',

  -- AI-generated content
  summary TEXT, -- short thread summary
  key_context TEXT, -- important background for drafting

  -- Metrics
  last_message_at TIMESTAMPTZ,
  message_count INTEGER DEFAULT 0,
  unread_count INTEGER DEFAULT 0,

  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(channel_id, external_thread_id)
);

CREATE INDEX threads_user_status_idx ON threads(user_id, status, last_message_at DESC);
CREATE INDEX threads_user_urgency_idx ON threads(user_id, urgency_score DESC, last_message_at DESC);
CREATE INDEX threads_channel_idx ON threads(channel_id, last_message_at DESC);

ALTER TABLE threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own threads"
  ON threads FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- MESSAGES (individual messages within threads)
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID REFERENCES threads(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE NOT NULL,
  external_id TEXT NOT NULL, -- Gmail message ID, Slack ts, etc.

  -- Sender info
  from_name TEXT,
  from_email TEXT,
  from_phone TEXT,
  from_slack_user_id TEXT,

  -- Recipients
  to_addresses JSONB DEFAULT '[]',
  cc_addresses JSONB DEFAULT '[]',
  bcc_addresses JSONB DEFAULT '[]',

  -- Content
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  snippet TEXT, -- short preview
  attachments JSONB DEFAULT '[]',

  -- Flags
  is_outbound BOOLEAN DEFAULT FALSE,
  is_read BOOLEAN DEFAULT FALSE,

  -- Timestamps
  received_at TIMESTAMPTZ,

  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(channel_id, external_id)
);

CREATE INDEX messages_thread_idx ON messages(thread_id, received_at DESC);
CREATE INDEX messages_user_received_idx ON messages(user_id, received_at DESC);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own messages"
  ON messages FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- DRAFTS (AI-generated reply drafts)
-- ============================================================
CREATE TABLE IF NOT EXISTS drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID REFERENCES threads(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

  -- Draft content
  content TEXT NOT NULL,
  subject TEXT, -- for email replies
  tone TEXT DEFAULT 'balanced' CHECK (
    tone IN ('formal', 'casual', 'warm', 'brief', 'detailed', 'empathetic', 'assertive', 'balanced')
  ),

  -- Generation metadata
  context_used JSONB DEFAULT '{}', -- memory/context references used
  model TEXT DEFAULT 'claude-sonnet-4-6',
  prompt_version TEXT DEFAULT '1.0',
  generation_time_ms INTEGER,

  -- Status
  status TEXT DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'edited', 'sent', 'discarded')
  ),
  edited_content TEXT, -- if user edited the draft

  -- Action
  sent_at TIMESTAMPTZ,
  send_via_channel_id UUID REFERENCES channels(id),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX drafts_thread_idx ON drafts(thread_id, created_at DESC);
CREATE INDEX drafts_user_pending_idx ON drafts(user_id, status) WHERE status = 'pending';

ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own drafts"
  ON drafts FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- ACTION LOG (audit trail of all executed actions)
-- ============================================================
CREATE TABLE IF NOT EXISTS action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  thread_id UUID REFERENCES threads(id) ON DELETE SET NULL,
  draft_id UUID REFERENCES drafts(id) ON DELETE SET NULL,

  action_type TEXT NOT NULL CHECK (
    action_type IN ('archive', 'reply', 'snooze', 'label', 'create_task', 'forward', 'delete', 'mark_read', 'triage', 'draft_generated', 'draft_sent', 'channel_sync')
  ),
  action_data JSONB DEFAULT '{}',

  approved_by TEXT CHECK (approved_by IN ('user', 'auto_policy', 'voice')) DEFAULT 'user',

  result TEXT CHECK (result IN ('success', 'failed', 'pending')) DEFAULT 'pending',
  error TEXT,

  executed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX action_log_user_idx ON action_log(user_id, executed_at DESC);
CREATE INDEX action_log_thread_idx ON action_log(thread_id, executed_at DESC);

ALTER TABLE action_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own action log"
  ON action_log FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own actions"
  ON action_log FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- USER MEMORY (tone model + preferences)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE NOT NULL,

  -- Tone profile learned from user
  tone_profile JSONB DEFAULT '{
    "default_formality": "balanced",
    "uses_emoji": false,
    "greeting_style": "Hi",
    "sign_off_style": "Thanks",
    "avg_message_length": "medium",
    "directness": "moderate"
  }',

  -- Communication preferences
  communication_preferences JSONB DEFAULT '{
    "check_before_send": true,
    "daily_briefing": true,
    "briefing_time": "08:00",
    "voice_enabled": false,
    "auto_archive_newsletters": true,
    "surface_threshold": 60
  }',

  -- Important senders (always surface)
  important_senders TEXT[] DEFAULT '{}',

  -- Ignore patterns (emails/senders to auto-archive)
  ignore_patterns TEXT[] DEFAULT '{}',

  -- Auto-approve rules
  auto_approve_rules JSONB DEFAULT '{}',

  -- Free-form memory notes (AI-managed)
  memory_notes TEXT,

  -- Approval learning
  total_approvals INTEGER DEFAULT 0,
  total_edits INTEGER DEFAULT 0,
  total_discards INTEGER DEFAULT 0,

  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own memory"
  ON user_memory FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- WAITLIST
-- ============================================================
CREATE TABLE IF NOT EXISTS waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  use_case TEXT, -- 'founder', 'exec', 'student', 'team', 'other'
  referral_source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Public insert only, no RLS needed since no user context
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can join waitlist"
  ON waitlist FOR INSERT WITH CHECK (TRUE);

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_profiles
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_channels
  BEFORE UPDATE ON channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_contacts
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_threads
  BEFORE UPDATE ON threads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_drafts
  BEFORE UPDATE ON drafts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_user_memory
  BEFORE UPDATE ON user_memory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
