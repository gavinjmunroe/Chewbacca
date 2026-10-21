/**
 * THE OWNER BEHIND A SESSION, WHICHEVER KIND OF SESSION IT IS.
 *
 * About thirty route files resolve the caller the same way:
 *
 *     const phone = request.privyUser?.phone;
 *     const ownerId = await resolveAmberIdByPhone(phone);
 *
 * That was correct while every account in this service was a phone number.
 * Migration 062 made it incomplete: an employee invited into a company by their
 * work address may have no phone at all, so their perfectly valid session
 * resolves to nothing and the route answers "cannot resolve contacts owner" --
 * which reads, to the person holding it, as "your account is broken".
 *
 * PHONE FIRST, THEN THE SUBJECT OF THE TOKEN. Phone first because that is what
 * every existing token carries and what every existing resolver already used,
 * so nothing that works today changes. The DID second because for an
 * email-only account it is the only identifier there is.
 *
 * This is the narrow version of lib/resolve-actor.js, which answers the same
 * question plus "and which company are they acting in". Routes that need the
 * company use that one; routes that only need an owner use this, and neither
 * pays for the other's work.
 */

import { resolveAmberIdByPhone, resolveAmberIdByPrivyDid } from "../db/store.js";

/**
 * @param {{ phone?: string|null, userId?: string|null }|null|undefined} session
 *        request.privyUser, as requireAuth populates it.
 * @returns {Promise<string|null>} the amber_id, or null when nothing resolves.
 */
export async function ownerIdFromSession(session) {
  if (!session) return null;
  if (session.phone) {
    const byPhone = await resolveAmberIdByPhone(session.phone).catch(() => null);
    if (byPhone) return byPhone;
  }
  if (session.userId) {
    const byDid = await resolveAmberIdByPrivyDid(session.userId).catch(() => null);
    if (byDid) return byDid;
  }
  return null;
}
