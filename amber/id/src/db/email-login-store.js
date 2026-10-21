/**
 * email-login-store — getting back in with a work address.
 *
 * An account created by an org invite may have no phone, so the OTP path that
 * every other account uses is not available to it. This is the replacement, and
 * it is the same capability model as the invite: a random token, stored only as
 * its SHA-256, short-lived, single-use, and NEVER returned to the requester.
 *
 * THAT LAST PROPERTY IS THE ENTIRE SECURITY OF THIS MECHANISM. An endpoint that
 * handed the token back in its response would be an unauthenticated way to sign
 * in as anybody whose work address you could guess, which is everybody at a
 * company with a published email format. The token leaves this service in one
 * direction only: an email to the address it names. If mail is not configured,
 * the request fails -- it does not fall back to returning the token.
 */

import crypto from "node:crypto";
import { query } from "./sql.js";

/** Fifteen minutes: long enough to switch to a mail client, short enough to matter. */
const DEFAULT_TTL_MINUTES = 15;

/** How many links one address may ask for in an hour before it is told to wait. */
const MAX_PER_HOUR = 5;

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest();
}

/**
 * Issue a login token for an account that already exists.
 *
 * The caller resolves the address to an amber_id first and simply does not call
 * this when there is none -- the route still answers "check your email" either
 * way, because a different answer for an unknown address turns this endpoint
 * into a way to ask which addresses have accounts.
 */
export async function issueLoginToken({ email, amberId, requesterIp = null, ttlMinutes = DEFAULT_TTL_MINUTES } = {}) {
  if (!email || !amberId) return { ok: false, reason: "missing" };
  const recent = await recentRequestCount(email);
  if (recent >= MAX_PER_HOUR) return { ok: false, reason: "rate_limited" };

  const token = crypto.randomBytes(32).toString("base64url");
  const minutes = String(Math.max(1, Number(ttlMinutes) || DEFAULT_TTL_MINUTES));
  try {
    await query(
      `INSERT INTO email_login_tokens (email, amber_id, token_hash, requester_ip, expires_at)
       VALUES ($1, $2::uuid, $3, $4, now() + ($5 || ' minutes')::interval)`,
      [String(email).toLowerCase(), amberId, hashToken(token), requesterIp, minutes],
    );
    return { ok: true, token };
  } catch {
    return { ok: false, reason: "write_failed" };
  }
}

export async function recentRequestCount(email, windowMinutes = 60) {
  try {
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM email_login_tokens
        WHERE lower(email) = lower($1)
          AND created_at > now() - ($2 || ' minutes')::interval`,
      [String(email), String(Math.max(1, Number(windowMinutes) || 60))],
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    // A failed rate-limit read must not open the gate. Reporting the limit as
    // already reached refuses the request, which is the safe direction.
    return MAX_PER_HOUR;
  }
}

/**
 * Spend a token. The UPDATE that finds the row is the UPDATE that marks it
 * consumed, so a link clicked twice -- or forwarded -- signs in exactly once.
 * Returns the amber_id, or null for anything that is not a live token.
 */
export async function consumeLoginToken(token) {
  if (!token) return null;
  try {
    const { rows } = await query(
      `UPDATE email_login_tokens
          SET consumed_at = now()
        WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
        RETURNING amber_id, email`,
      [hashToken(token)],
    );
    if (!rows[0]) return null;
    return { amberId: String(rows[0].amber_id), email: rows[0].email };
  } catch {
    return null;
  }
}
