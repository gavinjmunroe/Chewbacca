/**
 * Per-client portal API keys.
 *
 * Each external client (e.g. a client on the BMA website login) gets a key scoped to their own
 * client_id, so they never share the internal TOGARI_API_KEY. Keys look like
 * "tgc_<48 hex chars>" and are stored ONLY as SHA-256 hashes in
 * togari_data_lake.client_api_keys — the plaintext is shown to the admin once
 * at issue time and is unrecoverable afterwards.
 *
 * This module is transport-agnostic: the Express middleware (portal-auth.ts)
 * and the admin MCP tools (mcp/tools/client-keys.ts) both call in here.
 */

import crypto from "crypto";
import { BigQueryClient } from "../bigquery/client";
import { resolveDataset } from "../services/dataset-resolver";
import { createLogger } from "../observability/logger";

const logger = createLogger("auth/client-keys");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

function keysTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.client_api_keys\``;
}

/** SHA-256 hex digest of a raw key. Stable for a given input. */
export function hashKey(raw: string): string {
  return crypto.createHash("sha256").update(raw, "utf-8").digest("hex");
}

function parseScopes(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve a raw client key to its client_id + scopes, or null if there is no
 * active matching key. Also best-effort touches last_used_at (errors swallowed).
 */
export async function resolveClientKey(
  bq: BigQueryClient,
  rawKey: string,
): Promise<{ clientId: string; scopes: string[] } | null> {
  if (typeof rawKey !== "string" || !rawKey) return null;
  const hash = hashKey(rawKey);

  const sql = `
    SELECT client_id, scopes
      FROM ${keysTable()}
     WHERE key_hash = @hash
       AND is_active = TRUE
     LIMIT 1
  `.trim();

  const { rows } = await bq.executeQuery(sql, { hash });
  if (rows.length === 0) return null;

  const row = rows[0] as { client_id?: unknown; scopes?: unknown };
  const clientId = typeof row.client_id === "string" ? row.client_id : "";
  if (!clientId) return null;

  // Best-effort last_used_at touch. Never fail auth on a bookkeeping write.
  try {
    const touchSql = `
      UPDATE ${keysTable()}
         SET last_used_at = CURRENT_TIMESTAMP()
       WHERE key_hash = @hash
         AND is_active = TRUE
    `.trim();
    await bq.executeWrite(touchSql, { hash });
  } catch (err) {
    logger.warn("Failed to touch last_used_at for client key", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { clientId, scopes: parseScopes(row.scopes) };
}

/**
 * Issue a new key for a client. Returns the RAW key (shown ONCE) plus its keyId.
 * The caller is responsible for only surfacing the raw key a single time.
 */
export async function issueClientKey(
  bq: BigQueryClient,
  input: { clientId: string; label?: string; scopes?: string[] },
): Promise<{ keyId: string; rawKey: string }> {
  const clientId = input.clientId.trim();
  if (!clientId) throw new Error("clientId is required to issue a client key");

  const keyId = crypto.randomUUID();
  const rawKey = "tgc_" + crypto.randomBytes(24).toString("hex");
  const keyHash = hashKey(rawKey);
  const label = typeof input.label === "string" ? input.label : null;
  const scopes =
    Array.isArray(input.scopes) && input.scopes.length > 0
      ? input.scopes.join(",")
      : null;

  const sql = `
    INSERT INTO ${keysTable()}
      (key_id, client_id, key_hash, label, scopes, is_active, created_at, last_used_at)
    VALUES
      (@key_id, @client_id, @key_hash, @label, @scopes, TRUE, CURRENT_TIMESTAMP(), NULL)
  `.trim();

  await bq.executeWrite(sql, {
    key_id: keyId,
    client_id: clientId,
    key_hash: keyHash,
    label,
    scopes,
    last_used_at: null,
  });

  logger.info("Issued client portal key", {
    keyId,
    clientId,
    hasLabel: !!label,
  });

  return { keyId, rawKey };
}

/** Revoke a key by keyId. Flips is_active to FALSE; the row is never deleted. */
export async function revokeClientKey(
  bq: BigQueryClient,
  keyId: string,
): Promise<void> {
  const id = typeof keyId === "string" ? keyId.trim() : "";
  if (!id) throw new Error("keyId is required to revoke a client key");

  const sql = `
    UPDATE ${keysTable()}
       SET is_active = FALSE
     WHERE key_id = @key_id
  `.trim();

  await bq.executeWrite(sql, { key_id: id });
  logger.info("Revoked client portal key", { keyId: id });
}
