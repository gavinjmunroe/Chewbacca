/**
 * Field-level encryption for the per-user secret store.
 *
 * Each value is encrypted with AES-256-GCM using a master key supplied via
 * SECRETS_MASTER_KEY (base64-encoded 32 bytes). We store a key-version prefix
 * followed by the IV, ciphertext, and auth tag:
 *
 *   "v1:" + b64( iv (12B) | ciphertext | auth_tag (16B) )
 *
 * The "v1:" prefix lets us detect which key version encrypted a given value
 * so key rotation can re-encrypt without silent decryption failures. Values
 * that arrive without a version prefix are treated as the legacy "v0" format
 * — installations that wrote unprefixed blobs before the version scheme can
 * configure SECRETS_MASTER_KEY_V0 to decrypt them. If V0 is not configured
 * we fall back to the current master key (the common case: legacy data was
 * encrypted with what is still the current key, so nothing else is needed).
 *
 * Key rotation: set SECRETS_MASTER_KEY to the new key and set
 * SECRETS_MASTER_KEY_V0 / SECRETS_MASTER_KEY_V1 to the older keys. decrypt
 * will pick the key matching the version prefix on the blob. Unprefixed
 * blobs decrypt with V0 (or current as fallback).
 */

import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const CURRENT_VERSION = "v1";

const keyCache = new Map();

function loadKey(envVar) {
  if (keyCache.has(envVar)) return keyCache.get(envVar);
  const raw = process.env[envVar];
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `${envVar} must decode to 32 bytes (got ${key.length})`,
    );
  }
  keyCache.set(envVar, key);
  return key;
}

function loadMasterKey() {
  const key = loadKey("SECRETS_MASTER_KEY");
  if (!key) {
    throw new Error(
      "SECRETS_MASTER_KEY is required. Generate with: openssl rand -base64 32",
    );
  }
  return key;
}

export function encryptSecret(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  const key = loadMasterKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, ct, tag]).toString("base64");
  return `${CURRENT_VERSION}:${payload}`;
}

export function decryptSecret(blob) {
  if (blob === null || blob === undefined || blob === "") return null;
  if (typeof blob !== "string") {
    throw new Error("ciphertext must be a string");
  }

  // Parse optional version prefix: "v1:...". Unprefixed blobs are treated
  // as the legacy v0 format. The prefix must look like a short version tag
  // (lowercase 'v' followed by digits) or it's part of base64 payload.
  let version = "v0";
  let encoded = blob;
  const versionMatch = /^(v\d{1,3}):/.exec(blob);
  if (versionMatch) {
    version = versionMatch[1];
    encoded = blob.slice(versionMatch[0].length);
  }

  // Resolve key for this version. v1 (current) always uses SECRETS_MASTER_KEY.
  // v0 uses SECRETS_MASTER_KEY_V0 if configured, else the current master
  // (matches the pre-versioning behavior where everything used one key).
  // Other versions: SECRETS_MASTER_KEY_V{n}.
  let key;
  if (version === CURRENT_VERSION) {
    key = loadMasterKey();
  } else if (version === "v0") {
    key = loadKey("SECRETS_MASTER_KEY_V0") || loadMasterKey();
  } else {
    const legacyEnv = `SECRETS_MASTER_KEY_${version.toUpperCase()}`;
    key = loadKey(legacyEnv);
    if (!key) {
      throw new Error(
        `No key configured for secret version "${version}" (expected ${legacyEnv})`,
      );
    }
  }

  const buf = Buffer.from(encoded, "base64");
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error("ciphertext too short");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ct = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

/** Helper for bulk encryption of a {key: plaintext} object. */
export function encryptRecord(record) {
  const out = {};
  for (const [k, v] of Object.entries(record || {})) {
    out[k] = v === null || v === undefined ? null : encryptSecret(v);
  }
  return out;
}

/** Helper for bulk decryption. Values that fail to decrypt become null. */
export function decryptRecord(record) {
  const out = {};
  for (const [k, v] of Object.entries(record || {})) {
    try {
      out[k] = decryptSecret(v);
    } catch {
      out[k] = null;
    }
  }
  return out;
}
