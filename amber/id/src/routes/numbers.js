/**
 * Number pool routes: manage iMessage sender IDs.
 *
 * For now, number assignment is manual (admin adds via metadata).
 * This route provides visibility into which numbers are assigned.
 * When iMessage sender enterprise deal is live, this becomes the auto-assign endpoint.
 *
 * GET  /numbers/pool     - List all assigned numbers across tenants
 * POST /numbers/assign   - Assign a number to a tenant (admin)
 */

import { tenantIndex } from "../lib/auth-session.js";
import { setTenantMetadata } from "../db/store.js";
import { requireApiKey } from "../lib/auth.js";

export function registerNumberRoutes(app) {
  /**
   * GET /numbers/pool
   *
   * Lists all tenants that have a sender ID assigned.
   */
  app.get(
    "/numbers/pool",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      try {
        const users = tenantIndex.getAll();
        const assigned = users
          .filter((u) => u.customMetadata?.loopSenderId)
          .map((u) => ({
            privyDid: u.id,
            displayName: u.customMetadata?.displayName || null,
            loopSenderId: u.customMetadata.loopSenderId,
            loopSenderPhone: u.customMetadata?.loopSenderPhone || null,
            phoneNumber:
              u.customMetadata?.phoneNumber || u.phone?.number || null,
          }));

        return { data: assigned, total: assigned.length };
      } catch (err) {
        request.log.error(err, "Failed to list number pool");
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );

  /**
   * POST /numbers/assign
   *
   * Assign an iMessage sender ID + phone to a tenant.
   * Body: { did, loopSenderId, loopSenderPhone }
   */
  app.post(
    "/numbers/assign",
    {
      preHandler: [requireApiKey],
      schema: {
        body: {
          type: "object",
          required: ["did", "loopSenderId", "loopSenderPhone"],
          properties: {
            did: { type: "string" },
            loopSenderId: { type: "string" },
            loopSenderPhone: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { did, loopSenderId, loopSenderPhone } = request.body;

      try {
        // Read authoritatively (not from a stale 30s snapshot) before writing.
        await tenantIndex.forceRefresh();
        const user = tenantIndex.getByDid(did);
        if (!user) {
          return reply.code(404).send({ error: "Tenant not found" });
        }

        // Check this sender ID isn't already assigned to someone else
        const existing = tenantIndex.getByLoopSenderId(loopSenderId);
        if (existing && existing.id !== did) {
          return reply.code(409).send({
            error: `Sender ID already assigned to ${existing.customMetadata?.displayName || existing.id}`,
          });
        }

        const row = await setTenantMetadata(did, {
          loopSenderId,
          loopSenderPhone,
        });
        if (!row) {
          return reply.code(404).send({ error: "Tenant not found" });
        }

        // Refresh the tenant index after assignment
        await tenantIndex.forceRefresh();

        return {
          data: {
            did,
            loopSenderId,
            loopSenderPhone,
            message: "Number assigned successfully",
          },
        };
      } catch (err) {
        request.log.error(err, "Failed to assign number");
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );
}
