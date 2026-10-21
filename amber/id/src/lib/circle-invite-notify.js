/**
 * TELL SOMEBODY WHAT WAS WAITING FOR THEM WHEN THEY SIGNED UP.
 *
 * "I'm right now creating a bunch of circles without Amber users... Those should
 *  be resolved the second those people sign up for Amber with their phone number
 *  or email... They should be notified that they are in the circle and be asked
 *  to accept if they want to join the circle."
 *
 * The resolving happens at signup already: the account's verified phone is
 * written into discovery_keys and every contact card holding that key is linked
 * to it (store.js linkContactsToAmberUserByPhone), which is what makes the
 * inbound-circle predicate match. So by the time the new app calls home, the
 * circles are already theirs to see. Nobody was told.
 *
 * WHY THIS RUNS ON PUSH-TOKEN REGISTRATION and not inside signup. At the instant
 * the account row is inserted there is no device registered to push to -- the
 * token arrives a few seconds later, from the notifications step of onboarding.
 * A push sent at signup goes precisely nowhere. Registering a token is the first
 * moment there is somewhere to send it, and it is idempotent: circle_invites
 * records who has been told, so a re-registration on the next launch does not
 * tell them again.
 *
 * The accept prompt itself does NOT depend on this: GET /v1/me/circles/inbound
 * materialises the same invites, so somebody who declines notifications still
 * gets asked, in the app, the first time they look. This is only the telling.
 */

import { notifyAmberUsers } from "./notify.js";
import { getInboundCirclesForViewer } from "../db/circles-store.js";
import { openCircleInvites, markCircleInvitesNotified } from "../db/circle-invites.js";

/**
 * How many separate pushes one person can receive from this. Someone whose
 * number is in forty address books does not need forty notifications, so beyond
 * this it becomes one summary. Three is the point at which a list stops reading
 * as "here is who added you" and starts reading as a flood.
 */
const MAX_INDIVIDUAL = 3;

/**
 * Notify a viewer about circles they are in and have not been told about.
 *
 * Never throws. Returns { notified } for logging.
 *
 * @param {object} app       Fastify instance (notifyAmberUsers wants it)
 * @param {string} amberId   the viewer
 * @param {object} [deps]    { log, inboundImpl, openImpl, markImpl, notifyImpl }
 */
export async function notifyPendingCircleInvites(app, amberId, deps = {}) {
  const log = deps.log;
  const inboundOf = deps.inboundImpl || getInboundCirclesForViewer;
  const open = deps.openImpl || openCircleInvites;
  const mark = deps.markImpl || markCircleInvitesNotified;
  const notify = deps.notifyImpl || notifyAmberUsers;
  if (!amberId) return { notified: 0 };
  try {
    const inbound = await inboundOf(amberId, null);
    if (!Array.isArray(inbound) || inbound.length === 0) return { notified: 0 };

    // The ids come from the inbound predicate, which is the authorization; this
    // function never sees a circle id from a request.
    const { pending } = await open(
      amberId,
      inbound.map((c) => c.id),
    );
    if (pending.length === 0) return { notified: 0 };

    const pendingSet = new Set(pending.map(String));
    const circles = inbound.filter((c) => pendingSet.has(String(c.id)));
    if (circles.length === 0) return { notified: 0 };

    if (circles.length <= MAX_INDIVIDUAL) {
      for (const c of circles) {
        const who = c.owner?.name || c.owner?.username || "Someone";
        await notify({
          ownerIds: [amberId],
          title: `${who} added you to ${c.name || "a circle"}`,
          body: "Open Amber to accept or decline.",
          // `type` must be one the app's notification handler routes on, or
          // tapping this does nothing.
          data: { type: "circle", circleId: String(c.id) },
          // Attributed to the person who added them, so muting means "not from
          // them" rather than "nothing about circles ever".
          fromAmberId: c.owner?.amberId || null,
          log,
        });
      }
    } else {
      await notify({
        ownerIds: [amberId],
        title: `You have been added to ${circles.length} circles`,
        body: "Open Amber to see who added you, and accept or decline.",
        data: { type: "circle" },
        log,
      });
    }

    // Marked AFTER the push, so a failed push is retried on the next launch
    // rather than being recorded as delivered.
    await mark(
      amberId,
      circles.map((c) => c.id),
    );
    return { notified: circles.length };
  } catch (e) {
    // A notification is not worth failing anything for. It is worth a log line:
    // silence here would be indistinguishable from "nobody had put them in a
    // circle", which is the exact bug this feature exists to fix.
    console.error(
      `CIRCLE_INVITE_NOTIFY_ERR viewer=${amberId} ${e?.code ? `${e.code} ` : ""}${e?.message || e}`,
    );
    return { notified: 0 };
  }
}
