-- CONSTRAINTS THE REBUILD LOST, AND ONE NAME COLLISION.
--
-- Read out of dump-schema's own link audit against the migrated database. The
-- whole argument for this rebuild was 15 foreign keys becoming 72; it is a poor
-- argument if three of production's own keys quietly failed to make the trip.
--
-- Every one of these existed in production and does not exist in the new schema.
-- I did not drop them on purpose; I rewrote the files those tables live in and
-- did not check the old ALTER statements at the bottom of the dump.

-- ── FOREIGN KEYS PRODUCTION HAD ──────────────────────────────────────────────
--
-- An answer to a question that no longer exists is not a row anybody can
-- interpret, and nothing in the application prevents writing one.
ALTER TABLE answers
  ADD CONSTRAINT answers_question_fk FOREIGN KEY (question_id)
    REFERENCES questions (id) ON DELETE CASCADE;

-- thread_id is nullable -- a standalone answer has no thread -- so this is
-- SET NULL rather than CASCADE: deleting a thread must not delete the answers
-- that were given in it.
ALTER TABLE answers
  ADD CONSTRAINT answers_thread_fk FOREIGN KEY (thread_id)
    REFERENCES question_threads (id) ON DELETE SET NULL;

ALTER TABLE question_threads
  ADD CONSTRAINT question_threads_question_fk FOREIGN KEY (question_id)
    REFERENCES questions (id) ON DELETE SET NULL;

-- ── FOREIGN KEYS PRODUCTION NEVER HAD, ON A TABLE THAT NEEDS THEM ────────────
--
-- connection_requests names two accounts and constrained neither. A request from
-- or to a deleted account is a row the connections UI will try to render a name
-- for and fail.
ALTER TABLE connection_requests
  ADD CONSTRAINT conn_req_requester_fk FOREIGN KEY (requester_amber_id)
    REFERENCES users (amber_id) ON DELETE CASCADE,
  ADD CONSTRAINT conn_req_addressee_fk FOREIGN KEY (addressee_amber_id)
    REFERENCES users (amber_id) ON DELETE CASCADE;

-- The actor of an audited action, enforced but NOT cascading: deleting a user
-- must never delete the record of what they did. That is the entire point of an
-- audit log, and it is why this is SET NULL where the others are CASCADE.
ALTER TABLE audit_log
  ADD CONSTRAINT audit_actor_fk FOREIGN KEY (actor_amber_id)
    REFERENCES users (amber_id) ON DELETE SET NULL;

-- ── UNIQUENESS PRODUCTION HAD ────────────────────────────────────────────────
--
-- WITHOUT THIS, TWO PEOPLE CAN TAKE THE SAME USERNAME. Only schema.js declares
-- username unique, and that file is a Drizzle description of the schema, not the
-- schema -- nothing generated from it runs against this database. Case-folded
-- and live-only, exactly as production had it: "Karthik" and "karthik" are one
-- name, and a deleted account does not hold its username hostage.
CREATE UNIQUE INDEX users_username_lower_uidx ON users (lower(username))
  WHERE username IS NOT NULL AND deleted_at IS NULL;

-- Two accounts on one Auth0 subject means a login resolving to either of them.
CREATE UNIQUE INDEX users_auth0_sub_uidx ON users (auth0_sub)
  WHERE auth0_sub IS NOT NULL;

CREATE UNIQUE INDEX users_loop_sender_id_uidx ON users (loop_sender_id)
  WHERE loop_sender_id IS NOT NULL;

-- ── THE NAME COLLISION ───────────────────────────────────────────────────────
--
-- audit_log.subject_id was uuid; device_sessions.subject_id is text. Two columns
-- with one name and two types is the exact shape of the bug this project already
-- shipped -- contacts.owner_id uuid against contact_favorites.owner_id text,
-- which made Postgres refuse the join, which a swallowed catch turned into "no
-- favorites" for weeks. These two are genuinely different things (a thing acted
-- upon; an authentication subject) and no query joins them today, so this is not
-- that bug. It is the same trap left lying around for whoever writes the query
-- that does join them.
--
-- audit_log is new in this rebuild and empty, and nothing reads it yet, so the
-- rename is free now and will not be later.
ALTER TABLE audit_log RENAME COLUMN subject_type TO target_type;
ALTER TABLE audit_log RENAME COLUMN subject_id   TO target_id;
