-- Voice-note sharing (transcript-only). A "voice note" is a chat/dictation
-- thread in app_conversation_messages (owner_id + conversation_id); its
-- transcript is the thread's message content. A note defaults to PRIVATE — the
-- ABSENCE of a note_shares row — and can be shared to exactly ONE audience at a
-- time (one row per note, PK = owner_id + conversation_id):
--   network — every user the owner is connected to        (scope_ref = NULL)
--   circle  — every current member of ONE circle the owner (scope_ref = circle_id)
--             owns; also surfaces in that circle's feed
--   contact — one contact of the owner, if that contact    (scope_ref = contact_id)
--             resolves to an Amber user
--
-- Reuses the existing audience tables (circles / circle_members / connections /
-- contacts / contact_identity_keys) and the circle_member_seen table for the
-- per-circle unseen "glowing dot". Visibility is resolved at READ time against
-- current membership / connections, so membership changes take effect instantly
-- and a contact who is not yet an Amber user simply sees nothing until they sign
-- up on the matching phone.
--
-- Idempotent. Safe to run against prod. Until 2026-08-26 note-shares-store.js
-- ALSO created this table at request time; that lazy path has been removed and
-- this file is now the only definition.

CREATE TABLE IF NOT EXISTS note_shares (
  owner_id        uuid        NOT NULL,
  conversation_id text        NOT NULL,
  scope_type      text        NOT NULL,
  scope_ref       bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, conversation_id),
  CONSTRAINT note_shares_scope_type_chk
    CHECK (scope_type IN ('network','circle','contact'))
);

CREATE INDEX IF NOT EXISTS note_shares_scope_idx ON note_shares (scope_type, scope_ref);
CREATE INDEX IF NOT EXISTS note_shares_owner_idx ON note_shares (owner_id);
