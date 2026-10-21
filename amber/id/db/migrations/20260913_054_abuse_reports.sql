-- REPORTING, WHICH IS THE HALF OF SAFETY THE APP DID NOT HAVE.
--
-- Blocking answers "stop this person reaching me". It does not answer "somebody
-- is doing something that should stop for everybody", and nothing in the app
-- answered that: there was no way to tell us anything, and no place a report
-- would have landed if there had been.
--
-- App Store Guideline 1.2 asks for four things from any app where users can see
-- content other users made. Three of them existed: a block, published contact
-- details, and a way to remove content. This table is the fourth.
--
-- ── THE EVIDENCE IS THE POINT ────────────────────────────────────────────────
--
-- A report with no content attached is unreviewable. The reporter clears their
-- copy of the thread, or blocks and never opens it again, and what is left is a
-- row saying somebody accused somebody of something. So the report carries a
-- snapshot of what the reported person actually sent, taken at the moment the
-- report is filed, and the reporting UI says so out loud.
--
-- Only the REPORTED person's messages are copied. The reporter's own half is
-- theirs and is not evidence of anything they are complaining about.
--
-- ── THE TWO FOREIGN KEYS POINT DIFFERENT WAYS, SAME AS blocked_handles ───────
--
--   reporter_amber_id  ON DELETE CASCADE   your reports go when your account does
--   reported_amber_id  ON DELETE SET NULL  a report SURVIVES the reported account
--
-- Somebody deleting their account must not delete the complaints against them,
-- or deletion becomes the way to clear your record. The snapshot stays either
-- way, which is what makes review possible after the fact.

CREATE TABLE IF NOT EXISTS abuse_reports (
  id                bigserial   PRIMARY KEY,
  reporter_amber_id uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  reported_amber_id uuid        REFERENCES users (amber_id) ON DELETE SET NULL,
  -- The thread it came from, when it came from one. Text rather than a foreign
  -- key: a thread the reporter later clears must not take the report with it.
  thread_id         text,
  -- Kept in step with REPORT_REASONS in src/db/reports-store.js. A CHECK rather
  -- than a lookup table because this list changes about once a year and a
  -- typo'd reason silently sorting into nothing is worse than a failed insert.
  reason            text        NOT NULL CHECK (reason IN (
                      'harassment', 'spam', 'impersonation',
                      'sexual', 'threat', 'other'
                    )),
  -- What the reporter typed, if anything. Capped in the route, not here.
  detail            text,
  -- The reported person's recent messages, as [{id, kind, body, createdAt}].
  evidence          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  status            text        NOT NULL DEFAULT 'open'
                                CHECK (status IN ('open', 'actioned', 'dismissed')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  reviewed_at       timestamptz,
  review_note       text
);

-- The review queue: everything still open, oldest first. Partial, because a
-- reviewed report is never looked for this way and there will be far more of
-- them than open ones.
CREATE INDEX IF NOT EXISTS abuse_reports_open_idx
  ON abuse_reports (created_at) WHERE status = 'open';

-- "Show me everything filed against this account", which is the question that
-- turns three separate reports into a pattern.
CREATE INDEX IF NOT EXISTS abuse_reports_reported_idx
  ON abuse_reports (reported_amber_id, created_at DESC);

-- ONE OPEN REPORT PER PAIR PER THREAD. Tapping Report twice, or a retry after a
-- dropped response, must not become two rows in the queue -- a reviewer would
-- have no way to tell that from a second, separate incident. A NEW report is
-- possible the moment the first is reviewed, which is the case where the count
-- genuinely means something.
CREATE UNIQUE INDEX IF NOT EXISTS abuse_reports_one_open_idx
  ON abuse_reports (reporter_amber_id, reported_amber_id, COALESCE(thread_id, ''))
  WHERE status = 'open';

COMMENT ON TABLE abuse_reports IS
  'User reports of other users, with a snapshot of the reported messages. Survives the reported account being deleted (see the FK asymmetry).';
