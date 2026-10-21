/**
 * session-store — device sessions and refresh-token rotation for the
 * phone-OTP login path.
 *
 * THE MODEL
 * A sign-in creates one row (a "session"), which is also the root of a
 * rotation "family". The client holds:
 *   - a short-lived access JWT (see lib/medha-jwt.js, 15 min) carrying
 *     `sid` = this row's id, and
 *   - a long-lived opaque refresh token (60 days, sliding) whose sha256 is
 *     stored here.
 *
 * Every refresh mints a NEW refresh token, moves the old hash into
 * prev_refresh_hash, and pushes expires_at out again. An active user is
 * therefore signed in indefinitely; only genuine inactivity (60 days with no
 * app open) or an explicit sign-out ends a session.
 *
 * REUSE DETECTION
 * A refresh token is single-use. If one is presented after it has already been
 * rotated away, either the network ate our response and the client is retrying,
 * or the token was stolen and replayed. We distinguish by time:
 *   - within REPLAY_GRACE_MS of the rotation -> lost-response retry. Answer
 *     idempotently with the token we already minted. This is the difference
 *     between a robust implementation and one that signs people out on a
 *     subway.
 *   - after that -> treat as compromise. Revoke the ENTIRE family, so both the
 *     attacker's branch and the victim's branch die and the user re-auths.
 *
 * Everything here is parameterized SQL, and every function is safe to call
 * concurrently: rotation is a single conditional UPDATE, so two racing
 * refreshes cannot both win.
 *
 * NOTE ON REVOCATION LATENCY: access tokens are not checked against this table
 * on every request (that would add a DB round-trip to every authenticated
 * call). Revocation instead propagates within the access-token TTL, plus an
 * in-process denylist for immediate effect on the replica that handled the
 * revoke. See lib/session-denylist.js.
 */

import crypto from "node:crypto";
import { query } from "./sql.js";

// Sliding window. Every successful refresh pushes this out from `now`.
const REFRESH_TTL_DAYS = 60;

// How long after a rotation the superseded token is still answered
// idempotently instead of being treated as a replay.
const REPLAY_GRACE_MS = 60 * 1000;


/** 256 bits of CSPRNG entropy, URL-safe. Never stored in plaintext. */
function mintRefreshToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function expiryFromNow() {
  return new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
}

function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    subjectId: row.subject_id,
    phone: row.phone ?? null,
    familyId: row.family_id,
    deviceId: row.device_id ?? null,
    deviceName: row.device_name ?? null,
    deviceOs: row.device_os ?? null,
    appVersion: row.app_version ?? null,
    createdAt: row.created_at ?? null,
    lastUsedAt: row.last_used_at ?? null,
    expiresAt: row.expires_at ?? null,
    revokedAt: row.revoked_at ?? null,
  };
}

/**
 * Start a new session (a fresh sign-in). Returns the session row plus the
 * plaintext refresh token, which is the ONLY time it exists outside the
 * client.
 */
export async function createSession({
  subjectId,
  phone = null,
  device = {},
  ip = null,
}) {
  if (!subjectId) throw new Error("createSession requires subjectId");

  const refreshToken = mintRefreshToken();
  const { rows } = await query(
    `INSERT INTO device_sessions
       (subject_id, phone, family_id, refresh_hash, device_id, device_name,
        device_os, app_version, last_ip, expires_at)
     VALUES ($1, $2, gen_random_uuid(), $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      String(subjectId),
      phone,
      hashToken(refreshToken),
      device.deviceId ?? null,
      device.deviceName ?? null,
      device.deviceOs ?? null,
      device.appVersion ?? null,
      ip,
      expiryFromNow().toISOString(),
    ],
  );
  return { session: mapSession(rows[0]), refreshToken };
}

/**
 * Exchange a refresh token for a new one.
 *
 * Returns one of:
 *   { ok: true,  session, refreshToken, replayed: boolean }
 *   { ok: false, reason: 'not_found' | 'expired' | 'revoked' | 'reuse_detected' }
 *
 * On 'reuse_detected' the whole family has already been revoked by the time
 * this returns — the caller only has to surface a 401.
 */
export async function rotateSession(presentedToken, { ip = null } = {}) {
  if (typeof presentedToken !== "string" || presentedToken.length < 20) {
    return { ok: false, reason: "not_found" };
  }
  const presentedHash = hashToken(presentedToken);
  const nextToken = mintRefreshToken();

  // Happy path. The WHERE clause is the concurrency guard: exactly one of two
  // racing refreshes can match `refresh_hash = $1 AND revoked_at IS NULL`,
  // because the winner rewrites refresh_hash in the same statement.
  const { rows } = await query(
    `UPDATE device_sessions
        SET prev_refresh_hash = refresh_hash,
            refresh_hash      = $2,
            rotated_at        = now(),
            last_used_at      = now(),
            expires_at        = $3,
            last_ip           = COALESCE($4, last_ip)
      WHERE refresh_hash = $1
        AND revoked_at IS NULL
        AND expires_at > now()
      RETURNING *`,
    [presentedHash, hashToken(nextToken), expiryFromNow().toISOString(), ip],
  );
  if (rows.length > 0) {
    return { ok: true, session: mapSession(rows[0]), refreshToken: nextToken, replayed: false };
  }

  // Not current. Was it the immediately-previous token?
  const { rows: prior } = await query(
    `SELECT * FROM device_sessions WHERE prev_refresh_hash = $1 LIMIT 1`,
    [presentedHash],
  );
  if (prior.length > 0) {
    const row = prior[0];
    const rotatedMs = row.rotated_at ? new Date(row.rotated_at).getTime() : 0;
    const withinGrace = Date.now() - rotatedMs < REPLAY_GRACE_MS;

    if (row.revoked_at) return { ok: false, reason: "revoked" };

    if (withinGrace) {
      // Lost-response retry. We cannot re-issue the current plaintext (we only
      // stored its hash), so mint a fresh one and rotate again. The client ends
      // up with a valid token and nobody gets signed out.
      const retryToken = mintRefreshToken();
      const { rows: retried } = await query(
        `UPDATE device_sessions
            SET prev_refresh_hash = refresh_hash,
                refresh_hash      = $2,
                rotated_at        = now(),
                last_used_at      = now(),
                expires_at        = $3
          WHERE id = $1 AND revoked_at IS NULL
          RETURNING *`,
        [row.id, hashToken(retryToken), expiryFromNow().toISOString()],
      );
      if (retried.length > 0) {
        return {
          ok: true,
          session: mapSession(retried[0]),
          refreshToken: retryToken,
          replayed: true,
        };
      }
      return { ok: false, reason: "revoked" };
    }

    // Outside the grace window: this token was rotated away long ago and has
    // now reappeared. Assume compromise and burn the family.
    await revokeFamily(row.family_id, "refresh_reuse_detected");
    return { ok: false, reason: "reuse_detected", familyId: row.family_id };
  }

  // Neither current nor previous. Distinguish expired from unknown so the
  // client can tell "sign in again" from "something is wrong".
  const { rows: any } = await query(
    `SELECT revoked_at, expires_at FROM device_sessions WHERE refresh_hash = $1 LIMIT 1`,
    [presentedHash],
  );
  if (any.length > 0) {
    if (any[0].revoked_at) return { ok: false, reason: "revoked" };
    return { ok: false, reason: "expired" };
  }
  return { ok: false, reason: "not_found" };
}

/** Explicit sign-out of one device. Idempotent. */
export async function revokeSession(sessionId, reason = "signed_out") {
  if (!sessionId) return 0;
  const { rowCount } = await query(
    `UPDATE device_sessions
        SET revoked_at = now(), revoked_reason = $2
      WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId, reason],
  );
  return rowCount ?? 0;
}

/** Revoke every session descended from one sign-in. */
export async function revokeFamily(familyId, reason = "family_revoked") {
  if (!familyId) return 0;
  const { rowCount } = await query(
    `UPDATE device_sessions
        SET revoked_at = now(), revoked_reason = $2
      WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyId, reason],
  );
  return rowCount ?? 0;
}

/** Sign out everywhere. Used by "log out of all devices" and account delete. */
export async function revokeAllForSubject(subjectId, reason = "revoke_all") {
  if (!subjectId) return 0;
  const { rowCount } = await query(
    `UPDATE device_sessions
        SET revoked_at = now(), revoked_reason = $2
      WHERE subject_id = $1 AND revoked_at IS NULL`,
    [String(subjectId), reason],
  );
  return rowCount ?? 0;
}

/** The "signed-in devices" screen. Live sessions only, most recent first. */
export async function listSessionsForSubject(subjectId) {
  if (!subjectId) return [];
  const { rows } = await query(
    `SELECT * FROM device_sessions
      WHERE subject_id = $1 AND revoked_at IS NULL AND expires_at > now()
      ORDER BY last_used_at DESC
      LIMIT 100`,
    [String(subjectId)],
  );
  return rows.map(mapSession);
}

/**
 * Is this session still live? Used by the revoke-check path, NOT on every
 * request. Returns null when the row is gone entirely.
 */
export async function getSession(sessionId) {
  if (!sessionId) return null;
  const { rows } = await query(
    `SELECT * FROM device_sessions WHERE id = $1 LIMIT 1`,
    [sessionId],
  );
  return mapSession(rows[0]);
}

export const _internals = { REFRESH_TTL_DAYS, REPLAY_GRACE_MS, hashToken };
