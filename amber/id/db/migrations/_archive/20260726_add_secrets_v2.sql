-- Chunk 4c-ii: move the v2 per-tenant DEK secret store off Firestore onto
-- Cloud SQL amber. SECURITY: these tables hold ONLY wrapped DEKs and AES-256-GCM
-- ciphertext produced by secrets-v2/crypto.js — never plaintext, never an
-- unwrapped DEK. The crypto and the KEK env (MEDHA_SECRETS_KEK) are unchanged;
-- this is a storage move only. All wrapped-DEK/ciphertext fields are base64
-- strings (text); versions are ints.
--
-- owner_id is the amber_id uuid (resolved from the tenantDid at the store layer).

CREATE TABLE IF NOT EXISTS tenant_secrets_v2 (
  owner_id uuid NOT NULL,
  key_name text NOT NULL,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  dek_version int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_secrets_v2_owner_key_idx
  ON tenant_secrets_v2 (owner_id, key_name);

CREATE TABLE IF NOT EXISTS tenant_deks (
  owner_id uuid NOT NULL,
  version int NOT NULL,
  wrapped_dek text NOT NULL,
  wrap_iv text NOT NULL,
  wrap_auth_tag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_deks_owner_version_idx
  ON tenant_deks (owner_id, version);

CREATE TABLE IF NOT EXISTS tenant_secret_audit (
  id bigserial PRIMARY KEY,
  owner_id uuid,
  key_name text,
  action text,
  caller text,
  created_at timestamptz NOT NULL DEFAULT now()
);
