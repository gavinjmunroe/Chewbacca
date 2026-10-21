/**
 * Privacy routes — Firestore-backed (DID-keyed).
 *
 * PRIVACY-01: Multi-tier privacy system with field-level permissions.
 *
 * GET  /v1/privacy/tier
 * PUT  /v1/privacy/tier
 * GET  /v1/privacy/permissions
 * PUT  /v1/privacy/permissions
 * GET  /v1/privacy/audit
 *
 * All routes operate strictly on the authenticated caller's DID.
 */

import { requireAuth } from "../lib/auth-session.js";
import {
  getOrCreateUser,
  setUserPrivacyTier,
  listPermissions,
  getPermission,
  upsertPermission,
  disableAllPermissions,
  appendPermissionAudit,
  listPermissionAudit,
  deleteAllContacts,
} from "../db/user-store.js";

const VALID_FIELDS = [
  "contacts",
  "birthday",
  "health",
  "calendar",
  "location",
  "alma_mater",
  "hometown",
  "city",
];

const VALID_TIERS = ["local_only", "selective_cloud", "full_social"];

function requirePrivyDid(request, reply) {
  const privyDid = request.privyUser?.userId;
  if (!privyDid) {
    reply.code(401).send({ error: "no_user", message: "Auth required" });
    return null;
  }
  return privyDid;
}

export function registerPrivacyRoutes(app) {
  /**
   * GET /v1/privacy/tier
   */
  app.get(
    "/v1/privacy/tier",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const privyDid = requirePrivyDid(request, reply);
      if (!privyDid) return;
      // Read the tier from amber (getOrCreateUser returns the users row) so a
      // write via setUserPrivacyTier is reflected here (Chunk 4a).
      const user = await getOrCreateUser(privyDid);
      const tier = user?.privacy_tier || "local_only";
      return { tier };
    },
  );

  /**
   * PUT /v1/privacy/tier
   * Downgrading triggers cloud data deletion.
   */
  app.put(
    "/v1/privacy/tier",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const privyDid = requirePrivyDid(request, reply);
      if (!privyDid) return;
      // amber users row — also the source for the current-tier read below.
      const user = await getOrCreateUser(privyDid);

      const tier = request.body?.tier;
      if (!VALID_TIERS.includes(tier)) {
        return reply.code(400).send({
          error: "invalid_tier",
          message: "Tier must be local_only, selective_cloud, or full_social",
        });
      }

      const current = user?.privacy_tier || "local_only";
      const isDowngrade =
        (current === "full_social" && tier !== "full_social") ||
        (current === "selective_cloud" && tier === "local_only");

      await setUserPrivacyTier(privyDid, tier);

      if (isDowngrade) {
        await deleteAllContacts(privyDid);
        await disableAllPermissions(privyDid);
      }

      return { tier, wasDowngrade: isDowngrade };
    },
  );

  /**
   * GET /v1/privacy/permissions
   */
  app.get(
    "/v1/privacy/permissions",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const privyDid = requirePrivyDid(request, reply);
      if (!privyDid) return;
      return await listPermissions(privyDid);
    },
  );

  /**
   * PUT /v1/privacy/permissions
   * Body: { permissions: [{ fieldType, syncEnabled }] }
   */
  app.put(
    "/v1/privacy/permissions",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const privyDid = requirePrivyDid(request, reply);
      if (!privyDid) return;
      // amber users row — also the source for the tier gate below.
      const user = await getOrCreateUser(privyDid);

      const permissions = request.body?.permissions;
      if (!Array.isArray(permissions)) {
        return reply.code(400).send({
          error: "bad_request",
          message: "Body must have a permissions array",
        });
      }

      const tier = user?.privacy_tier || "local_only";
      if (tier === "local_only") {
        return reply.code(400).send({
          error: "tier_violation",
          message: "Upgrade your privacy tier before enabling field sync.",
        });
      }

      const results = [];
      for (const { fieldType, syncEnabled } of permissions) {
        if (!VALID_FIELDS.includes(fieldType)) continue;

        const existing = await getPermission(privyDid, fieldType);
        await appendPermissionAudit(privyDid, {
          fieldType,
          oldValue: existing?.syncEnabled ?? null,
          newValue: !!syncEnabled,
        });

        const saved = await upsertPermission(privyDid, {
          fieldType,
          syncEnabled,
        });
        if (saved) results.push(saved);
      }

      return results;
    },
  );

  /**
   * GET /v1/privacy/audit
   */
  app.get(
    "/v1/privacy/audit",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const privyDid = requirePrivyDid(request, reply);
      if (!privyDid) return;
      return await listPermissionAudit(privyDid);
    },
  );
}
