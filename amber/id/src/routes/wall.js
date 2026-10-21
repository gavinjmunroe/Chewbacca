/**
 * Wall routes — per-user Amber Wall post persistence.
 *
 *   GET    /v1/me/wall        — list active posts (newest first)
 *   POST   /v1/me/wall        — create a post
 *   PATCH  /v1/me/wall/:id    — update text / visibility
 *   DELETE /v1/me/wall/:id    — soft-delete a post
 *
 * Auth: amber-id / medha-id / Privy JWT via requireAuth.
 * Owner resolution: request.privyUser.phone → resolveAmberIdByPhone → amber_id.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone } from "../db/store.js";
import {
  listWallPosts,
  createWallPost,
  updateWallPost,
  softDeleteWallPost,
} from "../db/wall-store.js";

// Shared helper: resolve the caller's amber_id. Returns null and sends the
// appropriate error response when auth or account resolution fails.
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

export function registerWallRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;

  // ── GET /v1/me/wall ───────────────────────────────────────────────────────────
  // Returns all active posts for the caller, newest first.
  app.get(
    "/v1/me/wall",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const posts = await listWallPosts(amberId);
      return { posts };
    },
  );

  // ── POST /v1/me/wall ──────────────────────────────────────────────────────────
  // Creates a new post. Responds 201 with the post row.
  app.post(
    "/v1/me/wall",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["text"],
          properties: {
            text:       { type: "string", minLength: 1 },
            visibility: { type: "string", maxLength: 50 },
          },
        },
      },
    },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const body = request.body || {};
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) {
        return reply
          .code(400)
          .send({ error: "text_required", message: "text is required" });
      }
      const visibility =
        typeof body.visibility === "string" ? body.visibility.trim() || "private" : "private";

      const row = await createWallPost(amberId, { text, visibility });
      if (!row) {
        return reply
          .code(500)
          .send({ error: "create_failed", message: "Could not create post" });
      }
      return reply.code(201).send({
        post: {
          id: String(row.id),
          text: row.text,
          visibility: row.visibility,
          createdAt: row.created_at ?? null,
          updatedAt: row.updated_at ?? null,
        },
      });
    },
  );

  // ── PATCH /v1/me/wall/:id ─────────────────────────────────────────────────────
  // Partial update — supply any subset of { text, visibility }. 404 if not owned.
  app.patch(
    "/v1/me/wall/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const postId = parseId(request.params.id);
      if (!postId) {
        return reply
          .code(400)
          .send({ error: "invalid_id", message: "id must be a positive integer" });
      }

      const body = request.body || {};
      const patch = {};
      if (typeof body.text === "string") {
        const trimmed = body.text.trim();
        if (!trimmed) {
          return reply
            .code(400)
            .send({ error: "invalid_text", message: "text cannot be empty" });
        }
        patch.text = trimmed;
      }
      if (typeof body.visibility === "string") {
        patch.visibility = body.visibility.trim() || "private";
      }
      if (Object.keys(patch).length === 0) {
        return reply
          .code(400)
          .send({ error: "no_fields", message: "Supply at least one of: text, visibility" });
      }

      const row = await updateWallPost(amberId, postId, patch);
      if (!row) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "Post not found or not owned" });
      }
      return {
        post: {
          id: String(row.id),
          text: row.text,
          visibility: row.visibility,
          createdAt: row.created_at ?? null,
          updatedAt: row.updated_at ?? null,
        },
      };
    },
  );

  // ── DELETE /v1/me/wall/:id ────────────────────────────────────────────────────
  // Soft-delete a post. Returns { deleted: 1 } on success, { deleted: 0 } if
  // the post was not found or already deleted.
  app.delete(
    "/v1/me/wall/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const postId = parseId(request.params.id);
      if (!postId) {
        return reply
          .code(400)
          .send({ error: "invalid_id", message: "id must be a positive integer" });
      }

      const deleted = await softDeleteWallPost(amberId, postId);
      return { deleted };
    },
  );
}
