/**
 * Sharing routes — the privacy ledger over shareable items (experiences now,
 * posts + interactions + media later). NEVER notes or facts.
 *
 *   POST   /v1/me/shares            — share an item to a contact / circle / network
 *   POST   /v1/me/shares/unshare    — remove a share by its audience target
 *   DELETE /v1/me/shares/:id        — remove a share by id
 *   GET    /v1/me/shares/for-item   — the audiences one item is shared to
 *   GET    /v1/me/shared-with-me    — everything shared WITH the caller
 *
 * Auth + owner resolution mirror circles.js (Privy JWT -> phone -> amber_id).
 * A one-to-one (contact) share pushes a notification to the recipient, best-effort.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone, getUserProfileByAmberId } from "../db/store.js";
import {
  createShare,
  deleteShare,
  deleteShareByTarget,
  listSharesForItem,
  getSharedWithViewer,
  resolveContactRecipient,
} from "../db/shares-store.js";
import { notifyAmberUsers } from "../lib/notify.js";

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

function parseId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Fire a push to the recipient of a one-to-one share. Best-effort: any failure
// is swallowed so it never blocks the share itself.
async function pushContactShare(app, senderAmberId, contactId, item = {}) {
  try {
    const recipient = await resolveContactRecipient(senderAmberId, contactId);
    if (!recipient) return;
    const prof = await getUserProfileByAmberId(senderAmberId).catch(() => null);
    const who = prof?.name || "Someone";
    // Through notifyAmberUsers rather than sendExpoPush directly: this was the one
    // push in the app that already worked, and it was also the one place dead tokens
    // never got pruned and ticket errors were never surfaced. One path for all of it.
    await notifyAmberUsers({
      ownerIds: [recipient],
      title: `${who} shared with you`,
      body: "Open Amber to see what they shared, just with you.",
      // itemType/itemId are in the request body and were being discarded, which is
      // why this push could only ever open Home.
      data: {
        type: "share",
        ...(item.itemType ? { itemType: String(item.itemType) } : {}),
        ...(item.itemId != null ? { itemId: String(item.itemId) } : {}),
      },
      fromAmberId: senderAmberId,
      log: app?.log,
    });
  } catch (err) {
    app.log?.warn?.({ err: err?.message }, "[shares] push failed");
  }
}

export function registerSharesRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;

  // ── POST /v1/me/shares ────────────────────────────────────────────────────────
  app.post(
    "/v1/me/shares",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["itemType", "itemId", "scopeType"],
          properties: {
            itemType: { type: "string", enum: ["experience", "post", "interaction"] },
            itemId: { type: ["string", "integer"] },
            // 'cohort' was already resolvable by the predicate and missing from
            // this enum, so a derived audience could not be addressed from this
            // route at all. 'org' and 'group' are migration 063.
            scopeType: {
              type: "string",
              enum: ["contact", "circle", "network", "cohort", "org", "group"],
            },
            scopeRef: { type: ["string", "integer", "null"] },
            // What KIND of thing this is, for a member of a company: the axis
            // their org's ceiling is set along. Ignored entirely for a consumer
            // account, and defaulted to 'internal' by the store when an org
            // member omits it.
            classification: {
              type: "string",
              enum: ["public", "internal", "customer_safe", "private"],
            },
          },
        },
      },
    },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const { itemType, itemId, scopeType, scopeRef = null, classification = null } =
        request.body || {};
      const created = await createShare(amberId, {
        itemType,
        itemId,
        scopeType,
        scopeRef,
        classification,
      });
      if (!created) {
        return reply
          .code(400)
          .send({ error: "share_failed", message: "Could not share (check the item and audience)" });
      }
      // One-to-one share notifies the recipient. Do not await — let it run after
      // the response so a slow push never delays the share.
      if (scopeType === "contact" && scopeRef != null) {
        void pushContactShare(app, amberId, scopeRef, { itemType, itemId });
      }
      return reply.code(201).send({ share: created });
    },
  );

  // ── POST /v1/me/shares/unshare ────────────────────────────────────────────────
  // Remove a share by its audience target, so a UI toggle can un-share without
  // knowing the share id.
  app.post(
    "/v1/me/shares/unshare",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["itemType", "itemId", "scopeType"],
          properties: {
            itemType: { type: "string", enum: ["experience", "post", "interaction"] },
            itemId: { type: ["string", "integer"] },
            // 'cohort' was already resolvable by the predicate and missing from
            // this enum, so a derived audience could not be addressed from this
            // route at all. 'org' and 'group' are migration 063.
            scopeType: {
              type: "string",
              enum: ["contact", "circle", "network", "cohort", "org", "group"],
            },
            scopeRef: { type: ["string", "integer", "null"] },
            // What KIND of thing this is, for a member of a company: the axis
            // their org's ceiling is set along. Ignored entirely for a consumer
            // account, and defaulted to 'internal' by the store when an org
            // member omits it.
            classification: {
              type: "string",
              enum: ["public", "internal", "customer_safe", "private"],
            },
          },
        },
      },
    },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const { itemType, itemId, scopeType, scopeRef = null } = request.body || {};
      const removed = await deleteShareByTarget(amberId, { itemType, itemId, scopeType, scopeRef });
      return { unshared: true, removed };
    },
  );

  // ── DELETE /v1/me/shares/:id ──────────────────────────────────────────────────
  app.delete(
    "/v1/me/shares/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const id = parseId(request.params.id);
      if (!id) {
        return reply
          .code(400)
          .send({ error: "invalid_id", message: "id must be a positive integer" });
      }
      const removed = await deleteShare(amberId, id);
      return { removed };
    },
  );

  // ── GET /v1/me/shares/for-item?itemType=&itemId= ──────────────────────────────
  // The audiences one item is currently shared to, so a share sheet can show and
  // toggle its state.
  app.get(
    "/v1/me/shares/for-item",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const itemType = String(request.query?.itemType ?? "");
      const itemId = parseId(request.query?.itemId);
      if (!itemId) {
        return reply
          .code(400)
          .send({ error: "invalid_item", message: "itemId must be a positive integer" });
      }
      const shares = await listSharesForItem(amberId, itemType, itemId);
      return { shares };
    },
  );

  // ── GET /v1/me/shared-with-me ─────────────────────────────────────────────────
  // Everything shared WITH the caller, resolved by real edges (connection, being
  // the contact, or circle membership). The dedicated shared feed reads this.
  app.get(
    "/v1/me/shared-with-me",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const phone = request.privyUser?.phone ?? null;
      const items = await getSharedWithViewer(amberId, phone);
      return { items };
    },
  );
}
