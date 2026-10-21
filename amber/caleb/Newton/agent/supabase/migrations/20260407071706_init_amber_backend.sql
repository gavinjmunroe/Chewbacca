-- Amber Backend Schema
-- Replaces GitHub flat-file storage with real Supabase persistence

-- Contacts: one row per phone number, stores the full profile JSON
CREATE TABLE IF NOT EXISTS contacts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  handle text UNIQUE NOT NULL,
  profile jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Conversations: conversation history per chat key (phone or group id)
CREATE TABLE IF NOT EXISTS conversations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_key text UNIQUE NOT NULL,
  messages jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Interactions: full log of every message in and out
CREATE TABLE IF NOT EXISTS interactions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  from_handle text NOT NULL,
  to_handle text,
  group_id text,
  message_in text,
  message_out text,
  model text,
  tokens_in integer,
  tokens_out integer,
  latency_ms integer,
  created_at timestamptz DEFAULT now()
);

-- Auto-update updated_at on contacts and conversations
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS contacts_handle_idx ON contacts(handle);
CREATE INDEX IF NOT EXISTS conversations_chat_key_idx ON conversations(chat_key);
CREATE INDEX IF NOT EXISTS interactions_from_handle_idx ON interactions(from_handle);
CREATE INDEX IF NOT EXISTS interactions_created_at_idx ON interactions(created_at DESC);

-- RLS: service role only (agent runs server-side with service key)
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically, no policies needed for agent use
