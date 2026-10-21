-- CARRY-FORWARD. Nineteen tables whose PURPOSE survives the redesign, brought
-- across from the live schema with two corrections applied to every one of them.
--
-- 1. owner_id BECOMES uuid EVERYWHERE.
--    In prod it is uuid in 30 tables and text in 8. Postgres refuses uuid = text,
--    which is why the favorites join silently returned nothing for weeks: the
--    query raised an error, a swallowed catch turned it into [], and the screen
--    said "no favorites" instead of failing. Every owner_id below is uuid and
--    carries a real foreign key to users(amber_id).
--
-- 2. contact_id BECOMES uuid EVERYWHERE, with a composite FK to
--    contacts(owner_id, contact_id). It was bigint in 9 tables and text in 1.
--
-- Both changes are free here because the data is being rebuilt, not migrated.
--
-- NOT CARRIED, AND WHY:
--   absorbed into observations  contact_facts, contact_notes, contact_experiences,
--                               contact_name_memory, app_conversation_messages,
--                               conversation_messages, note_audio, note_comments,
--                               note_reactions, note_shares, user_facts,
--                               contact_embedding, pending_fact_context
--   never held a row            shares, permissions, personality_profiles,
--                               people_rank_feedback, thread_messages,
--                               intro_requests, onboarding_progress,
--                               clay_destinations, permission_audit
--   redesigned in 002-010       users, contacts, contact_identity_keys, circles,
--                               circle_members, circle_member_seen, connections,
--                               voice_vocabulary, contact_favorites, device_sessions
--
-- FOUND WHILE DOING THIS: dm_threads, dm_messages, dm_reactions, dm_reads,
-- dm_clears, dm_blocks and user_identities DO NOT EXIST IN PROD. Their migrations
-- were recorded as applied by the baseline without ever having run, so the whole
-- DM feature would 500 on first use. Rebuilding from files fixes that class of
-- problem permanently -- which is the point of the exercise.

CREATE TABLE agent_data (
  owner_id                   uuid NOT NULL,
  table_name                 text NOT NULL,
  row_key                    text NOT NULL,
  row                        jsonb NOT NULL,
  created_at                 timestamptz DEFAULT now() NOT NULL,
  updated_at                 timestamptz DEFAULT now() NOT NULL,
  deleted_at                 timestamptz,
  CONSTRAINT agent_data_owner_fk FOREIGN KEY (owner_id)
    REFERENCES users (amber_id) ON DELETE CASCADE
);
CREATE INDEX agent_data_owner_table_active_idx ON agent_data USING btree (owner_id, table_name) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX agent_data_owner_table_key_idx ON agent_data USING btree (owner_id, table_name, row_key);

CREATE TABLE agent_log (
  id                         bigserial,
  owner_id                   uuid NOT NULL,
  table_name                 text NOT NULL,
  row                        jsonb NOT NULL,
  created_at                 timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT agent_log_pkey PRIMARY KEY (id),
  CONSTRAINT agent_log_owner_fk FOREIGN KEY (owner_id)
    REFERENCES users (amber_id) ON DELETE CASCADE
);
CREATE INDEX agent_log_owner_table_created_idx ON agent_log USING btree (owner_id, table_name, created_at DESC);

CREATE TABLE answers (
  id                         bigserial,
  question_id                bigint NOT NULL,
  thread_id                  bigint,
  owner_id                   uuid NOT NULL,
  answer_type                text NOT NULL,
  answer_text                text,
  answer_choice              text,
  visibility                 text DEFAULT 'private'::text NOT NULL,
  created_at                 timestamptz DEFAULT now() NOT NULL,
  updated_at                 timestamptz DEFAULT now() NOT NULL,
  deleted_at                 timestamptz,
  CONSTRAINT answers_pkey PRIMARY KEY (id),
  CONSTRAINT answers_answer_type_check CHECK ((answer_type = ANY (ARRAY['text'::text, 'multiple_choice'::text]))),
  CONSTRAINT answers_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'network'::text]))),
  CONSTRAINT answers_owner_fk FOREIGN KEY (owner_id)
    REFERENCES users (amber_id) ON DELETE CASCADE
);
CREATE INDEX answers_network_created_idx ON answers USING btree (visibility, created_at DESC) WHERE ((deleted_at IS NULL) AND (visibility = 'network'::text));
CREATE UNIQUE INDEX answers_owner_question_uidx ON answers USING btree (owner_id, question_id) WHERE (deleted_at IS NULL);

CREATE TABLE connection_requests (
  id                         bigserial,
  requester_amber_id         uuid NOT NULL,
  addressee_amber_id         uuid NOT NULL,
  status                     text DEFAULT 'pending'::text NOT NULL,
  message                    text,
  created_at                 timestamptz DEFAULT now() NOT NULL,
  updated_at                 timestamptz DEFAULT now() NOT NULL,
  responded_at               timestamptz,
  deleted_at                 timestamptz,
  CONSTRAINT connection_requests_pkey PRIMARY KEY (id)
);
CREATE INDEX conn_req_addressee_idx ON connection_requests USING btree (addressee_amber_id, status);
CREATE UNIQUE INDEX conn_req_pending_uidx ON connection_requests USING btree (requester_amber_id, addressee_amber_id) WHERE ((status = 'pending'::text) AND (deleted_at IS NULL));

CREATE TABLE contact_review_candidates (
  id                         bigserial,
  owner_id                   uuid NOT NULL,
  contact_id                 uuid NOT NULL,
  candidate_contact_id       uuid NOT NULL,
  reason                     text NOT NULL,
  detail                     jsonb,
  created_at                 timestamptz DEFAULT now() NOT NULL,
  updated_at                 timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT contact_review_candidates_pkey PRIMARY KEY (id),
  CONSTRAINT contact_review_candidates_owner_contact_fk FOREIGN KEY (owner_id, contact_id)
    REFERENCES contacts (owner_id, id) ON DELETE CASCADE
);
CREATE INDEX contact_review_candidates_owner_idx ON contact_review_candidates USING btree (owner_id, reason);
CREATE UNIQUE INDEX contact_review_candidates_uidx ON contact_review_candidates USING btree (owner_id, contact_id, candidate_contact_id, reason);

CREATE TABLE contact_sources (
  id                         bigserial,
  owner_id                   uuid NOT NULL,
  contact_id                 uuid NOT NULL,
  source                     text NOT NULL,
  external_id                text NOT NULL,
  raw_full_name              text,
  raw_emails                 text,
  raw_phones                 text,
  raw_company                text,
  created_at                 timestamptz DEFAULT now() NOT NULL,
  updated_at                 timestamptz DEFAULT now() NOT NULL,
  deleted_at                 timestamptz,
  raw                        jsonb,
  CONSTRAINT contact_sources_pkey PRIMARY KEY (id),
  CONSTRAINT contact_sources_owner_contact_fk FOREIGN KEY (owner_id, contact_id)
    REFERENCES contacts (owner_id, id) ON DELETE CASCADE
);
CREATE INDEX contact_sources_contact_idx ON contact_sources USING btree (contact_id) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX contact_sources_owner_source_ext_uidx ON contact_sources USING btree (owner_id, source, external_id) WHERE (deleted_at IS NULL);

CREATE TABLE otp_codes (
  id                         bigserial,
  phone                      text NOT NULL,
  code_hash                  text NOT NULL,
  code_only_hash             text NOT NULL,
  attempts                   integer DEFAULT 0 NOT NULL,
  expires_at                 timestamptz NOT NULL,
  last_sent_at               timestamptz DEFAULT now() NOT NULL,
  requester_ip               text,
  created_at                 timestamptz DEFAULT now() NOT NULL,
  deleted_at                 timestamptz,
  CONSTRAINT otp_codes_pkey PRIMARY KEY (id)
);
CREATE INDEX otp_codes_code_only_active_idx ON otp_codes USING btree (code_only_hash) WHERE (deleted_at IS NULL);
CREATE INDEX otp_codes_ip_created_idx ON otp_codes USING btree (requester_ip, created_at) WHERE (requester_ip IS NOT NULL);
CREATE INDEX otp_codes_phone_active_idx ON otp_codes USING btree (phone) WHERE (deleted_at IS NULL);

CREATE TABLE pending_oauth (
  state                      text NOT NULL,
  data                       jsonb NOT NULL,
  created_at                 timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pending_oauth_pkey PRIMARY KEY (state)
);

CREATE TABLE push_tokens (
  id                         bigserial,
  owner_id                   uuid NOT NULL,
  token_hash                 text NOT NULL,
  platform                   text,
  created_at                 timestamptz DEFAULT now() NOT NULL,
  deleted_at                 timestamptz,
  token                      text,
  updated_at                 timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT push_tokens_owner_id_token_hash_key UNIQUE (owner_id, token_hash),
  CONSTRAINT push_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT push_tokens_owner_fk FOREIGN KEY (owner_id)
    REFERENCES users (amber_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_push_tokens_owner_token ON push_tokens USING btree (owner_id, token_hash);

CREATE TABLE question_threads (
  id                         bigserial,
  owner_id                   uuid NOT NULL,
  question_id                bigint,
  kind                       text DEFAULT 'question'::text NOT NULL,
  title                      text,
  created_at                 timestamptz DEFAULT now() NOT NULL,
  updated_at                 timestamptz DEFAULT now() NOT NULL,
  deleted_at                 timestamptz,
  CONSTRAINT question_threads_pkey PRIMARY KEY (id),
  CONSTRAINT question_threads_kind_check CHECK ((kind = ANY (ARRAY['question'::text, 'freeform'::text]))),
  CONSTRAINT question_threads_owner_fk FOREIGN KEY (owner_id)
    REFERENCES users (amber_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX question_threads_owner_question_uidx ON question_threads USING btree (owner_id, question_id) WHERE ((question_id IS NOT NULL) AND (deleted_at IS NULL));
CREATE INDEX question_threads_owner_updated_idx ON question_threads USING btree (owner_id, updated_at DESC) WHERE (deleted_at IS NULL);

CREATE TABLE questions (
  id                         bigserial,
  prompt                     text NOT NULL,
  answer_type                text DEFAULT 'text'::text NOT NULL,
  options                    jsonb,
  dimension                  text,
  created_by                 text,
  created_at                 timestamptz DEFAULT now() NOT NULL,
  deleted_at                 timestamptz,
  followups                  jsonb,
  waterfall                  text,
  CONSTRAINT questions_pkey PRIMARY KEY (id),
  CONSTRAINT questions_answer_type_check CHECK ((answer_type = ANY (ARRAY['text'::text, 'multiple_choice'::text])))
);

CREATE TABLE reminders (
  reminder_id                text NOT NULL,
  owner_id                   uuid NOT NULL,
  status                     text NOT NULL,
  due_at                     timestamptz,
  created_at                 timestamptz DEFAULT now() NOT NULL,
  data                       jsonb NOT NULL,
  CONSTRAINT reminders_pkey PRIMARY KEY (reminder_id),
  CONSTRAINT reminders_owner_fk FOREIGN KEY (owner_id)
    REFERENCES users (amber_id) ON DELETE CASCADE
);
CREATE INDEX reminders_due_idx ON reminders USING btree (status, due_at);
CREATE INDEX reminders_owner_status_idx ON reminders USING btree (owner_id, status);
CREATE INDEX reminders_self_due_idx ON reminders USING btree (due_at) WHERE ((status = 'pending'::text) AND ((data ->> 'origin'::text) = 'self_reminder'::text));

CREATE TABLE secrets (
  owner_id                   uuid NOT NULL,
  key_name                   text NOT NULL,
  value_encrypted            text,
  updated_by                 text,
  created_at                 timestamptz DEFAULT now() NOT NULL,
  updated_at                 timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT secrets_owner_fk FOREIGN KEY (owner_id)
    REFERENCES users (amber_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX secrets_owner_key_idx ON secrets USING btree (owner_id, key_name);

CREATE TABLE slack_links (
  team                       text NOT NULL,
  slack_user                 text NOT NULL,
  status                     text,
  person_id                  text,
  phone_e164                 text,
  data                       jsonb NOT NULL,
  created_at                 timestamptz DEFAULT now() NOT NULL,
  updated_at                 timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT slack_links_pkey PRIMARY KEY (team, slack_user)
);

CREATE TABLE tenant_deks (
  owner_id                   uuid NOT NULL,
  version                    integer NOT NULL,
  wrapped_dek                text NOT NULL,
  wrap_iv                    text NOT NULL,
  wrap_auth_tag              text NOT NULL,
  created_at                 timestamptz DEFAULT now() NOT NULL,
  superseded_at              timestamptz,
  CONSTRAINT tenant_deks_owner_fk FOREIGN KEY (owner_id)
    REFERENCES users (amber_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX tenant_deks_owner_version_idx ON tenant_deks USING btree (owner_id, version);

CREATE TABLE tenant_secret_audit (
  id                         bigserial,
  owner_id                   uuid NOT NULL,
  key_name                   text,
  action                     text,
  caller                     text,
  created_at                 timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT tenant_secret_audit_pkey PRIMARY KEY (id),
  CONSTRAINT tenant_secret_audit_owner_fk FOREIGN KEY (owner_id)
    REFERENCES users (amber_id) ON DELETE CASCADE
);

CREATE TABLE tenant_secrets_v2 (
  owner_id                   uuid NOT NULL,
  key_name                   text NOT NULL,
  ciphertext                 text NOT NULL,
  iv                         text NOT NULL,
  auth_tag                   text NOT NULL,
  dek_version                integer NOT NULL,
  created_at                 timestamptz DEFAULT now() NOT NULL,
  updated_at                 timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT tenant_secrets_v2_owner_fk FOREIGN KEY (owner_id)
    REFERENCES users (amber_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX tenant_secrets_v2_owner_key_idx ON tenant_secrets_v2 USING btree (owner_id, key_name);

CREATE TABLE user_api_keys (
  id                         bigserial,
  key_id                     text NOT NULL,
  owner_id                   uuid NOT NULL,
  key_hash                   text NOT NULL,
  key_prefix                 text NOT NULL,
  last4                      text NOT NULL,
  name                       text,
  created_at                 timestamptz DEFAULT now() NOT NULL,
  last_used_at               timestamptz,
  revoked_at                 timestamptz,
  CONSTRAINT user_api_keys_key_hash_key UNIQUE (key_hash),
  CONSTRAINT user_api_keys_key_id_key UNIQUE (key_id),
  CONSTRAINT user_api_keys_pkey PRIMARY KEY (id),
  CONSTRAINT user_api_keys_owner_fk FOREIGN KEY (owner_id)
    REFERENCES users (amber_id) ON DELETE CASCADE
);
CREATE INDEX idx_user_api_keys_hash ON user_api_keys USING btree (key_hash);
CREATE INDEX idx_user_api_keys_owner ON user_api_keys USING btree (owner_id);

CREATE TABLE wall_posts (
  id                         bigserial,
  owner_id                   uuid NOT NULL,
  text                       text NOT NULL,
  visibility                 text DEFAULT 'private'::text NOT NULL,
  created_at                 timestamptz DEFAULT now() NOT NULL,
  updated_at                 timestamptz DEFAULT now() NOT NULL,
  deleted_at                 timestamptz,
  CONSTRAINT wall_posts_pkey PRIMARY KEY (id),
  CONSTRAINT wall_posts_owner_fk FOREIGN KEY (owner_id)
    REFERENCES users (amber_id) ON DELETE CASCADE
);
CREATE INDEX wall_posts_owner_deleted_idx ON wall_posts USING btree (owner_id, deleted_at);

-- agent_data had NO PRIMARY KEY in prod, which means a row cannot be identified
-- -- no safe upsert target, and Datastream cannot replicate it to BigQuery.
-- It is the generic jsonb store behind personal_life, partnerships, pipelines and
-- content_seeds, so it matters. Giving it the key its unique index already implies.
ALTER TABLE agent_data ADD CONSTRAINT agent_data_pkey
  PRIMARY KEY (owner_id, table_name, row_key);

-- Same problem, same fix. All three were unkeyed in prod.
ALTER TABLE secrets           ADD CONSTRAINT secrets_pkey           PRIMARY KEY (owner_id, key_name);
ALTER TABLE tenant_secrets_v2 ADD CONSTRAINT tenant_secrets_v2_pkey PRIMARY KEY (owner_id, key_name);
-- tenant_deks is versioned: one owner holds several wrapped keys over time, so
-- the key is (owner, version) and NOT owner alone.
ALTER TABLE tenant_deks       ADD CONSTRAINT tenant_deks_pkey       PRIMARY KEY (owner_id, version);
