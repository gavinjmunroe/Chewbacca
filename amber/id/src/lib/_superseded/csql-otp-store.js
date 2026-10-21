/**
 * Cloud SQL OTP store — mirror of otp-store.js, backing the otp_codes table
 * (Cloud SQL) instead of the Firestore amber_otp collection.
 *
 * Exported function names, signatures, and return shapes are identical to
 * otp-store.js so this can be a drop-in dependency swap.
 *
 * Type difference from Firestore version: Firestore stored expiresAt /
 * lastSentAt as ms-epoch integers; Cloud SQL otp_codes uses TIMESTAMPTZ.
 * All epoch-ms comparisons are done in SQL (now() + interval / expires_at <
 * now()) or in JS after fetching the Date objects pg returns.
 *
 * Table shape:
 *   phone        TEXT         NOT NULL  (PK via unique index)
 *   code_hash    TEXT         NOT NULL
 *   expires_at   TIMESTAMPTZ  NOT NULL
 *   created_at   TIMESTAMPTZ  NOT NULL  DEFAULT now()
 *   attempts     INTEGER      NOT NULL  DEFAULT 0
 *   last_sent_at TIMESTAMPTZ  NULL
 */

import crypto from "node:crypto";
import { query } from "../db/sql.js";

const TTL_MS             = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000;      // 1 minute between sends
const MAX_ATTEMPTS       = 5;

function hashCode(phone, code) {
  // Salt with phone so two users who get the same 6-digit code have
  // different stored hashes. Identical to otp-store.js.
  return crypto.createHash("sha256").update(`${phone}:${code}`).digest("hex");
}

function generateCode() {
  // 6-digit numeric, leading zeros allowed. Identical to otp-store.js.
  const buf = crypto.randomBytes(4);
  const n = buf.readUInt32BE(0);
  return String(n % 1000000).padStart(6, "0");
}

/**
 * Generate + store a code for `phone`. Returns the plaintext code so the
 * caller can dispatch it (over Photon). The code never enters the DB in plaintext.
 *
 * Returns `{ code, throttled: boolean }` — when `throttled`, the caller
 * should refuse to re-send and surface a "wait a moment" message.
 */
export async function startOtp(phone) {
  // Check for an existing row and apply the resend throttle in one query.
  const { rows: existing } = await query(
    `SELECT last_sent_at FROM otp_codes WHERE phone = $1`,
    [phone],
  );

  if (existing.length > 0 && existing[0].last_sent_at) {
    const msSinceLastSend = Date.now() - new Date(existing[0].last_sent_at).getTime();
    if (msSinceLastSend < RESEND_COOLDOWN_MS) {
      return { code: null, throttled: true };
    }
  }

  const code = generateCode();
  const codeHash = hashCode(phone, code);

  // UPSERT: insert fresh row, or overwrite on conflict (phone is the PK).
  // attempts resets to 0 on each new send — identical to Firestore ref.set().
  await query(
    `INSERT INTO otp_codes (phone, code_hash, expires_at, attempts, created_at, last_sent_at)
     VALUES ($1, $2, now() + interval '10 minutes', 0, now(), now())
     ON CONFLICT (phone) DO UPDATE
       SET code_hash    = EXCLUDED.code_hash,
           expires_at   = EXCLUDED.expires_at,
           attempts     = 0,
           last_sent_at = now()`,
    [phone, codeHash],
  );

  return { code, throttled: false };
}

/**
 * Verify a user-submitted code. Returns the matching phone on success, or a
 * structured failure reason on miss/expiry/lockout.
 *
 * Return shapes are identical to otp-store.js:
 *   { ok: false, reason: "invalid_format" }
 *   { ok: false, reason: "not_found" }
 *   { ok: false, reason: "expired" }
 *   { ok: false, reason: "too_many_attempts" }
 *   { ok: false, reason: "mismatch", attemptsRemaining: <int> }
 *   { ok: true, phone }
 */
export async function verifyOtp(phone, candidate) {
  if (typeof candidate !== "string" || !/^\d{4,8}$/.test(candidate.trim())) {
    return { ok: false, reason: "invalid_format" };
  }

  const { rows } = await query(
    `SELECT code_hash, attempts, (expires_at < now()) AS expired
     FROM otp_codes WHERE phone = $1`,
    [phone],
  );

  if (rows.length === 0) {
    return { ok: false, reason: "not_found" };
  }

  const row = rows[0];

  if (row.expired) {
    await query(`DELETE FROM otp_codes WHERE phone = $1`, [phone]);
    return { ok: false, reason: "expired" };
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: "too_many_attempts" };
  }

  const expectedHash  = row.code_hash;
  const candidateHash = hashCode(phone, candidate.trim());
  // Timing-safe compare on the hex strings — identical to otp-store.js.
  const a = Buffer.from(expectedHash, "hex");
  const b = Buffer.from(candidateHash, "hex");
  const matches = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!matches) {
    await query(
      `UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = $1`,
      [phone],
    );
    return {
      ok: false,
      reason: "mismatch",
      attemptsRemaining: Math.max(0, MAX_ATTEMPTS - ((row.attempts || 0) + 1)),
    };
  }

  // Single-use: delete on success — identical to otp-store.js ref.delete().
  await query(`DELETE FROM otp_codes WHERE phone = $1`, [phone]);
  return { ok: true, phone };
}
