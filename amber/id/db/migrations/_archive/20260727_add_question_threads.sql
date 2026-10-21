-- Amber Q&A — Phase 1 data foundation (Cloud SQL, amber DB).
-- Questions, Amber chat threads anchored to a question, thread messages, and
-- per-user answers. Idempotent — every statement is CREATE ... IF NOT EXISTS.
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
