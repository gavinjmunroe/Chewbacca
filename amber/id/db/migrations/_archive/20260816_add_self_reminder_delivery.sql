-- Self-reminder server delivery (reminders + notifications for the OWNER only).
--
-- The `reminders` table (20260727_add_4d_standalone_tables.sql) and the
-- `users.profile_extra` jsonb column (20260726_add_users_profile_extra.sql)
-- already cover everything this feature needs:
--   * reminder_id / owner_id / status / due_at / created_at + data(jsonb)
--     where data holds title, body(message), event_at, channels, recipient,
--     when.iso (fire_at), origin, attempts.
--   * notification channel preference lives in users.profile_extra
--     ->'notificationSettings'->'channels' = { apple: bool, imessage: bool }.
--
-- So this migration is ADDITIVE + IDEMPOTENT and changes no existing column.
-- It (1) re-affirms the table + base indexes exist (safe no-op if already run),
-- and (2) adds a PARTIAL index that makes the self-reminder due scan cheap —
-- the scheduler queries only rows tagged origin='self_reminder' whose
-- recipient.transport is imessage.

CREATE TABLE IF NOT EXISTS reminders (
  reminder_id text PRIMARY KEY,
  owner_id    uuid,
  status      text NOT NULL,
  due_at      timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  data        jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS reminders_due_idx ON reminders (status, due_at);
CREATE INDEX IF NOT EXISTS reminders_owner_status_idx ON reminders (owner_id, status);

-- Partial index for the self-reminder scheduler's due scan. Only self-origin
-- iMessage reminders are indexed, so the scheduler never scans the teammate's
-- cross-person (Tab 31) rows and the index stays tiny.
CREATE INDEX IF NOT EXISTS reminders_self_due_idx
  ON reminders (due_at)
  WHERE status = 'pending' AND (data->>'origin') = 'self_reminder';

-- Re-affirm the profile_extra overflow column exists (notification settings
-- home). Idempotent; unchanged if the 20260726 migration already ran.
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_extra jsonb;
