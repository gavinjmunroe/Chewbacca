/**
 * Experiences routes — read the owner's shared-event log (contact_experiences)
 * so the app can show experiences in Memories and on a person's profile, each
 * one shareable via the sharing engine. Read-only here; capture still happens in
 * the chat/voice pipeline.
 *
 * Auth + owner resolution mirror circles.js (Privy JWT -> phone -> amber_id).
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import {
  resolveAmberIdByPhone,
  listExperiencesForOwner,
  listExperiencesForContact,
} from "../db/store.js";

async function resolveOwner(request, reply) {
  const privyDid = request.privyUser?.userId;
  if (!privyDid) {
    reply.code(401).send({ error: "no_user", message: "Auth required" });
    return null;
  }
  const phone = request.privyUser?.phone;
  const amberId = phone ? await resolveAmberIdByPhone(phone).catch(() => null) : null;
  if (!amberId) {
    reply.code(401).send({ error: "no_amber_id", message: "Account not found" });
    return null;
  }
  return amberId;
}

// Parse and validate an id route param as a uuid. Returns the canonical
// lowercase string, or null.
//
// IT USED TO REQUIRE A POSITIVE INTEGER, which is the whole of the bug: circles.id
// and contacts.id are uuid in the schema this app runs on, so every request that
// went through here answered 400 invalid_id before it reached a query. The ids
// were fine; the validator was checking for a type the database stopped using.
// circles.js was corrected for this months ago and these files were missed.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseId(raw) {
  return typeof raw === "string" && UUID_RE.test(raw.trim())
    ? raw.trim().toLowerCase()
    : null;
}

export function registerExperienceRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;

  // ── GET /v1/me/experiences ────────────────────────────────────────────────────
  app.get(
    "/v1/me/experiences",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const experiences = await listExperiencesForOwner(amberId);
      return { experiences };
    },
  );

  // ── GET /v1/me/contacts/:id/experiences ───────────────────────────────────────
  app.get(
    "/v1/me/contacts/:id/experiences",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const contactId = parseId(request.params.id);
      if (!contactId) {
        return reply
          .code(400)
          .send({ error: "invalid_contact_id", message: "id must be a uuid" });
      }
      const experiences = await listExperiencesForContact(amberId, contactId);
      return { experiences };
    },
  );
}
