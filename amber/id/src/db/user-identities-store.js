/**
 * user_identities — the provider logins (Apple today, Google next) that resolve to
 * a users row.
 *
 * THE KEY IS (provider, subject). This file used to carry a surrogate `id` and
 * pass it around; the table's primary key is the pair, and a second identity for
 * a row is a second thing that can disagree. Every function here is addressed by
 * the pair, which is also what the provider itself gives you.
 *
 * Shape and reasoning: db/migrations/20260828_024_user_identities_columns.sql.
 *
 * The one invariant worth stating out loud: an identity NEVER creates a user. It is
 * always attached to an amber_id that a phone OTP already proved. That is what keeps
 * one human to one users row, and it is why there is no getOrCreate here to mirror
 * resolveAmberIdByPhone.
 */

import { query } from "./sql.js";

function rowToIdentity(row) {
  if (!row) return null;
  return {
    amberId: String(row.amber_id),
    provider: row.provider,
    subject: row.subject,
    email: row.email ?? null,
    isPrivateEmail: row.is_private_email === true,
    emailVerified: row.email_verified === true,
    createdAt: row.created_at ?? null,
    lastUsedAt: row.last_used_at ?? null,
  };
}

/** The live identity for a provider subject, or null. */
export async function findIdentity(provider, subject) {
  if (!provider || !subject) return null;
  const { rows } = await query(
    `SELECT * FROM user_identities
     WHERE provider = $1 AND subject = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [String(provider), String(subject)],
  );
  return rowToIdentity(rows[0]);
}

/** Every live identity on an account — for the profile screen and for purge. */
export async function listIdentitiesForUser(amberId) {
  if (!amberId) return [];
  const { rows } = await query(
    `SELECT * FROM user_identities
     WHERE amber_id = $1::uuid AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [amberId],
  );
  return rows.map(rowToIdentity);
}

/**
 * Attach a provider identity to an already-resolved user.
 *
 * Returns { ok: false, reason: "subject_taken" } when this subject is already live
 * on a DIFFERENT account. That is not an edge case to smooth over — it means two
 * humans are contesting one Apple ID, or one human has two accounts, and silently
 * re-pointing the row would hand the loser's account to the winner. The caller
 * surfaces it; it never resolves itself.
 *
 * Re-linking the same subject to the same user is idempotent, so a retried request
 * (or a user who signs in again before the client stores the session) is harmless.
 *
 * @returns {Promise<{ ok: true, identity: object, created: boolean }
 *                 | { ok: false, reason: string }>}
 */
export async function linkIdentity({
  amberId,
  provider,
  subject,
  email = null,
  emailVerified = false,
  isPrivateEmail = false,
} = {}) {
  if (!amberId || !provider || !subject) return { ok: false, reason: "missing_args" };

  const existing = await findIdentity(provider, subject);
  if (existing) {
    if (existing.amberId !== String(amberId)) return { ok: false, reason: "subject_taken" };
    // Idempotent re-link. email is only ever FILLED IN, never cleared: Apple sends
    // it on the first authorization only, so a later sign-in legitimately carries
    // null and must not wipe what we already have.
    const { rows } = await query(
      `UPDATE user_identities
       SET email        = COALESCE($3, email),
           email_verified = CASE WHEN $3 IS NULL THEN email_verified ELSE $4 END,
           is_private_email = CASE WHEN $3 IS NULL THEN is_private_email ELSE $5 END,
           last_used_at = now()
       WHERE provider = $1 AND subject = $2 AND deleted_at IS NULL
       RETURNING *`,
      [String(provider), String(subject), email, emailVerified === true, isPrivateEmail === true],
    );
    return { ok: true, identity: rowToIdentity(rows[0]) ?? existing, created: false };
  }

  /**
   * ONE UPSERT, WHICH ALSO FIXES RE-LINKING AFTER AN UNLINK.
   *
   * unlinkIdentity soft-deletes, and (provider, subject) is the primary key. So a
   * plain INSERT after an unlink hits the surviving row, raises 23505, and the old
   * catch below then called findIdentity -- which filters deleted_at IS NULL, found
   * nothing, and answered "subject_taken". Removing Sign in with Apple and adding
   * it back would have been permanently impossible, and the error would have
   * accused the user of contesting somebody else's Apple ID.
   *
   * The WHERE on DO UPDATE is what keeps that from becoming a hole in the other
   * direction: a row is revived only when it is soft-deleted, or already belongs to
   * this account. A LIVE row on a DIFFERENT account matches nothing, updates
   * nothing, returns no rows, and falls through to subject_taken -- which is the
   * one case that must never resolve itself, because it means two people are
   * contesting one Apple ID and silently re-pointing the row hands one of them the
   * other's account.
   *
   * Being a single statement also makes it race-safe without the retry the catch
   * used to do.
   */
  let rows;
  try {
    ({ rows } = await query(
    `INSERT INTO user_identities
       (amber_id, provider, subject, email, email_verified, is_private_email,
        last_used_at, verified_at)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, now(), now())
     ON CONFLICT (provider, subject) DO UPDATE
       SET amber_id         = EXCLUDED.amber_id,
           email            = COALESCE(EXCLUDED.email, user_identities.email),
           email_verified   = CASE WHEN EXCLUDED.email IS NULL
                                   THEN user_identities.email_verified
                                   ELSE EXCLUDED.email_verified END,
           is_private_email = CASE WHEN EXCLUDED.email IS NULL
                                   THEN user_identities.is_private_email
                                   ELSE EXCLUDED.is_private_email END,
           last_used_at     = now(),
           deleted_at       = NULL
       WHERE user_identities.deleted_at IS NOT NULL
          OR user_identities.amber_id = EXCLUDED.amber_id
     RETURNING *`,
    [amberId, String(provider), String(subject), email,
     emailVerified === true, isPrivateEmail === true],
    ));
  } catch (err) {
    // 23503 = foreign key violation: the amber_id has no users row. The header of
    // this file says an identity NEVER creates a user, and that is the rule
    // holding -- but every other refusal here returns a reason, and a throw makes
    // the caller 500 on what is a knowable answer.
    if (err?.code === "23503") return { ok: false, reason: "no_such_user" };
    throw err;
  }
  if (rows.length === 0) return { ok: false, reason: "subject_taken" };
  return { ok: true, identity: rowToIdentity(rows[0]), created: true };
}

/**
 * Note that this identity was just used to sign in. Best-effort.
 *
 * Takes the pair rather than an id, because there is no id. The caller already
 * holds the identity it just resolved.
 */
export async function touchIdentity(provider, subject) {
  if (!provider || !subject) return;
  await query(
    `UPDATE user_identities SET last_used_at = now()
      WHERE provider = $1 AND subject = $2 AND deleted_at IS NULL`,
    [String(provider), String(subject)],
  ).catch(() => {});
}

/** Unlink, for "remove Sign in with Apple" and for account deletion. */
export async function unlinkIdentity(amberId, provider) {
  if (!amberId || !provider) return 0;
  const res = await query(
    `UPDATE user_identities SET deleted_at = now()
     WHERE amber_id = $1::uuid AND provider = $2 AND deleted_at IS NULL`,
    [amberId, String(provider)],
  );
  return res.rowCount;
}
