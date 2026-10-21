/**
 * Connections social graph routes.
 *
 *   GET    /v1/me/connect/search?q=                  — search users (prefix/substring/uuid)
 *   GET    /v1/me/connect/username-available?u=       — check username availability
 *   POST   /v1/me/connect/requests                   — send a connection request
 *   GET    /v1/me/connect/requests?direction=         — list incoming or outgoing requests
 *   POST   /v1/me/connect/requests/:id/accept         — accept an incoming request
 *   POST   /v1/me/connect/requests/:id/decline        — decline an incoming request
 *   DELETE /v1/me/connect/requests/:id                — cancel an outgoing request
 *   GET    /v1/me/connect/connections                 — list confirmed connections
 *   GET    /v1/me/connect/feed                        — network wall feed
 *
 * Auth: amber-id / medha-id / Privy JWT via requireAuth.
 * Owner resolution: request.privyUser.phone → resolveAmberIdByPhone → amber_id.
 * NOTE: /v1/me/connections (OAuth) is a separate route — do not conflict with it.
 */

import { socialForPosts } from "../db/post-social.js";
import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone, getUserProfileByAmberId } from "../db/store.js";
import { notifyAmberUsers } from "../lib/notify.js";
import { isUsernameAvailable } from "../db/store.js";
import {
  searchUsers,
  createRequest,
  respondToRequest,
  cancelRequest,
  listIncomingRequests,
  listOutgoingRequests,
  listConnections,
  listNetworkFeed,
  resolveContactAmberUser,
} from "../db/connections-store.js";

// Shared helper: resolve the caller's amber_id. Returns null and sends the
// appropriate error when auth or account resolution fails.
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

// Parse and validate a route param as a positive integer. Returns the number or null.
function parseId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const _USERNAME_RE = /^[a-z0-9_]{3,20}$/;

// One letter is a sweep of the user table, not a lookup. Two is the shortest thing
// a person actually types when they are looking for someone they know.
const MIN_QUERY_CHARS = 2;

export function registerConnectRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;

  // ── GET /v1/me/connect/search?q= ──────────────────────────────────────────────
  // Search users by username prefix, full-name substring, or exact amber_id.
  //
  // BEING FINDABLE BY NAME IS THE PRODUCT and is deliberately unrestricted: you can
  // look someone up by their real name, username, phone or Amber ID the same way you
  // can in any other social app. What is restricted here is BULK HARVESTING, which is
  // a different thing that came free with it.
  //
  // The query is an unanchored ILIKE (see connections-store.searchUsers), so a
  // single character matched a large fraction of the user table and 50 rows came
  // back per request with no per-route limit on top. Walking the entire directory
  // was a short script. Neither guard below narrows who can find whom:
  //
  //   MIN_QUERY_CHARS  a real lookup is a name or a handle, never one letter. A
  //                    single character is a sweep, not a search.
  //   rateLimit        a person adds a handful of people; nobody types 60 distinct
  //                    searches a minute. Generous for humans, useless for a script.
  app.get(
    "/v1/me/connect/search",
    {
      preHandler: [requireAuth],
      config: { rateLimit: { max: 40, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const q = typeof request.query.q === "string" ? request.query.q.trim() : "";
      if (!q) {
        return reply
          .code(400)
          .send({ error: "q_required", message: "q query param is required" });
      }
      if (q.length < MIN_QUERY_CHARS) {
        // Not an error the UI should shout about — the search screen simply waits
        // for a second character before it asks.
        return { users: [] };
      }
      const limit = Math.min(Number(request.query.limit) || 20, 50);
      const users = await searchUsers(amberId, q, { limit });
      // Enough to see a harvest in the logs after the fact. The query itself is a
      // person's name, so it is truncated and the caller is the id, not the name.
      request.log.info(
        { caller: amberId, qLen: q.length, hits: users.length },
        "[connect] user search",
      );
      return { users };
    },
  );

  // ── GET /v1/me/connect/username-available?u= ──────────────────────────────────
  // Check whether a username string is syntactically valid and unclaimed.
  app.get(
    "/v1/me/connect/username-available",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const u = typeof request.query.u === "string" ? request.query.u.trim().toLowerCase() : "";
      if (!u) {
        return reply
          .code(400)
          .send({ error: "u_required", message: "u query param is required" });
      }
      if (!_USERNAME_RE.test(u)) {
        return { available: false, username: u, reason: "invalid_format" };
      }
      const available = await isUsernameAvailable(u);
      return { available, username: u };
    },
  );

  // ── POST /v1/me/connect/requests ──────────────────────────────────────────────
  // Send a connection request to another user by amber_id.
  app.post(
    "/v1/me/connect/requests",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["addresseeAmberId"],
          properties: {
            addresseeAmberId: { type: "string" },
            message:          { type: "string", maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const body = request.body || {};
      const addresseeAmberId =
        typeof body.addresseeAmberId === "string" ? body.addresseeAmberId.trim() : "";
      if (!addresseeAmberId) {
        return reply
          .code(400)
          .send({ error: "addressee_required", message: "addresseeAmberId is required" });
      }
      const message =
        typeof body.message === "string" ? body.message.trim() || null : null;

      const result = await createRequest(amberId, addresseeAmberId, message);

      if (result.status === "self") {
        return reply.code(400).send({ error: "self_connect", message: "Cannot connect to yourself" });
      }
      /**
       * DELIBERATELY VAGUE, AND DELIBERATELY THE SAME SHAPE AS ANY OTHER REFUSAL.
       *
       * "You are blocked" tells somebody they were blocked, which is a thing the
       * person who blocked them did not choose to tell them. It also turns this
       * endpoint into an oracle: send a request to any account and learn whether
       * that person has blocked you. The request simply cannot be sent.
       */
      if (result.status === "blocked") {
        return reply
          .code(403)
          .send({ error: "cannot_connect", message: "This request could not be sent." });
      }
      if (result.status === "error") {
        return reply.code(500).send({ error: "request_failed", message: "Could not create request" });
      }
      // TELL THEM SOMEONE WANTS TO CONNECT. A connection request produced no
      // notification at all, so it sat in a list the recipient had no reason to open.
      // Only on a state CHANGE — `already_requested` must not re-notify, or tapping
      // Connect twice pings them twice.
      if (result.status === "requested" || result.status === "connected") {
        const prof = await getUserProfileByAmberId(amberId).catch(() => null);
        const who = prof?.name || prof?.fullName || "Someone";
        await notifyAmberUsers({
          ownerIds: [addresseeAmberId],
          title:
            result.status === "connected"
              ? `You and ${who} are connected`
              : `${who} wants to connect on Amber`,
          body:
            result.status === "connected"
              ? "Open Amber to see what they share."
              : "Open Amber to accept.",
          // The body says "open Amber to accept", so the tap has to land on the
          // screen with the Accept button, not on Home.
          data: { type: "connection", view: "incoming" },
          fromAmberId: amberId,
          log: request.log,
        });
      }
      // already_connected, already_requested, requested, connected — all 200
      return result;
    },
  );

  // ── GET /v1/me/connect/requests?direction=incoming|outgoing ──────────────────
  app.get(
    "/v1/me/connect/requests",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const direction = request.query.direction;
      if (direction === "outgoing") {
        const requests = await listOutgoingRequests(amberId);
        return { requests };
      }
      // Default to incoming
      const requests = await listIncomingRequests(amberId);
      return { requests };
    },
  );

  // ── POST /v1/me/connect/requests/:id/accept ───────────────────────────────────
  app.post(
    "/v1/me/connect/requests/:id/accept",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const requestId = parseId(request.params.id);
      if (!requestId) {
        return reply
          .code(400)
          .send({ error: "invalid_id", message: "id must be a positive integer" });
      }

      const result = await respondToRequest(amberId, requestId, "accept");
      if (!result.ok) {
        const code = result.reason === "not_found" ? 404 : 500;
        return reply.code(code).send({ error: result.reason });
      }
      // The person who ASKED is the one waiting to hear. respondToRequest returns the
      // other side's id when it has it; without that there is nobody to notify and
      // this is skipped rather than guessed at.
      const requester = result.requesterAmberId || result.otherAmberId || null;
      if (requester) {
        const prof = await getUserProfileByAmberId(amberId).catch(() => null);
        const who = prof?.name || prof?.fullName || "Someone";
        await notifyAmberUsers({
          ownerIds: [requester],
          title: `${who} accepted your request`,
          body: "You're connected on Amber.",
          data: { type: "connection", view: "connections" },
          fromAmberId: amberId,
          log: request.log,
        });
      }
      return result;
    },
  );

  // ── POST /v1/me/connect/requests/:id/decline ──────────────────────────────────
  app.post(
    "/v1/me/connect/requests/:id/decline",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const requestId = parseId(request.params.id);
      if (!requestId) {
        return reply
          .code(400)
          .send({ error: "invalid_id", message: "id must be a positive integer" });
      }

      const result = await respondToRequest(amberId, requestId, "decline");
      if (!result.ok) {
        const code = result.reason === "not_found" ? 404 : 500;
        return reply.code(code).send({ error: result.reason });
      }
      return result;
    },
  );

  // ── DELETE /v1/me/connect/requests/:id ───────────────────────────────────────
  // Cancel an outgoing pending request sent by the caller.
  app.delete(
    "/v1/me/connect/requests/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const requestId = parseId(request.params.id);
      if (!requestId) {
        return reply
          .code(400)
          .send({ error: "invalid_id", message: "id must be a positive integer" });
      }

      const result = await cancelRequest(amberId, requestId);
      if (!result.ok) {
        const code = result.reason === "not_found" ? 404 : 500;
        return reply.code(code).send({ error: result.reason });
      }
      return result;
    },
  );

  // ── GET /v1/me/connect/connections ───────────────────────────────────────────
  // All confirmed connections for the caller.
  app.get(
    "/v1/me/connect/connections",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const connections = await listConnections(amberId);
      return { connections };
    },
  );

  // ── GET /v1/me/connect/feed ───────────────────────────────────────────────────
  // Network wall feed: wall_posts with visibility='network' from connections.
  app.get(
    "/v1/me/connect/feed",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const limit = Math.min(Number(request.query.limit) || 50, 200);
      const posts = await listNetworkFeed(amberId, { limit });
      /**
       * REACTIONS AND COMMENT COUNTS RIDE WITH THE PAGE.
       *
       * The feed renders a page of posts and every one of them needs its
       * reaction row and its comment count. Fetching those per card is the
       * difference between two queries and forty, and a feed that has to make a
       * request per row to know whether you already liked something will draw
       * every heart empty and then pop them on.
       *
       * Degrades rather than fails: socialForPosts swallows its own errors and
       * returns empty state, so a feed missing its counts is still a feed.
       */
      const social = await socialForPosts(amberId, posts.map((p) => p.postId));
      return {
        posts: posts.map((p) => ({
          ...p,
          ...(social.get(String(p.postId)) ?? {
            reactions: { counts: {}, mine: null },
            commentCount: 0,
          }),
        })),
      };
    },
  );

  // ── POST /v1/me/connect/resolve-by-phone ──────────────────────────────────
  // Given a contact's phone number(s), return whether they're an Amber user and
  // the caller's connection status with them (or null). POST (not GET) so phone
  // numbers never land in a URL / query string / access log.
  //
  // RATE LIMITED because it is a phone -> identity oracle by design. That is the
  // legitimate feature ("which of my contacts are on Amber"), and a contact sync is
  // bursty: a few hundred numbers arrive in ten-number batches on first launch and
  // then almost never again. 30 requests a minute covers that burst and still caps a
  // script at 300 numbers a minute instead of the unbounded rate it had before.
  app.post(
    "/v1/me/connect/resolve-by-phone",
    {
      preHandler: [requireAuth],
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          required: ["phones"],
          properties: {
            phones: {
              type: "array",
              items: { type: "string" },
              maxItems: 10,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const phones = request.body?.phones;
      if (!Array.isArray(phones) || !phones.every((p) => typeof p === "string")) {
        return reply
          .code(400)
          .send({ error: "phones_required", message: "phones must be an array of strings" });
      }
      if (phones.length > 10) {
        return reply
          .code(400)
          .send({ error: "too_many_phones", message: "at most 10 phones" });
      }

      const amberUser = await resolveContactAmberUser(amberId, phones);
      return { amberUser };
    },
  );
}
