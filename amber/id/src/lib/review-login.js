import { withTransaction } from '../db/sql.js';
import { REVIEW_PHONE, reviewConfig, reviewCodeMatches } from './review-account.js';
import { personIdFromHandle } from '../pdw/person-resolver.js';

/** Shared across replicas and both phone verification endpoints. A credential
 * rotation requires an explicit seed operation to reset the lifetime attempt
 * budget. Send-code requests cannot reset it. DB failure always fails closed.
 */
export async function verifyReviewLogin(code, transact = withTransaction) {
  const cfg = reviewConfig();
  if (!cfg) return { ok: false, reason: 'not_found' };
  return transact(async (client) => {
    const { rows } = await client.query(
      `SELECT amber_id, person_id, tenant_metadata FROM users
       WHERE amber_id = $1 AND phone = $2 AND deleted_at IS NULL FOR UPDATE`,
      [cfg.ownerId, REVIEW_PHONE]);
    const user = rows[0];
    const review = user?.tenant_metadata?.appReview;
    if (!user || user.person_id !== personIdFromHandle(REVIEW_PHONE) ||
        review?.isolated !== true || review.credentialHash !== cfg.hash) {
      return { ok: false, reason: 'not_found' };
    }
    const failures = Number(review.failures || 0);
    if (!Number.isFinite(failures) || failures >= 20) return { ok: false, reason: 'too_many_attempts' };
    if (!reviewCodeMatches(code)) {
      await client.query(`UPDATE users SET tenant_metadata = jsonb_set(
        tenant_metadata, '{appReview,failures}', to_jsonb($2::int)) WHERE amber_id = $1`,
        [cfg.ownerId, failures + 1]);
      return { ok: false, reason: 'mismatch' };
    }
    return { ok: true, amberId: user.amber_id, personId: user.person_id };
  });
}
