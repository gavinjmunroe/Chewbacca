-- Fix the Q&A Phase 1 collision with the legacy iMessage "daily questions"
-- feature. The Phase 1 migration's CREATE TABLE IF NOT EXISTS questions was a
-- no-op because a legacy `questions` table (id, body, category, active,
-- sort_order, created_at) already existed, so our columns (prompt, answer_type,
-- …) were never added and question_threads/answers FKs point at the legacy
-- table → all Q&A writes fail ("column prompt does not exist").
--
-- DECISION: strip the daily-question feature (legacy tables + its code). This
-- migration drops the legacy tables and rebuilds the Phase 1 schema correctly.
--
-- SAFE / IDEMPOTENT: the destructive drops are guarded on the LEGACY schema
-- still being present (questions.body column). On a collision DB this drops the
-- legacy stack and rebuilds; on a clean or already-fixed DB the DO block is a
-- no-op and the CREATE ... IF NOT EXISTS statements do nothing.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'questions'
               AND column_name = 'body') THEN
    DROP TABLE IF EXISTS question_deliveries;
    DROP TABLE IF EXISTS answers;
    DROP TABLE IF EXISTS thread_messages;
    DROP TABLE IF EXISTS question_threads;
    DROP TABLE IF EXISTS questions;   -- legacy bank; drops questions_id_seq with it
  END IF;
END $$;

-- Phase 1 schema (identical to db/migrations/20260727_add_question_threads.sql).
-- owner_id is users.amber_id stored as text, identical to wall_posts.

CREATE TABLE IF NOT EXISTS questions (
  id           bigserial   PRIMARY KEY,
  prompt       text        NOT NULL,
  answer_type  text        NOT NULL DEFAULT 'text'
               CHECK (answer_type IN ('text','multiple_choice')),
  options      jsonb,
  dimension    text,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE TABLE IF NOT EXISTS question_threads (
  id           bigserial   PRIMARY KEY,
  owner_id     text        NOT NULL,
  question_id  bigint      REFERENCES questions(id),
  kind         text        NOT NULL DEFAULT 'question'
               CHECK (kind IN ('question','freeform')),
  title        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE INDEX IF NOT EXISTS question_threads_owner_updated_idx
  ON question_threads (owner_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS thread_messages (
  id          bigserial   PRIMARY KEY,
  thread_id   bigint      NOT NULL REFERENCES question_threads(id),
  role        text        NOT NULL CHECK (role IN ('amber','user')),
  content     text        NOT NULL,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS thread_messages_thread_created_idx
  ON thread_messages (thread_id, created_at);

CREATE TABLE IF NOT EXISTS answers (
  id             bigserial   PRIMARY KEY,
  question_id    bigint      NOT NULL REFERENCES questions(id),
  thread_id      bigint      REFERENCES question_threads(id),
  owner_id       text        NOT NULL,
  answer_type    text        NOT NULL CHECK (answer_type IN ('text','multiple_choice')),
  answer_text    text,
  answer_choice  text,
  visibility     text        NOT NULL DEFAULT 'private'
                 CHECK (visibility IN ('private','network')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

-- One live answer per question per user (upsertable via this partial unique key).
CREATE UNIQUE INDEX IF NOT EXISTS answers_owner_question_uidx
  ON answers (owner_id, question_id)
  WHERE deleted_at IS NULL;

-- Supports the network feed read (shared answers, newest first).
CREATE INDEX IF NOT EXISTS answers_network_created_idx
  ON answers (visibility, created_at DESC)
  WHERE deleted_at IS NULL AND visibility = 'network';
