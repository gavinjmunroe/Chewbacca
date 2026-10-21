import { getUserByPrivyDid as getUserByDid } from "../db/user-store.js";
/**
 * GET /v1/me/identity-summary
 *
 * The user's unified Amber identity envelope. Returns one record per person
 * across every Amber surface (iMessage via Photon sender, in-app via Privy auth,
 * future visionOS / web). The DID is the canonical key — every transport
 * resolves to the same DID, so amber-agent loads the same context regardless
 * of channel.
 *
 *   {
 *     did:                 "did:privy:...",
 *     phone:               "+1 555 010 0002",
 *     displayName:         "Camber",
 *     agentName:           "Camber",
 *     loopSenderId:        "c351f20c-...",   // null until provisioned
 *     loopSenderPhone:     "+1 555 010 0003",
 *     contextRepo:         "calebnewtonusc/caleb-context",
 *     channels: [
 *       { kind: "in_app",   active: true,  description: "Privy session" },
 *       { kind: "imessage", active: true,  description: "Photon sender +15550100003" }
 *     ]
 *   }
 *
 * iOS Profile renders this so the user sees one identity, two transports.
 */

import { requireAuth } from "../lib/auth-session.js";
import { getProfile } from "../db/user-store.js";

function fmtPhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `+1 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return raw;
}

export function registerIdentitySummaryRoutes(app) {
  app.get(
    "/v1/me/identity-summary",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = request.privyUser?.userId;
      if (!did) {
        return reply.code(401).send({ error: "no_user" });
      }

      let user;
      try {
        user = await getUserByDid(did);
      } catch (err) {
        request.log.error(err, "[identity-summary] getUserByDid failed");
        return reply.code(503).send({ error: "privy_unavailable" });
      }
      if (!user) {
        return reply.code(404).send({ error: "user_not_found" });
      }

      const meta = user.customMetadata || {};
      const profile = await getProfile(did).catch(() => null);

      const phone =
        user.phone?.number || meta.phoneNumber || profile?.phoneNumber || null;
      const displayName = profile?.displayName || meta.displayName || null;
      const agentName = meta.agentName || displayName || null;
      const loopSenderId = meta.loopSenderId || null;
      const loopSenderPhone = meta.loopSenderPhone || null;
      const contextRepo = meta.contextRepo || null;

      const channels = [
        {
          kind: "in_app",
          active: true,
          description: "Privy session — talk to Amber inside the app.",
        },
        {
          kind: "imessage",
          active: Boolean(loopSenderPhone),
          description: loopSenderPhone
            ? `Text Amber at ${fmtPhone(loopSenderPhone)} — same Amber, same memory.`
            : "iMessage handle assigned at first onboarding.",
        },
      ];

      return {
        did,
        phone: phone ? fmtPhone(phone) : null,
        rawPhone: phone,
        displayName,
        agentName,
        loopSenderId,
        loopSenderPhone,
        loopSenderPhoneFormatted: loopSenderPhone
          ? fmtPhone(loopSenderPhone)
          : null,
        contextRepo,
        channels,
      };
    },
  );
}
