/** Isolated Apple review identity. No real phone, no plaintext credential in source.
 * Only a pre-seeded, explicitly marked account may use this path. Removing the
 * config or reaching expiry also invalidates its access tokens and refreshes.
 */
import crypto from 'node:crypto';
import { toE164 } from '../pdw/phone.js';
export const REVIEW_PHONE = '+14085550186'; // reserved fictional NANP number
export function isReviewPhone(phone) { return toE164(phone) === REVIEW_PHONE; }
export function reviewConfig() {
  const ownerId = process.env.APP_REVIEW_AMBER_ID;
  const hash = process.env.APP_REVIEW_CODE_HASH;
  const salt = process.env.APP_REVIEW_CODE_SALT;
  const expires = Date.parse(process.env.APP_REVIEW_EXPIRES_AT || '');
  if (!/^[0-9a-f-]{36}$/i.test(ownerId || '') || !/^[0-9a-f]{64}$/i.test(hash || '') ||
      !salt || salt.length < 32 || !Number.isFinite(expires) || expires <= Date.now()) return null;
  return { ownerId, hash, salt, expires };
}
export function reviewAccountConfigured() { return Boolean(reviewConfig()); }
export function reviewAccountStatus() {
  return reviewAccountConfigured() ? 'app-review sign-in: configured' : 'app-review sign-in: off';
}
export function reviewCodeMatches(code) {
  const cfg = reviewConfig();
  if (!cfg || typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
  const actual = crypto.createHmac('sha256', cfg.salt).update(code).digest();
  return crypto.timingSafeEqual(actual, Buffer.from(cfg.hash, 'hex'));
}
export function reviewSessionAllowed(phone) {
  return !isReviewPhone(phone) || reviewAccountConfigured();
}
