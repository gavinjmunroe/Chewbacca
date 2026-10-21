-- A PHOTON SPACE ID IS NOT A UUID, AND EVERY iMESSAGE TURN PAID FOR IT.
--
-- conversations.conversation_id is a uuid. Photon hands us space ids shaped like
-- `spc-8f2a...`, and both sides of the iMessage history path push that string
-- through asUuid(), which returns null for anything that is not a uuid. So:
--
--   appendMessage({ spaceId: "spc-8f2a" })   asUuid -> null, falls to the else
--                                            branch, INSERTs a BRAND NEW
--                                            conversation. Every single message.
--
--   loadRecentMessages(owner, "spc-8f2a")    asUuid -> null, returns [] before
--                                            it queries anything. Every time.
--
-- Neither one errored. iMessage has therefore never had durable history: Amber
-- answers from spaceMemory, an in-process Map capped at twelve turns that dies
-- on every redeploy, and the database has been accumulating one orphaned
-- one-message conversation per inbound text since the webhook shipped.
--
-- WHY A COLUMN RATHER THAN HASHING THE STRING INTO A UUID. A v5-style derived
-- uuid needs no migration and is genuinely deterministic, which is why it is
-- tempting. It also makes "which conversation is this Photon space" unanswerable
-- in SQL without recomputing the hash, turns every future debugging session into
-- an archaeology problem, and quietly bakes a hash function into the identity of
-- a row forever. The honest version is a column that says what it is.
--
-- kind='space' finally means something too. It has been in the CHECK since
-- migration 014 and nothing has ever written it, because the only thing that
-- could was this path.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS external_id text;

COMMENT ON COLUMN conversations.external_id IS
  'The id this thread has in the system it came from, e.g. a Photon iMessage space id (spc-...). NULL for threads that originate in the app.';

-- ONE THREAD PER SPACE PER OWNER, enforced rather than hoped for.
--
-- The whole defect was two callers disagreeing about which row a space maps to,
-- so the fix cannot rest on both call sites remembering to look it up. Scoped to
-- the owner because a group space is one Photon id that legitimately maps to a
-- different thread for each participant.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_owner_external_uidx
  ON conversations (owner_id, external_id)
  WHERE external_id IS NOT NULL;
