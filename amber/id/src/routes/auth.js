import { verifySessionTokenAny } from "../lib/auth-session.js";
import { getUserByPrivyDid as getUserByDid } from "../db/user-store.js";
/**
 * Auth routes: Privy token verification, user onboarding, and Firestore-backed profile.
 *
 * POST /auth/verify    - Verify a Privy token, get-or-create user in Firestore
 * POST /auth/onboard   - Complete onboarding (set initial metadata + write to Firestore)
 * GET  /v1/auth/me     - Return full Firestore-backed profile
 *
 * Migrated from Drizzle/Postgres to Firestore (DID-keyed) per the AGENTS.md
 * "DID is the primary key everywhere" rule. The wire shape preserves
 * `dbUserId` and `userId` for backwards-compat with iOS/web clients —
 * both now equal the Privy DID.
 */

import {
  requireAuth
} from "../lib/auth-session.js";
import {
  getOrCreateUser,
  getProfile,
  listPersonalityProfiles,
  insertPersonalityIfAbsent,
  getUserByPrivyDid,
} from "../db/user-store.js";

// Privy customMetadata only stores primitives, so nested objects (like
// onboardingProfile, permissions) get serialized with this prefix and need to
// be parsed back on read. Without this, `meta.onboardingProfile?.completed`
// resolves to undefined on a string and we incorrectly route the user into
// onboarding even though they finished it.
const JSON_MARKER = "__json__:";
function decodeMetaValue(v) {
  if (typeof v === "string" && v.startsWith(JSON_MARKER)) {
    try {
      return JSON.parse(v.slice(JSON_MARKER.length));
    } catch {
      return v;
    }
  }
  return v;
}
function decodeMeta(meta) {
  const out = {};
  for (const [k, v] of Object.entries(meta || {})) {
    out[k] = decodeMetaValue(v);
  }
  return out;
}

export function registerAuthRoutes(app) {
  /**
   * POST /auth/verify
   *
   * Client sends their Privy token, gets back their tenant profile.
   * Get-or-creates the user in Firestore.
   */
  app.post(
    "/auth/verify",
    {
      schema: {
        body: {
          type: "object",
          required: ["token"],
          properties: {
            token: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { token } = request.body;

      const claims = await verifySessionTokenAny(token);
      if (!claims) {
        return reply.code(401).send({ error: "Invalid or expired token" });
      }

      try {
        const user = await getUserByDid(claims.userId);
        if (!user) {
          return reply.code(404).send({ error: "user_not_found" });
        }

        const dbUser = await getOrCreateUser(claims.userId);
        const profile = await getProfile(claims.userId);
        const meta = decodeMeta(user.customMetadata || {});

        return {
          data: {
            id: user.id,
            dbUserId: dbUser?.id || claims.userId,
            displayName: profile?.displayName || meta.displayName || null,
            username: profile?.username || null,
            phoneNumber: meta.phoneNumber || user.phone?.number || null,
            loopSenderId: meta.loopSenderId || null,
            permissions: meta.permissions || {},
            onboarded:
              !!profile?.onboardingCompletedAt ||
              !!meta.onboardingProfile?.completed,
            profile: profile || null,
          },
        };
      } catch (err) {
        request.log.error(err, "Failed to verify auth");
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );

  /**
   * POST /auth/onboard
   *
   * Called after Privy signup. Sets the initial tenant metadata
   * and writes personality data to Firestore.
   *
   * Requires valid Privy Bearer token (via requireAuth preHandler).
   */
  app.post(
    "/auth/onboard",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["displayName"],
          properties: {
            displayName: { type: "string" },
            phoneNumber: { type: "string" },
            personality: { type: "object" },
            healthBaseline: { type: "object" },
          },
        },
      },
    },
    async (request, reply) => {
      const { displayName, phoneNumber, personality, healthBaseline } =
        request.body;
      const privyDid = request.privyUser.userId;

      try {
        const user = await getUserByDid(privyDid);
        if (!user) {
          return reply.code(404).send({ error: "User not found" });
        }

        const existing = decodeMeta(user.customMetadata || {});
        const metadata = {
          ...existing,
          displayName,
          phoneNumber:
            phoneNumber || existing.phoneNumber || user.phone?.number || null,
          onboardingProfile: {
            personality: personality || {},
            healthBaseline: healthBaseline || {},
            completed: true,
            completedAt: new Date().toISOString(),
          },
          permissions: existing.permissions || {
            tools: false,
            webSearch: true,
            healthTracking: true,
            memoryAccess: true,
            proactiveMessages: true,
            fullContext: true,
          },
        };


        // Make sure the Firestore user doc exists so subsequent /v1/auth/me
        // calls find a row.
        await getOrCreateUser(privyDid);

        if (personality) {
          const validTypes = [
            "horoscope",
            "myers_briggs",
            "enneagram",
            "big_five",
          ];
          for (const [type, result] of Object.entries(personality)) {
            if (!result) continue;
            if (!validTypes.includes(type)) continue;
            await insertPersonalityIfAbsent(privyDid, {
              profileType: type,
              result,
              derivedFrom: "onboarding",
              confidence: 100,
            });
          }
        }

        return {
          data: {
            id: privyDid,
            displayName,
            onboarded: true,
            message: "Onboarding complete",
          },
        };
      } catch (err) {
        request.log.error(err, "Failed to onboard user");
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );

  /**
   * GET /v1/auth/me
   *
   * Returns the full Firestore-backed profile for the authenticated user.
   */
  app.get(
    "/v1/auth/me",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const privyDid = request.privyUser?.userId;
      if (!privyDid) {
        return reply.code(401).send({ error: "no_user" });
      }

      const dbUser = await getUserByPrivyDid(privyDid);
      if (!dbUser) {
        return reply.code(404).send({
          error: "not_found",
          message: "User not found. Call /auth/verify first.",
        });
      }

      const profile = await getProfile(privyDid);
      const personalities = await listPersonalityProfiles(privyDid);

      return {
        data: {
          userId: dbUser.id || privyDid,
          privyUserId: privyDid,
          privacyTier:
            dbUser.privacy_tier || dbUser.privacyTier || "local_only",
          createdAt: dbUser.created_at || dbUser.createdAt || null,
          profile: profile || null,
          personalityProfiles: personalities,
        },
      };
    },
  );
}
