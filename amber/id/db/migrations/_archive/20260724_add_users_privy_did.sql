-- Chunk 1.5: DID→amber_id resolution bridge.
--
-- privy_did: lets resolveAmberIdByPrivyDid() map a Privy DID string
-- (did:privy:…) to an amber_id (uuid) without a phone.  The column starts
-- empty and is backfilled in Chunk 2 by the auth flow.  Until then, callers
-- that use this resolver gracefully return empty results (never crash).
--
-- contacts.metadata: stores overflow fields (context, relationship,
-- sourceHandle, avatarUrl, etc.) that the Railway contacts table had as
-- dedicated columns but the Cloud SQL amber contacts table does not.
--
-- contacts.owner_phone nullable: upsertContact is called from paths that
-- have the amber_id but not the owner's phone; make the column optional.
--
-- Idempotent: all statements use IF NOT EXISTS / IF EXISTS guards so running
-- this migration more than once is a no-op.

ALTER TABLE users ADD COLUMN IF NOT EXISTS privy_did text;

CREATE UNIQUE INDEX IF NOT EXISTS users_privy_did_idx
  ON users (privy_did)
  WHERE privy_did IS NOT NULL;

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS metadata jsonb;

ALTER TABLE contacts ALTER COLUMN owner_phone DROP NOT NULL;
