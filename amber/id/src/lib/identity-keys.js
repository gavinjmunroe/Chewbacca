/**
 * HASHED IDENTITY KEYS — the one place a phone number or an email address turns
 * into the 16 bytes the database is allowed to store.
 *
 * WHY HASH AT ALL. `contact_identity_keys` holds a row for every phone number and
 * email address in every user's address book. That is, by volume, the most
 * sensitive table in the system: it is a list of people who never signed up for
 * anything. Storing them in the clear means a stolen backup is a stolen contact
 * graph. Storing HMAC(pepper, value) means a stolen backup is 16 bytes per person
 * and the pepper is not in it.
 *
 * WHAT THIS DOES NOT DO. There are about 10^10 phone numbers. An attacker who has
 * BOTH the dump and the pepper can enumerate all of them in an afternoon; so can a
 * compromised server, which holds the pepper by definition. This is defense in
 * depth against a leaked backup, and nothing else. The privacy policy should say
 * so in those words rather than implying the numbers are unrecoverable.
 *
 * WHY HMAC AND NOT sha256(value). A bare hash of a phone number is a rainbow table
 * somebody has already built. The pepper is what makes precomputation useless, and
 * it lives in the environment (KMS-backed) rather than in this repo or the DB.
 *
 * WHY 128 BITS. A 16-byte key halves the index size against a full sha256 and the
 * collision probability across even a billion keys is ~10^-19. `cik_len_chk` and
 * `discovery_keys_len_chk` enforce the length in the database, so a wrong-sized
 * hash is a constraint violation rather than a silent mismatch.
 *
 * ROTATING THE PEPPER INVALIDATES EVERY STORED KEY. Every hash in
 * contact_identity_keys and discovery_keys would have to be recomputed from
 * plaintext the server no longer has. Treat IDENTITY_KEY_PEPPER as permanent.
 */

import { createHmac } from "node:crypto";
import { phoneKey, emailKey } from "./contact-identity.js";

/**
 * Matches the smallint CHECKs in 002/003.
 *
 * contact_identity_keys accepts all three. discovery_keys accepts only PHONE and
 * EMAIL, and that asymmetry is deliberate: a source key ("google:people/c123")
 * identifies a ROW IN SOMEBODY'S ADDRESS BOOK, not a person, so it has no
 * business in the table that answers "which account owns this key".
 *
 * SOURCE keys are hashed too, even though an external id is not a phone number.
 * Not because the value is sensitive, but because one column cannot be half
 * bytea: the claim mechanism -- insert, take the conflict, read back who already
 * held it -- has to work identically for all three kinds or dedup grows a special
 * case, and special cases in dedup are how duplicates come back.
 */
export const KEY_TYPE = Object.freeze({ PHONE: 1, EMAIL: 2, SOURCE: 3 });

/** The names the pure decision layer uses, mapped to what the column stores. */
export const KEY_TYPE_BY_NAME = Object.freeze({
  phone: KEY_TYPE.PHONE,
  email: KEY_TYPE.EMAIL,
  source: KEY_TYPE.SOURCE,
});
export const KEY_NAME_BY_TYPE = Object.freeze({
  [KEY_TYPE.PHONE]: "phone",
  [KEY_TYPE.EMAIL]: "email",
  [KEY_TYPE.SOURCE]: "source",
});

const MIN_PEPPER_LENGTH = 32;
let _pepper = null;

function pepper() {
  if (_pepper) return _pepper;
  const raw = process.env.IDENTITY_KEY_PEPPER;
  if (typeof raw !== "string" || raw.length < MIN_PEPPER_LENGTH) {
    // FAIL CLOSED, LOUDLY. The tempting alternative -- fall back to an empty
    // pepper so the app still boots -- would write hashes that a later, correctly
    // configured deploy could never reproduce, and nothing would report an error:
    // contact dedup would simply stop matching and every address book would
    // double. A missing pepper has to stop the process.
    throw new Error(
      "IDENTITY_KEY_PEPPER is missing or shorter than 32 characters. " +
        "Identity hashing cannot run without it.",
    );
  }
  _pepper = Buffer.from(raw, "utf8");
  return _pepper;
}

/**
 * Call once at startup so a misconfigured deploy dies at boot rather than on the
 * first contact sync, half an address book in.
 */
export function assertIdentityPepper() {
  pepper();
  return true;
}

/**
 * HMAC-SHA256(pepper, "<type>:<normalized value>") truncated to 128 bits.
 *
 * The type is inside the MAC input on purpose: without it, an email address that
 * happens to normalize to the same string as a phone key would collide across
 * types, and `(key_type, key_hash)` would stop being a real compound key.
 *
 * Takes an ALREADY-NORMALIZED value. Normalization (last-10 digits, lowercased
 * address) is a product decision that lives in contact-identity.js and is unit
 * tested there; doing it again here would give two places to disagree.
 */
export function hashIdentityKey(keyType, normalizedValue) {
  const t = typeof keyType === "string" ? KEY_TYPE_BY_NAME[keyType] : Number(keyType);
  if (t !== KEY_TYPE.PHONE && t !== KEY_TYPE.EMAIL && t !== KEY_TYPE.SOURCE) return null;
  if (typeof normalizedValue !== "string" || normalizedValue.length === 0) return null;
  return createHmac("sha256", pepper())
    .update(`${t}:${normalizedValue}`, "utf8")
    .digest()
    .subarray(0, 16);
}

/** Raw phone -> 16-byte key, or null when the input is not a usable number. */
export function phoneHash(raw) {
  const k = phoneKey(raw);
  return k ? hashIdentityKey(KEY_TYPE.PHONE, k) : null;
}

/** Raw email -> 16-byte key, or null when the input is not an address. */
export function emailHash(raw) {
  const k = emailKey(raw);
  return k ? hashIdentityKey(KEY_TYPE.EMAIL, k) : null;
}

/**
 * THE TOKENIZER the identity index is built on.
 *
 * Takes the pure layer's ("phone", "4150000004") and returns the hex of the same
 * 16 bytes the table stores, so a key derived from a live contact row and a key
 * read back out of contact_identity_keys compare equal. Hex rather than the
 * Buffer because the index is a JS Map and two Buffers holding identical bytes
 * are different map keys.
 *
 * Returns null for a value that cannot be hashed; buildIdentityIndex skips those.
 */
export function identityToken(typeName, value) {
  const buf = hashIdentityKey(typeName, value);
  return buf ? buf.toString("hex") : null;
}

/**
 * Both key sets for one contact record, deduplicated, ready for a bulk insert.
 * Returns [{ keyType, keyHash }]. Unusable values are dropped rather than stored
 * as nulls -- a row that identifies nobody is worse than no row.
 */
export function identityKeysFor({ phones = [], emails = [] } = {}) {
  const seen = new Set();
  const out = [];
  const push = (keyType, buf) => {
    if (!buf) return;
    const dedupe = `${keyType}:${buf.toString("hex")}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push({ keyType, keyHash: buf });
  };
  for (const p of phones) push(KEY_TYPE.PHONE, phoneHash(p));
  for (const e of emails) push(KEY_TYPE.EMAIL, emailHash(e));
  return out;
}
