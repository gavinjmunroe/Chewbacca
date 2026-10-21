/**
 * Cloud SQL store for the Amber Q&A feature (Phase 1).
 *
 * Schema (see db/migrations/20260727_add_question_threads.sql):
 *   questions         (id bigserial PK, prompt, answer_type, options jsonb,
 *                      dimension, created_by, created_at, deleted_at)
 *   question_threads  (id bigserial PK, owner_id text, question_id bigint,
 *                      kind, title, created_at, updated_at, deleted_at)
 *   thread_messages   (id bigserial PK, thread_id bigint, role, content,
 *                      metadata jsonb, created_at)
 *   answers           (id bigserial PK, question_id bigint, thread_id bigint,
 *                      owner_id text, answer_type, answer_text, answer_choice,
 *                      visibility, created_at, updated_at, deleted_at)
 *
 * SECURITY INVARIANT: every owner-facing read/write is scoped by the caller's
 * amber_id. No function trusts a client-supplied owner. Thread messages are
 * reached only after the route verifies thread ownership via getThread.
 */

import { query } from "./sql.js";

// Parse a positive integer from any input. Returns null for invalid inputs.
function _toInt(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function _questionRow(r) {
  if (!r) return null;
  return {
    id: String(r.id),
    prompt: r.prompt,
    answerType: r.answer_type,
    options: r.options ?? null,
    dimension: r.dimension ?? null,
    followups: r.followups ?? null,
    waterfall: r.waterfall ?? null,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
  };
}

function _threadRow(r) {
  if (!r) return null;
  return {
    id: String(r.id),
    ownerId: String(r.owner_id),
    questionId: r.question_id != null ? String(r.question_id) : null,
    kind: r.kind,
    title: r.title ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function _messageRow(r) {
  if (!r) return null;
  return {
    id: String(r.id),
    threadId: String(r.thread_id),
    role: r.role,
    content: r.content,
    metadata: r.metadata ?? null,
    createdAt: r.created_at,
  };
}

function _answerRow(r) {
  if (!r) return null;
  return {
    id: String(r.id),
    questionId: String(r.question_id),
    threadId: r.thread_id != null ? String(r.thread_id) : null,
    ownerId: String(r.owner_id),
    answerType: r.answer_type,
    answerText: r.answer_text ?? null,
    answerChoice: r.answer_choice ?? null,
    visibility: r.visibility,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Create a question. `answerType` ∈ text | multiple_choice; `options` is an
 * array of choice strings (stored jsonb) for multiple_choice, else null.
 * Returns the created question row, or null on error.
 */
export async function createQuestion({
  prompt,
  answerType = "text",
  options = null,
  dimension = null,
  followups = null,
  waterfall = null,
  createdBy = null,
} = {}) {
  if (!prompt || typeof prompt !== "string") return null;
  try {
    const { rows } = await query(
      `INSERT INTO questions (prompt, answer_type, options, dimension, followups, waterfall, created_by)
       VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6, $7)
       RETURNING *`,
      [
        prompt,
        answerType,
        options != null ? JSON.stringify(options) : null,
        dimension ?? null,
        followups != null ? JSON.stringify(followups) : null,
        waterfall ?? null,
        createdBy ?? null,
      ],
    );
    return _questionRow(rows[0]);
  } catch {
    return null;
  }
}

/** Fetch a single (non-deleted) question by id. Returns the row or null. */
export async function getQuestion(questionId) {
  const id = _toInt(questionId);
  if (!id) return null;
  try {
    const { rows } = await query(
      `SELECT * FROM questions WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return _questionRow(rows[0]);
  } catch {
    return null;
  }
}

/**
 * Create an Amber chat thread for the caller, optionally anchored to a
 * question. kind is 'question' when a questionId is given, else 'freeform'.
 *
 * When a questionId is given, the opening 'amber' message (the question prompt)
 * is seeded in the SAME atomic statement via a CTE — so a question thread can
 * never exist without its seed message. Freeform threads seed no message.
 * Returns the created thread row, or null on error.
 */
export async function createThread({ ownerId, questionId } = {}) {
  if (!ownerId) return null;
  const qId = questionId != null ? _toInt(questionId) : null;
  if (questionId != null && !qId) return null;
  try {
    const { rows } = await query(
      `WITH t AS (
         INSERT INTO question_threads (owner_id, question_id, kind)
         VALUES ($1, $2, $3)
         RETURNING *
       ), seed AS (
         INSERT INTO thread_messages (thread_id, role, content, metadata)
         SELECT t.id, 'amber', q.prompt, jsonb_build_object('questionId', q.id)
         FROM t JOIN questions q ON q.id = t.question_id
         WHERE t.question_id IS NOT NULL
         RETURNING 1
       )
       SELECT * FROM t;`,
      [ownerId, qId, qId ? "question" : "freeform"],
    );
    return _threadRow(rows[0]);
  } catch {
    return null;
  }
}

/**
 * Find the caller's live (non-deleted) question-thread for a given question, or
 * null. Owner-scoped. Backed by the partial unique index
 * (owner_id, question_id) WHERE question_id IS NOT NULL AND deleted_at IS NULL,
 * so at most one row can match.
 */
export async function findLiveQuestionThread(ownerId, questionId) {
  const qId = _toInt(questionId);
  if (!ownerId || !qId) return null;
  try {
    const { rows } = await query(
      `SELECT * FROM question_threads
       WHERE owner_id = $1 AND question_id = $2 AND deleted_at IS NULL
       ORDER BY id ASC
       LIMIT 1`,
      [ownerId, qId],
    );
    return rows[0] ? _threadRow(rows[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Deliver a question to a user: ensure a seeded question-thread exists for
 * (ownerId, questionId). Idempotent — the thread IS the delivery. If a live
 * thread already exists it is returned; otherwise it is created via the seeded
 * createThread path. The partial unique index is the concurrency backstop: on a
 * conflict (a racing deliver won), createThread returns null and we re-select
 * the winner. Returns the thread row, or null on genuine failure.
 */
export async function deliverQuestion({ ownerId, questionId } = {}) {
  const qId = _toInt(questionId);
  if (!ownerId || !qId) return null;
  try {
    const existing = await findLiveQuestionThread(ownerId, qId);
    if (existing) return existing;
    const created = await createThread({ ownerId, questionId: qId });
    if (created) return created;
    // Conflict backstop: a concurrent deliver created it — re-select.
    return await findLiveQuestionThread(ownerId, qId);
  } catch {
    return null;
  }
}

/**
 * The caller's PENDING question inbox: question-kind, non-deleted threads whose
 * question has NO live answer for this owner, joined to the question for its
 * prompt/answer_type/options. Newest first. Owner-scoped.
 * Returns [{ threadId, questionId, prompt, answerType, options, createdAt }].
 */
export async function listInbox(ownerId) {
  if (!ownerId) return [];
  try {
    const { rows } = await query(
      `SELECT qt.id AS thread_id, qt.question_id, qt.created_at,
              q.prompt, q.answer_type, q.options
       FROM question_threads qt
       JOIN questions q ON q.id = qt.question_id
       LEFT JOIN answers a
         ON a.owner_id = qt.owner_id
        AND a.question_id = qt.question_id
        AND a.deleted_at IS NULL
       WHERE qt.owner_id = $1
         AND qt.kind = 'question'
         AND qt.deleted_at IS NULL
         AND a.id IS NULL
       ORDER BY qt.created_at DESC, qt.id DESC`,
      [ownerId],
    );
    return rows.map((r) => ({
      threadId: String(r.thread_id),
      questionId: String(r.question_id),
      prompt: r.prompt,
      answerType: r.answer_type,
      options: r.options ?? null,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

/** Fetch one of the caller's threads by id (owner-scoped). Returns row or null. */
export async function getThread(ownerId, threadId) {
  const id = _toInt(threadId);
  if (!ownerId || !id) return null;
  try {
    const { rows } = await query(
      `SELECT * FROM question_threads
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [id, ownerId],
    );
    return _threadRow(rows[0]);
  } catch {
    return null;
  }
}

/** List the caller's threads, most-recently-updated first. */
export async function listThreads(ownerId) {
  if (!ownerId) return [];
  try {
    const { rows } = await query(
      `SELECT * FROM question_threads
       WHERE owner_id = $1 AND deleted_at IS NULL
       ORDER BY updated_at DESC`,
      [ownerId],
    );
    return rows.map(_threadRow);
  } catch {
    return [];
  }
}

/**
 * Append a message to a thread. Callers MUST verify thread ownership first
 * (the route does, via getThread). role ∈ amber | user. Returns the row or null.
 */
export async function appendMessage({ threadId, role, content, metadata = null } = {}) {
  const id = _toInt(threadId);
  if (!id || !role || typeof content !== "string") return null;
  try {
    const { rows } = await query(
      `INSERT INTO thread_messages (thread_id, role, content, metadata)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING *`,
      [id, role, content, metadata != null ? JSON.stringify(metadata) : null],
    );
    // Bump the parent thread so it sorts to the top of listThreads.
    await query(
      `UPDATE question_threads SET updated_at = now() WHERE id = $1`,
      [id],
    );
    return _messageRow(rows[0]);
  } catch {
    return null;
  }
}

/** List a thread's messages oldest-first. Ownership is enforced by the route. */
export async function listMessages(threadId) {
  const id = _toInt(threadId);
  if (!id) return [];
  try {
    const { rows } = await query(
      `SELECT * FROM thread_messages
       WHERE thread_id = $1
       ORDER BY created_at ASC, id ASC`,
      [id],
    );
    return rows.map(_messageRow);
  } catch {
    return [];
  }
}

/**
 * Upsert the caller's answer to a question (one live answer per question per
 * user). Bumps the linked thread's updated_at when threadId is given.
 * Returns the answer row, or null on error.
 */
export async function upsertAnswer({
  ownerId,
  questionId,
  threadId = null,
  answerType,
  answerText = null,
  answerChoice = null,
  visibility = "private",
} = {}) {
  const qId = _toInt(questionId);
  if (!ownerId || !qId || !answerType) return null;
  const tId = threadId != null ? _toInt(threadId) : null;
  try {
    const { rows } = await query(
      `INSERT INTO answers
         (owner_id, question_id, thread_id, answer_type, answer_text, answer_choice, visibility)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (owner_id, question_id) WHERE deleted_at IS NULL
       DO UPDATE SET
         thread_id     = EXCLUDED.thread_id,
         answer_type   = EXCLUDED.answer_type,
         answer_text   = EXCLUDED.answer_text,
         answer_choice = EXCLUDED.answer_choice,
         visibility    = EXCLUDED.visibility,
         updated_at    = now()
       RETURNING *`,
      [ownerId, qId, tId, answerType, answerText ?? null, answerChoice ?? null, visibility],
    );
    if (tId) {
      // Owner-scoped bump so a client can't touch another user's thread.
      await query(
        `UPDATE question_threads SET updated_at = now()
         WHERE id = $1 AND owner_id = $2`,
        [tId, ownerId],
      );
    }
    return _answerRow(rows[0]);
  } catch {
    return null;
  }
}

/**
 * Change the visibility of the caller's answer (owner-scoped).
 * visibility ∈ private | network. Returns the updated row, or null if not
 * found / not owned.
 */
export async function setAnswerVisibility({ ownerId, answerId, visibility } = {}) {
  const id = _toInt(answerId);
  if (!ownerId || !id || !visibility) return null;
  try {
    const { rows } = await query(
      `UPDATE answers SET visibility = $1, updated_at = now()
       WHERE id = $2 AND owner_id = $3 AND deleted_at IS NULL
       RETURNING *`,
      [visibility, id, ownerId],
    );
    return _answerRow(rows[0]);
  } catch {
    return null;
  }
}
