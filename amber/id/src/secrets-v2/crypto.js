/**
 * Crypto primitives for the per-tenant secrets v2 store.
 *
 * Two-layer key hierarchy:
 *
 *   KEK (key-encryption key)   single 32-byte secret from env MEDHA_SECRETS_KEK.
 *                              Never written to Firestore. Used only to wrap
 *                              and unwrap per-tenant DEKs.
 *
 *   DEK (data-encryption key)  per-tenant 32-byte secret. Stored wrapped in
 *                              tenant_deks/{tenantDid}__{version}. Used to
 *                              encrypt every secret value owned by that tenant.
 *
 * Both layers use AES-256-GCM with a fresh 12-byte IV per encryption. The auth
 * tag is stored separately so the on-disk shape stays explicit instead of being
 * a concatenated blob.
 *
 * No plaintext value, DEK, or KEK is ever logged. Callers that need to log
 * must log the ciphertext envelope only.
 */

import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

let kekCache = null;

export function isKekConfigured() {
  return (
    typeof process.env.MEDHA_SECRETS_KEK === "string" &&
    process.env.MEDHA_SECRETS_KEK.length > 0
  );
}

export function loadKek() {
  if (kekCache) return kekCache;
  const raw = process.env.MEDHA_SECRETS_KEK;
  if (!raw) {
    throw new Error(
      "MEDHA_SECRETS_KEK is required. Generate with: openssl rand -base64 32",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `MEDHA_SECRETS_KEK must decode to ${KEY_BYTES} bytes (got ${key.length})`,
    );
  }
  kekCache = key;
  return key;
}

export function _resetKekCacheForTests() {
  kekCache = null;
}

export function generateDek() {
  return crypto.randomBytes(KEY_BYTES);
}

function gcmEncrypt(key, plaintext) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ct.toString("base64"),
    iv: iv.toString("base64"),
    authTag: tag.toString("base64"),
  };
}

function gcmDecrypt(key, envelope) {
  const iv = Buffer.from(envelope.iv, "base64");
  const ct = Buffer.from(envelope.ciphertext, "base64");
  const tag = Buffer.from(envelope.authTag, "base64");
  if (iv.length !== IV_BYTES) throw new Error("invalid iv length");
  if (tag.length !== TAG_BYTES) throw new Error("invalid auth tag length");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export function wrapDek(dek, kek) {
  if (!Buffer.isBuffer(dek) || dek.length !== KEY_BYTES) {
    throw new Error("dek must be a 32-byte Buffer");
  }
  if (!Buffer.isBuffer(kek) || kek.length !== KEY_BYTES) {
    throw new Error("kek must be a 32-byte Buffer");
  }
  const env = gcmEncrypt(kek, dek);
  return {
    wrappedDek: env.ciphertext,
    wrapIv: env.iv,
    wrapAuthTag: env.authTag,
  };
}

export function unwrapDek(wrapped, kek) {
  if (!Buffer.isBuffer(kek) || kek.length !== KEY_BYTES) {
    throw new Error("kek must be a 32-byte Buffer");
  }
  const env = {
    ciphertext: wrapped.wrappedDek,
    iv: wrapped.wrapIv,
    authTag: wrapped.wrapAuthTag,
  };
  const dek = gcmDecrypt(kek, env);
  if (dek.length !== KEY_BYTES) {
    throw new Error("unwrapped dek has wrong length");
  }
  return dek;
}

export function encrypt(plaintext, dek) {
  if (typeof plaintext !== "string") {
    throw new Error("plaintext must be a string");
  }
  if (!Buffer.isBuffer(dek) || dek.length !== KEY_BYTES) {
    throw new Error("dek must be a 32-byte Buffer");
  }
  return gcmEncrypt(dek, Buffer.from(plaintext, "utf8"));
}

export function decrypt(envelope, dek) {
  if (!Buffer.isBuffer(dek) || dek.length !== KEY_BYTES) {
    throw new Error("dek must be a 32-byte Buffer");
  }
  return gcmDecrypt(dek, envelope).toString("utf8");
}
