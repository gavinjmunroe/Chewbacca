/**
 * COHORT ROUTES — the audiences the address book derived for you.
 *
 *   GET  /v1/me/cohorts               — your derived audiences, biggest first
 *   GET  /v1/me/cohorts/:id/members   — who is in one, and why
 *   POST /v1/me/cohorts/refresh       — recompute from your contacts
 *
 * THERE IS NO POST /members AND THERE WILL NOT BE. A cohort means "everyone in
 * my book with a stanford.edu address". The moment a member can be added by
 * hand it means "whoever I remembered to add", which is a circle, and circles
 * have their own routes a file away. Membership is output, so the only write
 * here is "recompute".
 *
 * WHY THE EVIDENCE IS RETURNED. The first question anybody asks about an
 * automatic audience is "why is this person in it", and the second is "why is
 * this person NOT in it". A picker that cannot answer either will not be
 * trusted with something somebody actually wants to keep inside one school.
 *
 * Auth and owner resolution mirror shares.js (Privy JWT -> phone -> amber_id).
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone } from "../db/store.js";
import { listCohorts, listCohortMembers, refreshCohorts } from "../db/cohorts-store.js";

async function resolveOwner(request, reply) {
  if (!request.privyUser?.userId) {
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

export function registerCohortRoutes(app, { requireAuth = defaultRequireAuth } = {}) {
  app.get("/v1/me/cohorts", { preHandler: [requireAuth] }, async (request, reply) => {
    const owner = await resolveOwner(request, reply);
    if (!owner) return;
    const cohorts = await listCohorts(owner);
    return { cohorts, count: cohorts.length };
  });

  app.get(
    "/v1/me/cohorts/:id/members",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const owner = await resolveOwner(request, reply);
      if (!owner) return;
      const members = await listCohortMembers(owner, String(request.params.id || ""));
      return { members, count: members.length };
    },
  );

  /**
   * Recompute. Idempotent and safe to call again: the result is a function of
   * the contacts table and this holds no state of its own.
   */
  app.post("/v1/me/cohorts/refresh", { preHandler: [requireAuth] }, async (request, reply) => {
    const owner = await resolveOwner(request, reply);
    if (!owner) return;
    try {
      const summary = await refreshCohorts(owner);
      const cohorts = await listCohorts(owner);
      return { ...summary, cohorts };
    } catch (err) {
      request.log.error({ err: err?.message }, "[cohorts] refresh failed");
      return reply.code(503).send({ error: "refresh_failed" });
    }
  });
}
