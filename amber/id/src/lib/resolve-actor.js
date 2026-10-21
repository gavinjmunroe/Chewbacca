/**
 * WHO IS CALLING, AND WHAT ARE THEY CALLING AS.
 *
 * Every route in this service answers the first half the same way and writes
 * the answer out by hand:
 *
 *     const phone = request.privyUser?.phone;
 *     const amberId = phone ? await resolveAmberIdByPhone(phone) : null;
 *     if (!amberId) return reply.code(401)...
 *
 * There are about thirty copies of that. They have already drifted -- some
 * catch, some do not; some say no_user, some say no_amber_id -- and the second
 * half of the question is the one the enterprise fork adds: WHICH COMPANY is
 * this account acting in, and with what authority. Adding that to thirty copies
 * means thirty chances to forget, and the one that forgets is an org route that
 * serves a company's data to somebody outside it.
 *
 * So it is one preHandler, and it sets:
 *
 *   request.amberId    the canonical owner id, same value the copies computed
 *   request.actor      { amberId, kind, orgId, orgRole, orgStatus, orgName }
 *
 * `kind` is "org" or "individual", and it is the fork Karthik described: the
 * same human may hold both, as two accounts, and this says which one is on the
 * phone right now. It is never a request parameter -- a client that could ask
 * to be treated as an org member would be a client that could ask to be in a
 * company it is not in.
 *
 * RESOLUTION ORDER IS PHONE, THEN DID, AND BOTH ARE NEEDED. The phone is what
 * every existing token carries and what every existing copy of this code uses.
 * The DID is what an email-only org member's token carries, because that
 * account has no phone at all -- there is nothing to key on but the subject of
 * the token we signed.
 *
 * Dependencies are injected so the tests can run this without a database, the
 * same way routes take `requireAuth`.
 */

import { resolveAmberIdByPhone as defaultResolveByPhone, resolveAmberIdByPrivyDid as defaultResolveByDid } from "../db/store.js";
import { getMembership as defaultGetMembership } from "../db/org-store.js";

/**
 * Resolve the actor without touching a reply. Returns the actor or null.
 * Exported separately because jobs and the MCP surface need the same answer
 * outside a request/reply pair.
 */
/**
 * THE SAME ANSWER, BUT IT SAYS WHY WHEN THERE ISN'T ONE.
 *
 * Returns { ok: true, actor } | { ok: false, reason: "not_found" | "unavailable" }.
 *
 * THE DISTINCTION IS THE WHOLE POINT, and its absence cost a signed-in admin
 * an afternoon staring at "Account not found" on a console that had already
 * loaded with his company's name on it.
 *
 * Both lookups here used to be wrapped in `.catch(() => null)`, so a database
 * that was up a second ago and refused a connection this second produced the
 * identical value as an account that does not exist. The route then said
 * "Account not found" with a 401 -- a sentence that is alarming, wrong, and
 * sends somebody to check their credentials when the credentials were fine.
 *
 * THE MEMBERSHIP LOOKUP IS WORSE AND IT WAS SWALLOWED TOO: a thrown lookup
 * made an org admin come back as `kind: "individual"`, which is not an error
 * at all -- it is a different, confident, wrong answer. The console then shows
 * somebody the "you are not in a company" path while their company sits there
 * intact. A transient failure must never be reported as a fact about who
 * somebody is.
 */
export async function resolveActorOutcome(session, deps = {}) {
  const resolveByPhone = deps.resolveByPhone ?? defaultResolveByPhone;
  const resolveByDid = deps.resolveByDid ?? defaultResolveByDid;
  const getMembership = deps.getMembership ?? defaultGetMembership;

  const found = await resolveAmberId(session, resolveByPhone, resolveByDid);
  if (!found.ok) return { ok: false, reason: found.reason };
  const amberId = found.amberId;

  let membership;
  try {
    membership = await getMembership(amberId);
  } catch {
    // The account exists. Whether it is in a company is unknown right now, and
    // "individual" is not the honest way to say that.
    return { ok: false, reason: "unavailable" };
  }

  if (!membership) {
    return {
      ok: true,
      actor: { amberId, kind: "individual", orgId: null, orgRole: null, orgStatus: null, orgName: null },
    };
  }
  return {
    ok: true,
    actor: {
      amberId,
      kind: "org",
      orgId: membership.orgId,
      orgRole: membership.role,
      orgStatus: membership.status,
      orgName: membership.orgName ?? null,
    },
  };
}

/**
 * The actor, or null. Kept for jobs and the MCP surface, which have no reply
 * to shape and nothing useful to do with the difference.
 */
export async function resolveActorFor(session, deps = {}) {
  const out = await resolveActorOutcome(session, deps);
  return out.ok ? out.actor : null;
}

/**
 * Phone first, then DID, and a THROW IS NOT A MISS.
 *
 * A failed lookup is remembered rather than swallowed: if either one threw and
 * neither of them found anybody, the answer is "we could not tell", not "no
 * such account". Only when every lookup ran cleanly and came back empty is
 * this genuinely a missing account.
 *
 * Returns { ok: true, amberId } | { ok: false, reason: "not_found" | "unavailable" }.
 */
async function resolveAmberId(session, resolveByPhone, resolveByDid) {
  let threw = false;

  const phone = session?.phone;
  if (phone) {
    try {
      const byPhone = await resolveByPhone(phone);
      if (byPhone) return { ok: true, amberId: byPhone };
    } catch {
      threw = true;
    }
  }

  const did = session?.userId;
  if (did) {
    try {
      const byDid = await resolveByDid(did);
      if (byDid) return { ok: true, amberId: byDid };
    } catch {
      threw = true;
    }
  }

  return { ok: false, reason: threw ? "unavailable" : "not_found" };
}

/**
 * The preHandler. Runs AFTER requireAuth and reads what requireAuth put on the
 * request; it does not verify tokens and must never be registered without one.
 */
export function makeResolveActor(deps = {}) {
  return async function resolveActor(request, reply) {
    if (!request.privyUser?.userId) {
      return reply.code(401).send({ error: "no_user", message: "Auth required" });
    }
    const out = await resolveActorOutcome(request.privyUser, deps);

    if (!out.ok && out.reason === "unavailable") {
      /*
       * 503, NOT 401, AND THE DIFFERENCE MATTERS TO THE PERSON READING IT.
       *
       * 401 tells a browser the credential is bad, which is how a signed-in
       * admin gets told their account does not exist by a service that simply
       * could not reach its database for one second. 503 says "ask again",
       * which is both true and actionable, and it is the status the client
       * retries on rather than bouncing somebody to a sign-in page.
       */
      request.log?.error?.(
        { did: request.privyUser?.userId },
        "[resolve-actor] account lookup unavailable -- the database did not answer",
      );
      reply.header("retry-after", "2");
      return reply.code(503).send({
        error: "lookup_unavailable",
        message: "We could not reach your account just now. Try again in a moment.",
      });
    }

    if (!out.ok) {
      return reply.code(401).send({ error: "no_amber_id", message: "Account not found" });
    }

    request.actor = out.actor;
    request.amberId = out.actor.amberId;
  };
}

/** The default instance, for routes with nothing to stub. */
export const resolveActor = makeResolveActor();

/**
 * In a company, in good standing. Used by every /v1/org route.
 *
 * A SUSPENDED MEMBER IS REFUSED HERE AND NOWHERE ELSE. Leaving that check to
 * the routes would mean the suspension takes effect on whichever ones somebody
 * remembered, which is the same failure mode this whole file exists to remove.
 */
export async function requireOrgMember(request, reply) {
  const actor = request.actor;
  if (!actor || actor.kind !== "org") {
    return reply.code(403).send({
      error: "not_in_org",
      message: "This account is not part of an organization.",
    });
  }
  if (actor.orgStatus !== "active") {
    return reply.code(403).send({
      error: "membership_suspended",
      message: "Your access to this organization is suspended.",
    });
  }
}

/** Admin of that company. The policy editor, invites, groups and the roster. */
export async function requireOrgAdmin(request, reply) {
  const denied = await requireOrgMember(request, reply);
  if (denied) return denied;
  if (request.actor.orgRole !== "admin") {
    return reply.code(403).send({
      error: "not_admin",
      message: "Only an organization admin can do that.",
    });
  }
}
