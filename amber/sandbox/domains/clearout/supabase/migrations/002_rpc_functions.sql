-- ClearOut RPC Functions
-- Migration: 002_rpc_functions

-- ============================================================
-- Get triage queue for a user
-- ============================================================
CREATE OR REPLACE FUNCTION get_triage_queue(
  p_user_id UUID,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_status TEXT DEFAULT 'unread'
)
RETURNS TABLE (
  id UUID,
  channel_type TEXT,
  channel_name TEXT,
  subject TEXT,
  participants JSONB,
  urgency_score INTEGER,
  importance_score INTEGER,
  sentiment TEXT,
  action_required BOOLEAN,
  action_type TEXT,
  triage_reason TEXT,
  triage_tags TEXT[],
  status TEXT,
  summary TEXT,
  last_message_at TIMESTAMPTZ,
  message_count INTEGER,
  unread_count INTEGER,
  latest_snippet TEXT,
  latest_from TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    c.type AS channel_type,
    COALESCE(c.display_name, c.account_email) AS channel_name,
    t.subject,
    t.participants,
    t.urgency_score,
    t.importance_score,
    t.sentiment,
    t.action_required,
    t.action_type,
    t.triage_reason,
    t.triage_tags,
    t.status,
    t.summary,
    t.last_message_at,
    t.message_count,
    t.unread_count,
    (
      SELECT m.snippet FROM messages m
      WHERE m.thread_id = t.id
      ORDER BY m.received_at DESC LIMIT 1
    ) AS latest_snippet,
    (
      SELECT COALESCE(m.from_name, m.from_email, m.from_phone) FROM messages m
      WHERE m.thread_id = t.id
      ORDER BY m.received_at DESC LIMIT 1
    ) AS latest_from
  FROM threads t
  JOIN channels c ON c.id = t.channel_id
  WHERE t.user_id = p_user_id
    AND (p_status = 'all' OR t.status = p_status)
    AND (p_status != 'snoozed' OR t.snoozed_until IS NULL OR t.snoozed_until <= NOW())
  ORDER BY
    t.urgency_score DESC,
    t.importance_score DESC,
    t.last_message_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Get daily briefing summary
-- ============================================================
CREATE OR REPLACE FUNCTION get_daily_briefing(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'urgent_count', (
      SELECT COUNT(*) FROM threads WHERE user_id = p_user_id AND urgency_score >= 75 AND status NOT IN ('archived', 'done')
    ),
    'action_required_count', (
      SELECT COUNT(*) FROM threads WHERE user_id = p_user_id AND action_required = TRUE AND status = 'unread'
    ),
    'unread_count', (
      SELECT COUNT(*) FROM threads WHERE user_id = p_user_id AND status = 'unread'
    ),
    'total_active', (
      SELECT COUNT(*) FROM threads WHERE user_id = p_user_id AND status NOT IN ('archived', 'done')
    ),
    'channels', (
      SELECT COALESCE(jsonb_agg(ch_stats), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'type', c.type,
          'name', COALESCE(c.display_name, c.account_email),
          'unread', COUNT(*) FILTER (WHERE t.status = 'unread')
        ) AS ch_stats
        FROM channels c
        LEFT JOIN threads t ON t.channel_id = c.id AND t.status NOT IN ('archived', 'done')
        WHERE c.user_id = p_user_id AND c.is_active = TRUE
        GROUP BY c.id, c.type, c.display_name, c.account_email
      ) channel_counts
    ),
    'top_urgent', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', t2.id,
        'subject', t2.subject,
        'urgency', t2.urgency_score,
        'from', t2.participants->0->>'name'
      ) ORDER BY t2.urgency_score DESC), '[]'::jsonb)
      FROM (
        SELECT * FROM threads
        WHERE user_id = p_user_id
          AND urgency_score >= 70
          AND status = 'unread'
        ORDER BY urgency_score DESC
        LIMIT 5
      ) t2
    )
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Update thread status with action log
-- ============================================================
CREATE OR REPLACE FUNCTION update_thread_with_action(
  p_user_id UUID,
  p_thread_id UUID,
  p_new_status TEXT,
  p_action_type TEXT,
  p_action_data JSONB DEFAULT '{}'
)
RETURNS BOOLEAN AS $$
BEGIN
  -- Update thread status
  UPDATE threads
  SET status = p_new_status,
      snoozed_until = CASE
        WHEN p_action_type = 'snooze' THEN (p_action_data->>'until')::TIMESTAMPTZ
        ELSE NULL
      END
  WHERE id = p_thread_id AND user_id = p_user_id;

  -- Log the action
  INSERT INTO action_log (user_id, thread_id, action_type, action_data, result)
  VALUES (p_user_id, p_thread_id, p_action_type, p_action_data, 'success');

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Upsert contact from message metadata
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_contact(
  p_user_id UUID,
  p_name TEXT,
  p_email TEXT,
  p_phone TEXT DEFAULT NULL,
  p_slack_user_id TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  contact_id UUID;
BEGIN
  INSERT INTO contacts (user_id, name, email, phone, slack_user_id)
  VALUES (p_user_id, p_name, p_email, p_phone, p_slack_user_id)
  ON CONFLICT (user_id, email) DO UPDATE
    SET name = COALESCE(EXCLUDED.name, contacts.name),
        phone = COALESCE(EXCLUDED.phone, contacts.phone),
        slack_user_id = COALESCE(EXCLUDED.slack_user_id, contacts.slack_user_id),
        updated_at = NOW()
  RETURNING id INTO contact_id;

  RETURN contact_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add unique constraint for contacts (user_id, email)
CREATE UNIQUE INDEX IF NOT EXISTS contacts_user_email_unique
  ON contacts(user_id, email) WHERE email IS NOT NULL;
