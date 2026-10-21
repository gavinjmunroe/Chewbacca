-- Lossless provenance: keep the FULL original source payload for every
-- contact_sources row (the People API person object, the Apple contact object,
-- etc.) so nothing an upstream sent us is ever dropped by normalization.
-- Idempotent — ADD COLUMN IF NOT EXISTS.

ALTER TABLE contact_sources ADD COLUMN IF NOT EXISTS raw jsonb;   -- full source payload, lossless
