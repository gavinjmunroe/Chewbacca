/**
 * Intro requests (F4c) — the ONLY cross-user contact-method release path.
 *
 *   POST /v1/me/intros                 caller (requester) asks owner for an intro
 *   GET  /v1/me/intros?direction=      incoming (I'm owner) | outgoing (I'm requester)
 *   POST /v1/me/intros/:id/approve     owner only
 *   POST /v1/me/intros/:id/decline     owner only
 *   GET  /v1/me/intros/:id/contact     requester only, ONLY when approved →
 *                                      releases the contact's phone + email
 *
 * All require auth; caller amber_id = privyUser.phone → resolveAmberIdByPhone.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { blocksInteraction } from "../db/blocks-store.js";
import { resolveAmberIdByPhone, getContactById } from "../db/store.js";
import { getViewerContext } from "../privacy/viewer-context.js";
import {
  createIntroRequest,
  listIntros,
  getIntroById,
  setIntroStatus,
} from "../db/intros-store.js";

const _UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveOwner(request, reply) {
  const privyDid = request.privyUser?.userId;
  if (!privyDid) {
    reply.code(401).send({ error: "no_user", message: "Auth required" });
    return null;
  }
  const phone = request.privyUser?.phone;
  const amberId = phone
    ? await resolveAmberIdByPhone(phone).catch(() => null)
    : null;
  if (!amberId) {
    reply.code(401).send({ error: "no_amber_id", message: "Account not found" });
    return null;
  }
  return amberId;
}

function parseId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function registerIntroRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;

  // ── POST /v1/me/intros ────────────────────────────────────────────────────
  // Create an intro request. Authorized ONLY when the caller is a connected
  // mutual the owner shares with, AND the contact belongs to the owner.
  app.post(
    "/v1/me/intros",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["ownerAmberId", "contactId"],
          properties: {
            ownerAmberId: { type: "string" },
            contactId: { type: ["integer", "string"] },
            message: { type: "string", maxLength: 1000 },
          },
        },
      },
    },
    async (request, reply) => {
      const requester = await resolveOwner(request, reply);
      if (!requester) return;

      const ownerAmberId = String(request.body?.ownerAmberId || "");
      const contactId = parseId(request.body?.contactId);
      const message =
        typeof request.body?.message === "string" ? request.body.message.trim() || null : null;
      /**
       * A BLOCK STOPS AN INTRO REQUEST TOO.
       *
       * Asking somebody to introduce you notifies them by name -- which is the
       * contact a block exists to prevent, arriving through a door nobody had
       * checked. Refused with the same shape as any other refusal, so this
       * endpoint cannot be used to discover who has blocked you.
       */
      if (_UUID_RE.test(ownerAmberId) && (await blocksInteraction(requester, ownerAmberId))) {
        return reply.code(403).send({ error: "cannot_request", message: "This request could not be sent." });
      }
      if (!_UUID_RE.test(ownerAmberId) || !contactId) {
        return reply.code(400).send({ error: "invalid_input" });
      }

      // Gate: must be a sharing mutual of the owner, and the contact must be
      // the owner's. (Self would fail the connected check → 403, as intended.)
      const ctx = await getViewerContext(requester, ownerAmberId);
      if (!(ctx.connected && ctx.ownerShares)) {
        return reply.code(403).send({ error: "not_permitted" });
      }
      const contact = await getContactById(ownerAmberId, contactId);
      if (!contact) {
        return reply.code(403).send({ error: "not_permitted" });
      }

      const intro = await createIntroRequest({
        requesterAmberId: requester,
        ownerAmberId,
        contactId,
        message,
      });
      if (!intro) {
        return reply.code(500).send({ error: "intro_failed" });
      }
      return { intro };
    },
  );

  // ── GET /v1/me/intros?direction=incoming|outgoing ──────────────────────────
  app.get(
    "/v1/me/intros",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const direction = request.query.direction === "outgoing" ? "outgoing" : "incoming";
      const intros = await listIntros(amberId, direction);
      return { intros };
    },
  );

  // ── POST /v1/me/intros/:id/approve | /decline (owner only) ─────────────────
  for (const action of ["approve", "decline"]) {
    app.post(
      `/v1/me/intros/:id/${action}`,
      { preHandler: [requireAuth] },
      async (request, reply) => {
        const amberId = await resolveOwner(request, reply);
        if (!amberId) return;
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ error: "invalid_id" });

        const intro = await getIntroById(id);
        if (!intro) return reply.code(404).send({ error: "not_found" });
        if (intro.ownerAmberId !== amberId) {
          return reply.code(403).send({ error: "not_owner" });
        }
        const status = action === "approve" ? "approved" : "declined";
        const updated = await setIntroStatus(id, amberId, status);
        if (!updated) {
          // Not pending anymore (already responded) or a race.
          return reply.code(409).send({ error: "not_pending" });
        }
        return { intro: updated };
      },
    );
  }

  // ── GET /v1/me/intros/:id/contact ──────────────────────────────────────────
  // THE ONLY cross-user contact-method release. Requester only, approved only.
  app.get(
    "/v1/me/intros/:id/contact",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const id = parseId(request.params.id);
      if (!id) return reply.code(400).send({ error: "invalid_id" });

      const intro = await getIntroById(id);
      if (!intro) return reply.code(404).send({ error: "not_found" });
      if (intro.requesterAmberId !== amberId) {
        return reply.code(403).send({ error: "not_requester" });
      }
      if (intro.status !== "approved") {
        return reply.code(403).send({ error: "not_approved" });
      }

      const contact = await getContactById(intro.ownerAmberId, intro.contactId);
      if (!contact) return reply.code(404).send({ error: "contact_not_found" });

      // Release the contact methods (the whole point of an approved intro).
      return {
        contact: {
          contactId: intro.contactId,
          name: contact.name ?? null,
          phone: contact.phone ?? null,
          phoneNumbers: contact.phoneNumbers ?? [],
          email: contact.email ?? null,
          emails: contact.emails ?? [],
        },
      };
    },
  );
}
