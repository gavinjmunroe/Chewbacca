/**
 * THE ACCOUNT'S OWN SIGN-IN SETTINGS.
 *
 *   GET  /v1/me/credentials     what this account can sign in with
 *   PUT  /v1/me/username        claim or change a username
 *   PUT  /v1/me/password        set or change a password
 *
 * WHY THIS EXISTS AT ALL. Every door into this product was something somebody
 * receives: a code to a phone, a link to an inbox. Good as a default, bad as
 * the only option -- it makes signing in depend on a mail provider being
 * configured and on the person being next to a particular device. An invited
 * member could accept, land in the workspace, and then have no way back in on
 * Monday that did not involve an inbox. There was no route to set a password;
 * signInWithPassword had been shipped with nothing that could ever populate
 * the column it reads.
 *
 * THESE ARE THE ONLY ROUTES THAT CHANGE A CREDENTIAL, and they all require a
 * live session for the account being changed. There is deliberately no admin
 * route that sets somebody else's password: an admin who can become a member
 * can read that member's private work, and nothing in this product needs
 * that.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { ownerIdFromSession } from "../lib/owner-id.js";
import {
  changePassword,
  credentialsFor,
  setUsername,
  usernameComplaint,
} from "../db/org-invite-store.js";

export function registerAccountRoutes(app, { requireAuth = defaultRequireAuth } = {}) {
  async function me(request, reply) {
    const amberId = await ownerIdFromSession(request.privyUser);
    if (!amberId) {
      reply.code(401).send({ error: "no_amber_id", message: "Account not found" });
      return null;
    }
    return amberId;
  }

  app.get("/v1/me/credentials", { preHandler: [requireAuth] }, async (request, reply) => {
    const amberId = await me(request, reply);
    if (!amberId) return;
    const creds = await credentialsFor(amberId);
    if (!creds) return reply.code(404).send({ error: "not_found" });
    /*
     * The email and phone come back MASKED. This is the one screen that names
     * every way into the account at once, and it is reachable with a browser
     * token -- so it confirms what somebody already knows rather than handing
     * a stolen session the full address to go and attack.
     */
    return {
      username: creds.username,
      hasPassword: creds.hasPassword,
      email: mask(creds.email),
      phone: creds.phone ? `•••• ${String(creds.phone).slice(-4)}` : null,
    };
  });

  app.put(
    "/v1/me/username",
    {
      preHandler: [requireAuth],
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          required: ["username"],
          properties: { username: { type: "string", minLength: 3, maxLength: 32 } },
        },
      },
    },
    async (request, reply) => {
      const amberId = await me(request, reply);
      if (!amberId) return;

      const complaint = usernameComplaint(request.body.username);
      if (complaint) return reply.code(400).send({ error: "bad_username", message: complaint });

      const result = await setUsername(amberId, request.body.username);
      if (!result.ok) {
        // "Taken" is a 409 and says so. This is one of the few places where
        // telling somebody a name exists is correct: they cannot have it, and
        // any wording that hid that would just make them try again.
        const status = result.reason === "taken" ? 409 : result.reason === "not_found" ? 404 : 400;
        return reply.code(status).send({
          error: result.reason,
          message: result.message ?? "Could not set that username.",
        });
      }
      return { ok: true, username: result.username };
    },
  );

  app.put(
    "/v1/me/password",
    {
      preHandler: [requireAuth],
      // Tighter than the username limit: this is the route worth guessing at.
      config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          required: ["password"],
          properties: {
            password: { type: "string", minLength: 1, maxLength: 200 },
            current: { type: ["string", "null"], maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const amberId = await me(request, reply);
      if (!amberId) return;

      const result = await changePassword(amberId, {
        current: request.body.current ?? null,
        next: request.body.password,
      });
      if (!result.ok) {
        const status =
          result.reason === "bad_current" ? 403 : result.reason === "not_found" ? 404 : 400;
        return reply.code(status).send({
          error: result.reason,
          message: result.message ?? "Could not set that password.",
        });
      }
      return { ok: true, created: result.created };
    },
  );
}

/** a••••@company.com — enough to recognize, not enough to be told. */
function mask(email) {
  if (!email) return null;
  const [local, domain] = String(email).split("@");
  if (!domain) return null;
  const head = local.slice(0, 1);
  return `${head}${"•".repeat(Math.max(3, local.length - 1))}@${domain}`;
}
