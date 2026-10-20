/**
 * API key issuance, lookup, and revocation for the Clay-callable dedupe API.
 *
 * Raw key format: `tgi_live_` + 32 random bytes encoded as RFC 4648 base32
 * (no padding). The raw key is shown to the user exactly once at creation
 * time; we persist only its SHA-256 hash plus a 12-char display prefix.
 */

import { BigQuery } from "@google-cloud/bigquery";
import { createHash, randomBytes, randomUUID } from "crypto";
import type { ApiKeyContext } from "../types/index.js";

const PROJECT = process.env.GCP_PROJECT_ID ?? "midyear-glazing-485303-u3";
const DATASET = "togari_dnc";
const TABLE = "api_keys";

const KEY_PREFIX = "tgi_live_";
const RAW_KEY_BYTES = 32;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function makeBQ(): BigQuery {
  const opts: ConstructorParameters<typeof BigQuery>[0] = {
    projectId: PROJECT,
  };
  const b64 = process.env.GCP_CREDENTIALS_BASE64;
  if (b64) opts.credentials = JSON.parse(Buffer.from(b64, "base64").toString());
  return new BigQuery(opts);
}

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function generateRawKey(): string {
  return `${KEY_PREFIX}${base32Encode(randomBytes(RAW_KEY_BYTES))}`;
}

export function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

export interface IssuedKey {
  key: string;
  keyId: string;
  keyPrefix: string;
  name: string | null;
  createdAt: string;
}

export interface KeyRecord {
  keyId: string;
  keyPrefix: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export async function issueKey(
  ownerId: string,
  name: string | null,
): Promise<IssuedKey> {
  const bq = makeBQ();
  const key = generateRawKey();
  const keyId = randomUUID();
  const keyPrefix = key.slice(0, 12);
  const keyHash = hashKey(key);
  const createdAt = new Date();

  await bq.query({
    query: `
      INSERT INTO \`${PROJECT}.${DATASET}.${TABLE}\`
        (key_id, owner_id, key_prefix, key_hash, name, created_at, last_used_at, revoked_at)
      VALUES (@key_id, @owner_id, @key_prefix, @key_hash, @name, @created_at, NULL, NULL)
    `,
    params: {
      key_id: keyId,
      owner_id: ownerId,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      name,
      created_at: createdAt,
    },
    types: {
      key_id: "STRING",
      owner_id: "STRING",
      key_prefix: "STRING",
      key_hash: "STRING",
      name: "STRING",
      created_at: "TIMESTAMP",
    },
    useLegacySql: false,
  });

  return { key, keyId, keyPrefix, name, createdAt: createdAt.toISOString() };
}

export async function verifyKey(rawKey: string): Promise<ApiKeyContext | null> {
  if (!rawKey.startsWith(KEY_PREFIX)) return null;
  const bq = makeBQ();
  const keyHash = hashKey(rawKey);

  const [rows] = await bq.query({
    query: `
      SELECT key_id, owner_id, key_prefix
      FROM \`${PROJECT}.${DATASET}.${TABLE}\`
      WHERE key_hash = @key_hash AND revoked_at IS NULL
      LIMIT 1
    `,
    params: { key_hash: keyHash },
    types: { key_hash: "STRING" },
    useLegacySql: false,
  });

  const row = (
    rows as Array<{ key_id: string; owner_id: string; key_prefix: string }>
  )[0];
  if (!row) return null;

  bq.query({
    query: `
        UPDATE \`${PROJECT}.${DATASET}.${TABLE}\`
        SET last_used_at = CURRENT_TIMESTAMP()
        WHERE key_id = @key_id
      `,
    params: { key_id: row.key_id },
    types: { key_id: "STRING" },
    useLegacySql: false,
  }).catch((err) => {
    process.stderr.write(
      `[api-keys] last_used_at update failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  });

  return {
    ownerId: row.owner_id,
    keyId: row.key_id,
    keyPrefix: row.key_prefix,
  };
}

export async function listKeys(ownerId: string): Promise<KeyRecord[]> {
  const bq = makeBQ();
  const [rows] = await bq.query({
    query: `
      SELECT key_id, key_prefix, name, created_at, last_used_at
      FROM \`${PROJECT}.${DATASET}.${TABLE}\`
      WHERE owner_id = @owner_id AND revoked_at IS NULL
      ORDER BY created_at DESC
    `,
    params: { owner_id: ownerId },
    types: { owner_id: "STRING" },
    useLegacySql: false,
  });

  return (
    rows as Array<{
      key_id: string;
      key_prefix: string;
      name: string | null;
      created_at: { value: string } | string;
      last_used_at: { value: string } | string | null;
    }>
  ).map((r) => ({
    keyId: r.key_id,
    keyPrefix: r.key_prefix,
    name: r.name,
    createdAt:
      typeof r.created_at === "string" ? r.created_at : r.created_at.value,
    lastUsedAt:
      r.last_used_at == null
        ? null
        : typeof r.last_used_at === "string"
          ? r.last_used_at
          : r.last_used_at.value,
  }));
}

export async function revokeKey(keyId: string, ownerId: string): Promise<void> {
  const bq = makeBQ();
  await bq.query({
    query: `
      UPDATE \`${PROJECT}.${DATASET}.${TABLE}\`
      SET revoked_at = CURRENT_TIMESTAMP()
      WHERE key_id = @key_id AND owner_id = @owner_id AND revoked_at IS NULL
    `,
    params: { key_id: keyId, owner_id: ownerId },
    types: { key_id: "STRING", owner_id: "STRING" },
    useLegacySql: false,
  });
}
