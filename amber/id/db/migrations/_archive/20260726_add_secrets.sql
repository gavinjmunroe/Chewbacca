-- Chunk 4c-i: move the v1 encrypted secrets bag off Firestore onto Cloud SQL.
-- SECURITY: this table stores ONLY app-layer AES-256-GCM ciphertext produced by
-- lib/secrets-crypto.js (the "v1:<base64>" string form), never plaintext. The
-- crypto and the KEK env are unchanged; this is a storage move only.
--
-- value_encrypted is a TEXT string (encryptSecret returns a string) and is
-- NULLABLE on purpose: a row with a NULL value_encrypted is a "present but
-- unset" key — created by scaffoldSecrets, or by setSecrets(key: null) which
-- clears a value while keeping the key. The Firestore model this replaces
-- stored null blobs for exactly these keys, and listSecretKeys (set=false),
-- getSecrets (key -> null), and scaffoldSecrets all depend on them staying
-- visible. A NOT NULL column would break scaffold and the clear-but-keep path.
--
-- One row per (owner_id, key_name). owner_id is the amber_id uuid.

CREATE TABLE IF NOT EXISTS secrets (
  owner_id uuid NOT NULL,
  key_name text NOT NULL,
  value_encrypted text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS secrets_owner_key_idx ON secrets (owner_id, key_name);
