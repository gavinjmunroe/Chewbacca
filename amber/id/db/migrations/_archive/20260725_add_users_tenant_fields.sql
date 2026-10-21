-- Chunk 2a: add tenant-identity columns to users so Cloud SQL becomes the
-- authoritative identity hub (replacing Privy customMetadata + TenantIndex).
--
-- loop_sender_id: the Loop/iMessage sender UUID for this tenant. Unique so
--   /tenants/resolve?sender_id=... can do a direct index scan instead of a
--   full TenantIndex refresh. Populated by the backfill script.
--
-- tenant_metadata: the full decoded Privy customMetadata blob (displayName,
--   agentName, ownerName, loopSenderPhone, onboardingProfile, permissions,
--   contextRepo, writingDoctrine, org, workspaceDocs, preferences,
--   checkInSchedule, phoneNumber, etc.) stored as jsonb. The backfill writes
--   it once; subsequent writes go through /tenants/upsert and PATCH endpoints
--   after 2b lands.
--
-- Both columns are additive only — no read-path changes in this migration.
-- The TenantIndex stays live until Chunk 2b flips the resolvers.

ALTER TABLE users ADD COLUMN IF NOT EXISTS loop_sender_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_metadata jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS users_loop_sender_id_idx
  ON users (loop_sender_id)
  WHERE loop_sender_id IS NOT NULL;
