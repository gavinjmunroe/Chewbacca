/**
 * medha-otp-store — Cloud SQL-backed OTP store for the medha auth flows
 * (dashboard sign-in + mobile app login).
 *
 * Replaces the former in-memory Map implementation so codes survive
 * redeploys and work correctly across multiple replicas.
 *
 * Schema: otp_codes table (see db/migrations/20260724_add_otp_codes.sql)
 *   code_hash      = sha256(phone + ':' + code)  — primary verify path
 *   code_only_hash = sha256(code)                — reverse lookup (no phone needed)
 *   attempts, expires_at, last_sent_at, deleted_at — same lifecycle as before
 *
 * All exported functions are now async. Callers that previously called them
 * synchronously must add await.
 */

import crypto from "node:crypto";
import { query } from "../db/sql.js";

const TTL_MS = 5 * 60 * 1000;            // 5 minutes per spec

/**
 * How long a code lasts, in minutes, for whoever has to SAY so.
 *
 * The OTP text message used to hardcode "expires in 10 minutes" while the
 * store expired codes after 5. Nobody notices a lie like that until somebody
 * types a code at minute seven and is told it is wrong. Exported so the
 * sentence and the expiry cannot drift apart again.
 */
export const OTP_TTL_MINUTES = TTL_MS / 60000;
const RESEND_COOLDOWN_MS = 30 * 1000;    // 30s between sends
const MAX_ATTEMPTS = 5;

function hashCode(phone, code) {
  return crypto.createHash("sha256").update(`${phone}:${code}`).digest("hex");
}

function hashCodeOnly(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function generateCode() {
  // 6-digit numeric, leading zeros allowed.
  const buf = crypto.randomBytes(4);
  const n = buf.readUInt32BE(0);
  return String(n % 1000000).padStart(6, "0");
}

/**
 * Generate and store a code for `phone`. Returns the plaintext code so the
 * caller can dispatch it via iMessage. The code never re-enters the store
 * in plaintext.
 *
 * @param {string} phone — E.164
 * @param {{ requesterIp?: string }} [opts]
 * @returns {Promise<{ code: string|null, throttled: boolean }>}
 */
export async function startMedhaOtp(phone, { requesterIp = null } = {}) {
  // Check cooldown: find the most-recent active row for this phone.
  const { rows: existing } = await query(
    `SELECT id, last_sent_at
     FROM otp_codes
     WHERE phone = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [phone],
  );
  if (existing.length > 0) {
    const lastSentAt = existing[0].last_sent_at;
    if (lastSentAt && Date.now() - new Date(lastSentAt).getTime() < RESEND_COOLDOWN_MS) {
      return { code: null, throttled: true };
    }
    // Soft-delete the old code so the reverse index stays unambiguous.
    await query(
      `UPDATE otp_codes SET deleted_at = now() WHERE id = $1`,
      [existing[0].id],
    );
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + TTL_MS);
  await query(
    `INSERT INTO otp_codes (phone, code_hash, code_only_hash, expires_at, requester_ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [phone, hashCode(phone, code), hashCodeOnly(code), expiresAt.toISOString(), requesterIp],
  );
  return { code, throttled: false };
}

/**
 * Verify a user-submitted code against the stored hash for `phone`.
 * Increments the attempt counter on mismatch; soft-deletes on success (single-use).
 *
 * @returns {Promise<{ ok: true, phone: string } | { ok: false, reason: string, attemptsRemaining?: number }>}
 */
export async function verifyMedhaOtp(phone, candidate) {
  if (typeof candidate !== "string" || !/^\d{4,8}$/.test(candidate.trim())) {
    return { ok: false, reason: "invalid_format" };
  }
  const code = candidate.trim();

  const { rows } = await query(
    `SELECT id, code_hash, attempts, expires_at
     FROM otp_codes
     WHERE phone = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [phone],
  );
  if (rows.length === 0) return { ok: false, reason: "not_found" };
  const row = rows[0];

  if (new Date() > new Date(row.expires_at)) {
    await query(`UPDATE otp_codes SET deleted_at = now() WHERE id = $1`, [row.id]);
    return { ok: false, reason: "expired" };
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: "too_many_attempts" };
  }

  const expected = Buffer.from(row.code_hash, "hex");
  const got = Buffer.from(hashCode(phone, code), "hex");
  const matches = expected.length === got.length && crypto.timingSafeEqual(expected, got);

  if (!matches) {
    await query(
      `UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`,
      [row.id],
    );
    const newAttempts = row.attempts + 1;
    return {
      ok: false,
      reason: "mismatch",
      attemptsRemaining: Math.max(0, MAX_ATTEMPTS - newAttempts),
    };
  }

  // Single-use: soft-delete on success.
  await query(`UPDATE otp_codes SET deleted_at = now() WHERE id = $1`, [row.id]);
  return { ok: true, phone };
}

/**
 * Code-only verify path. Used by the dashboard /sign-in flow where the user
 * pastes just the 6-digit code (phone is unknown client-side).
 *
 * Looks up the phone from code_only_hash, then delegates to verifyMedhaOtp
 * for the full hash-compare + attempt accounting.
 */
export async function verifyMedhaOtpByCode(candidate) {
  if (typeof candidate !== "string" || !/^\d{4,8}$/.test(candidate.trim())) {
    return { ok: false, reason: "invalid_format" };
  }
  const code = candidate.trim();
  const { rows } = await query(
    `SELECT phone
     FROM otp_codes
     WHERE code_only_hash = $1 AND deleted_at IS NULL AND expires_at > now()
     -- NEWEST FIRST, because "LIMIT 1" without an order is whichever row the
     -- planner happened to hand back. Two people can hold the same six digits
     -- at once -- there are only a million of them -- and this decides which
     -- row answers. (That collision is still worth closing properly; the
     -- verify below re-checks sha256(phone:code) against THIS row, so a
     -- mismatch fails closed, but the ambiguity should not exist at all.)
     ORDER BY created_at DESC
     LIMIT 1`,
    [hashCodeOnly(code)],
  );
  if (rows.length === 0) return { ok: false, reason: "not_found" };
  return verifyMedhaOtp(rows[0].phone, candidate);
}

/**
 * Test helper: soft-delete all active OTP rows.
 */
export async function _resetForTests() {
  await query(`UPDATE otp_codes SET deleted_at = now() WHERE deleted_at IS NULL`).catch(() => {});
}
