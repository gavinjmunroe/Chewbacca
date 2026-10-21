/**
 * THE SWITCH THAT MAKES A TEXT COUNT AS YOU.
 *
 *   GET    /v1/me/imessage-link  → { linked, phone, linkedAt, linkedPhone, amberNumber }
 *   POST   /v1/me/imessage-link  → arm it, for the session's phone and no other
 *   DELETE /v1/me/imessage-link  → disarm it
 *
 * THE PHONE IS NEVER IN THE REQUEST BODY, and that is the entire security
 * design of this file. The inbound webhook trusts a phone number to name an
 * account; this route is what makes that trust legitimate, so a route that let
 * a caller nominate which number to arm would hand out exactly the capability
 * the webhook gate was added to withhold -- point your armed number at my
 * account and text your way in. POST takes no body worth reading. It arms the
 * number the session already proved, or it fails.
 *
 * SESSIONS WITHOUT A PHONE ARE A REAL STATE, not an error to paper over. An
 * Apple sign-in carries no phone claim, and such an account has nothing for
 * this switch to point at. It gets a 400 that says so by name rather than a
 * silent no-op that leaves a toggle looking on while nothing is armed.
 *
 * Distinct from GET/PATCH /v1/me/notification-settings, whose `channels.imessage`
 * is the OUTBOUND preference (may Amber text me my reminders). This is inbound.
 * They are one word apart and opposite in blast radius, which is why they are
 * two endpoints and not one field.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import {
  resolveAmberIdByPhone,
  getImessageLink,
  linkImessageChannel,
  unlinkImessageChannel,
} from "../db/store.js";
import { senderPhone } from "../lib/imessage-opt-in.js";
import { isLinkablePhone, textingAvailability } from "../lib/imessage-link.js";

/** The response body, built one way so the three verbs cannot disagree. */
export function linkView(row, { amberNumber } = {}) {
  const linkedPhone = row?.imessage_linked_phone ?? null;
  const linkedAt = row?.imessage_linked_at ?? null;
  return {
    ...textingAvailability(row, { amberNumber }),
    linked: !!(linkedAt && linkedPhone),
    phone: row?.phone ?? null,
    linkedPhone,
    linkedAt: linkedAt ? new Date(linkedAt).toISOString() : null,
    // What to tell the user to text. The app renders the deep link from it, so
    // it belongs in the same payload as the switch rather than a second call.
    amberNumber: amberNumber ?? null,
  };
}

export function registerImessageLinkRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const resolveAmber = deps.resolveAmberIdByPhone || resolveAmberIdByPhone;
  const readLink = deps.getImessageLink || getImessageLink;
  const link = deps.linkImessageChannel || linkImessageChannel;
  const unlink = deps.unlinkImessageChannel || unlinkImessageChannel;
  const amberNumberOf = deps.senderPhone || senderPhone;

  /**
   * The three checks every verb makes, in one place.
   * Returns { amberId, phone } or sends the reply and returns null.
   */
  async function owner(request, reply) {
    const phone = request.privyUser?.phone;
    if (!phone) {
      reply.code(400).send({
        error: "no_phone_on_session",
        message:
          "This account has no phone number, so there is nothing to link iMessage to. Add a phone number first.",
      });
      return null;
    }
    if (!isLinkablePhone(phone)) {
      // A session phone that is not E.164 cannot be matched against an inbound
      // sender, so arming it would produce a switch that reads on and never
      // admits a single message.
      reply.code(400).send({
        error: "phone_not_e164",
        message: "The phone on this account is not in a format iMessage can be matched against.",
      });
      return null;
    }
    const amberId = await resolveAmber(phone).catch(() => null);
    if (!amberId) {
      reply.code(404).send({
        error: "owner_not_found",
        message: "No account found for this session.",
      });
      return null;
    }
    return { amberId, phone };
  }

  app.get("/v1/me/imessage-link", { preHandler: [requireAuth] }, async (request, reply) => {
    const who = await owner(request, reply);
    if (!who) return;
    const row = await readLink(who.amberId).catch(() => null);
    return linkView(row, { amberNumber: amberNumberOf() });
  });

  app.post("/v1/me/imessage-link", { preHandler: [requireAuth] }, async (request, reply) => {
    const who = await owner(request, reply);
    if (!who) return;
    const armed = await link(who.amberId, who.phone).catch(() => null);
    if (!armed) {
      return reply.code(500).send({
        error: "link_failed",
        message: "Could not turn on iMessage. Try again.",
      });
    }
    // Read back rather than trusting the update's shape: the response carries
    // `phone` too, and a caller that renders "linked" from one row and the
    // number from another is how the two drift apart on screen.
    const row = await readLink(who.amberId).catch(() => null);
    return linkView(row ?? { ...armed, phone: who.phone }, { amberNumber: amberNumberOf() });
  });

  app.delete("/v1/me/imessage-link", { preHandler: [requireAuth] }, async (request, reply) => {
    const who = await owner(request, reply);
    if (!who) return;
    const ok = await unlink(who.amberId).catch(() => false);
    if (!ok) {
      return reply.code(500).send({
        error: "unlink_failed",
        message: "Could not turn off iMessage. Try again.",
      });
    }
    return linkView({ phone: who.phone }, { amberNumber: amberNumberOf() });
  });
}
