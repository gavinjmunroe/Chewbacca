/**
 * Per-tenant encrypted secret store.
 *
 * Stores per-tenant API keys + credentials (OpenAI, ZoomInfo PKI triple,
 * Anthropic, etc.) in BigQuery as AES-256-GCM ciphertext. The master key
 * (TENANT_SECRETS_MASTER_KEY, 32 bytes / 64 hex chars) lives only in the
 * runtime environment; plaintext NEVER lives in BigQuery.
 *
 * Threat model:
 *   - An attacker with BQ read access cannot recover any secret without the
 *     master key.
 *   - An attacker with the master key but not BQ access cannot recover any
 *     secret without ciphertext.
 *   - GCM authentication tags detect any tampering with stored ciphertext.
 *
 * Notes:
 *   - 12-byte random nonce per write (NIST SP 800-38D recommendation for GCM).
 *   - 16-byte auth tag persisted alongside ciphertext so reads can verify.
 *   - On decrypt failure (bad auth tag, wrong master key) this module THROWS.
 *     We never fall back silently, because silent fallback would mask a real
 *     security incident (key rotation gone wrong, ciphertext tampered, etc.).
 */

import crypto from "node:crypto";
import { BigQuery } from "@google-cloud/bigquery";

import { createLogger } from "../observability/logger";

const logger = createLogger("secrets/tenantSecrets");

const TABLE_FQN = "togari_core.tenant_secrets";
const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MASTER_KEY_HEX_LENGTH = 64; // 32 bytes

// ─── Master key (lazy load + validate) ──────────────────────────────────────

let cachedMasterKey: Buffer | null = null;

/**
 * Resolve the 32-byte master key from TENANT_SECRETS_MASTER_KEY.
 * Throws with a clear message if unset or malformed.
 */
function getMasterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;

  const raw = process.env.TENANT_SECRETS_MASTER_KEY;
  if (!raw) {
    throw new Error(
      "TENANT_SECRETS_MASTER_KEY is required to read or write tenant secrets. " +
        "Generate one with `openssl rand -hex 32` and set it in the runtime env.",
    );
  }
  if (raw.length !== MASTER_KEY_HEX_LENGTH || !/^[0-9a-fA-F]+$/.test(raw)) {
    throw new Error(
      `TENANT_SECRETS_MASTER_KEY must be ${MASTER_KEY_HEX_LENGTH} hex chars ` +
        `(32 bytes). Got length=${raw.length}.`,
    );
  }
  cachedMasterKey = Buffer.from(raw, "hex");
  return cachedMasterKey;
}

/**
 * Test-only: clear the in-memory master key cache so tests can swap env vars
 * between cases. Exported under a clear name so production code does not
 * accidentally invalidate the cache.
 */
export function __resetMasterKeyCacheForTests(): void {
  cachedMasterKey = null;
}

// ─── BigQuery client (lazy) ─────────────────────────────────────────────────

/**
 * Minimal BQ interface so tests can inject a stub without spinning up a real
 * client. We don't import `BigQueryClient` here because that wrapper blocks
 * DELETE statements at the string level, and `deleteTenantSecret` needs DML
 * DELETE. The raw client is the right layer for this module.
 */
export interface SecretsBackend {
  query(opts: {
    query: string;
    params?: Record<string, unknown>;
  }): Promise<[Array<Record<string, unknown>>]>;
}

let cachedBackend: SecretsBackend | null = null;
let backendOverride: SecretsBackend | null = null;

function backend(): SecretsBackend {
  if (backendOverride) return backendOverride;
  if (cachedBackend) return cachedBackend;
  const projectId = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
  const credentialsBase64 =
    process.env.GCP_CREDENTIALS_BASE64 ||
    process.env.GOOGLE_CREDENTIALS_BASE64 ||
    null;
  const opts: Record<string, unknown> = { projectId };
  if (credentialsBase64) {
    const decoded = Buffer.from(credentialsBase64, "base64").toString("utf-8");
    opts.credentials = JSON.parse(decoded);
  }
  cachedBackend = new BigQuery(opts) as unknown as SecretsBackend;
  return cachedBackend;
}

/**
 * Test-only: inject a stub backend. Pass `null` to clear and fall back to the
 * lazy real client.
 */
export function __setSecretsBackendForTests(b: SecretsBackend | null): void {
  backendOverride = b;
  cachedBackend = null;
}

// ─── Crypto primitives ──────────────────────────────────────────────────────

interface EncryptedRecord {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
}

function encrypt(plaintext: string): EncryptedRecord {
  const key = getMasterKey();
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new Error(
      `Unexpected auth tag length: ${authTag.length}, expected ${AUTH_TAG_BYTES}`,
    );
  }
  return { ciphertext, nonce, authTag };
}

function decrypt(record: EncryptedRecord): string {
  const key = getMasterKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, record.nonce);
  decipher.setAuthTag(record.authTag);
  // GCM .final() throws on auth tag mismatch — we let it propagate.
  const plaintext = Buffer.concat([
    decipher.update(record.ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Read a per-tenant secret. Returns `null` if no row exists.
 * Throws if decryption fails (tampered ciphertext, wrong master key).
 */
export async function getTenantSecret(
  tenantId: string,
  keyName: string,
): Promise<string | null> {
  if (!tenantId) throw new Error("tenantId is required");
  if (!keyName) throw new Error("keyName is required");

  const [rows] = await backend().query({
    query: `SELECT ciphertext_b64, nonce_b64, auth_tag_b64
            FROM \`${TABLE_FQN}\`
            WHERE tenant_id = @tenant_id AND key_name = @key_name
            LIMIT 1`,
    params: { tenant_id: tenantId, key_name: keyName },
  });

  const row = rows[0];
  if (!row) return null;

  try {
    return decrypt({
      ciphertext: Buffer.from(String(row.ciphertext_b64), "base64"),
      nonce: Buffer.from(String(row.nonce_b64), "base64"),
      authTag: Buffer.from(String(row.auth_tag_b64), "base64"),
    });
  } catch (err) {
    logger.error(
      `decrypt failed for tenant=${tenantId} key=${keyName} — possible tamper or wrong master key`,
      err,
    );
    throw err;
  }
}

/**
 * Upsert a per-tenant secret. Idempotent on (tenant_id, key_name) — re-calling
 * with new plaintext rotates the value and bumps `rotated_at`.
 */
export async function setTenantSecret(
  tenantId: string,
  keyName: string,
  plaintext: string,
): Promise<void> {
  if (!tenantId) throw new Error("tenantId is required");
  if (!keyName) throw new Error("keyName is required");
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("plaintext must be a non-empty string");
  }

  const { ciphertext, nonce, authTag } = encrypt(plaintext);

  // MERGE upsert — on match we rotate (update ciphertext + bump rotated_at);
  // on no match we insert.
  await backend().query({
    query: `MERGE INTO \`${TABLE_FQN}\` AS target
            USING (SELECT
              @tenant_id      AS tenant_id,
              @key_name       AS key_name,
              @ciphertext_b64 AS ciphertext_b64,
              @nonce_b64      AS nonce_b64,
              @auth_tag_b64   AS auth_tag_b64
            ) AS source
            ON target.tenant_id = source.tenant_id
               AND target.key_name = source.key_name
            WHEN MATCHED THEN UPDATE SET
              ciphertext_b64 = source.ciphertext_b64,
              nonce_b64      = source.nonce_b64,
              auth_tag_b64   = source.auth_tag_b64,
              rotated_at     = CURRENT_TIMESTAMP()
            WHEN NOT MATCHED THEN INSERT (
              tenant_id, key_name, ciphertext_b64, nonce_b64, auth_tag_b64,
              created_at, rotated_at
            ) VALUES (
              source.tenant_id, source.key_name, source.ciphertext_b64,
              source.nonce_b64, source.auth_tag_b64,
              CURRENT_TIMESTAMP(), NULL
            )`,
    params: {
      tenant_id: tenantId,
      key_name: keyName,
      ciphertext_b64: ciphertext.toString("base64"),
      nonce_b64: nonce.toString("base64"),
      auth_tag_b64: authTag.toString("base64"),
    },
  });
}

/**
 * Alias for `setTenantSecret` that makes the intent at the call site clearer
 * when an existing secret is being replaced.
 */
export async function rotateTenantSecret(
  tenantId: string,
  keyName: string,
  newPlaintext: string,
): Promise<void> {
  return setTenantSecret(tenantId, keyName, newPlaintext);
}

/**
 * Remove a per-tenant secret. Idempotent — deleting a non-existent row is a
 * no-op.
 */
export async function deleteTenantSecret(
  tenantId: string,
  keyName: string,
): Promise<void> {
  if (!tenantId) throw new Error("tenantId is required");
  if (!keyName) throw new Error("keyName is required");
  await backend().query({
    query: `DELETE FROM \`${TABLE_FQN}\`
            WHERE tenant_id = @tenant_id AND key_name = @key_name`,
    params: { tenant_id: tenantId, key_name: keyName },
  });
}
