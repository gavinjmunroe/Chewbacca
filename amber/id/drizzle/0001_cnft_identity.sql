-- Migration: add Solana cNFT identity columns to users
-- Branch: sagar/feat/cnft-pinecone-ask
-- Safe to run on an existing deploy; all columns are additive and nullable.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "cnft_mint"          varchar(64) UNIQUE,
  ADD COLUMN IF NOT EXISTS "cnft_asset_id"      varchar(64),
  ADD COLUMN IF NOT EXISTS "cnft_tx_signature"  varchar(128),
  ADD COLUMN IF NOT EXISTS "cnft_merkle_tree"   varchar(64),
  ADD COLUMN IF NOT EXISTS "cnft_minted_at"     timestamptz;

-- Index for the most common lookup: "given a cNFT mint, which user owns it?"
CREATE INDEX IF NOT EXISTS "users_cnft_mint_idx" ON "users" ("cnft_mint");
