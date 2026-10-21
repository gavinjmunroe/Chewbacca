-- Amber Q&A Phase 3 — delivery. A "delivery" is the question's seeded thread
-- for a user, so a user must have at most ONE live thread per question. This
-- partial unique index is the backstop that makes deliverQuestion idempotent
-- under concurrency. Idempotent: CREATE ... IF NOT EXISTS.

CREATE UNIQUE INDEX IF NOT EXISTS question_threads_owner_question_uidx
  ON question_threads (owner_id, question_id)
  WHERE question_id IS NOT NULL AND deleted_at IS NULL;
