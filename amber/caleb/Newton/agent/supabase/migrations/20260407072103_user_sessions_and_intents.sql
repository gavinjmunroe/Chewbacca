-- User Sessions: per-user conversation state, pending actions, and personality profile
-- Enables intent parsing ("yes"/"no" resolve to actions) and per-user context differentiation

CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  handle text UNIQUE NOT NULL,
  pending_action jsonb,
  -- e.g. { "type": "confirm_task", "question": "Want me to add that to Todoist?", "data": {...} }
  conversation_state jsonb NOT NULL DEFAULT '{}',
  -- tracks: current_topic, mood, last_question_asked, depth_level, etc.
  personality_profile jsonb NOT NULL DEFAULT '{}',
  -- learned over time: communication_style, interests, topics_they_love, response_length_preference
  updated_at timestamptz DEFAULT now()
);

CREATE TRIGGER user_sessions_updated_at
  BEFORE UPDATE ON user_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS user_sessions_handle_idx ON user_sessions(handle);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
