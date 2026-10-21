/**
 * Onboarding routes — Firestore-backed (DID-keyed).
 *
 * POST /v1/onboarding/start
 * PUT  /v1/onboarding/step/:stepName
 * POST /v1/onboarding/complete
 * GET  /v1/onboarding/status
 *
 * All routes operate on the authenticated user's own data — the Privy DID
 * comes from the verified Bearer token; foreign user IDs cannot appear in
 * the URL. Cross-user writes are not possible here.
 */

import { requireAuth } from "../lib/auth-session.js";
import {
  getOrCreateUser,
  getProfile,
  upsertProfile,
  getOnboardingProgress,
  upsertOnboardingProgress,
  upsertPersonalityProfile,
} from "../db/user-store.js";
import { deriveHoroscope } from "../util/horoscope.js";
import { createHash } from "crypto";

const STEP_ORDER = [
  "welcome",
  "basics",
  "birthday",
  "location",
  "education",
  "permissions",
  "privacy_tier",
  "check_in_schedule",
  "complete",
];

const VALID_STEPS = [
  "basics",
  "birthday",
  "location",
  "education",
  "permissions",
  "privacy_tier",
  "check_in_schedule",
];

function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

function getNextStep(current) {
  const idx = STEP_ORDER.indexOf(current);
  return idx >= 0 && idx < STEP_ORDER.length - 1
    ? STEP_ORDER[idx + 1]
    : "complete";
}

function requirePrivyDid(request, reply) {
  const privyDid = request.privyUser?.userId;
  if (!privyDid) {
    reply.code(401).send({ error: "no_user", message: "Auth required" });
    return null;
  }
  return privyDid;
}

export function registerOnboardingRoutes(app) {
  /**
   * POST /v1/onboarding/start
   */
  app.post(
    "/v1/onboarding/start",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const privyDid = requirePrivyDid(request, reply);
      if (!privyDid) return;
      await getOrCreateUser(privyDid);

      const existing = await getOnboardingProgress(privyDid);
      if (existing) {
        return {
          progressId: privyDid,
          currentStep: existing.currentStep,
          stepsCompleted: existing.stepsCompleted || {},
        };
      }

      const progress = await upsertOnboardingProgress(privyDid, {
        currentStep: "welcome",
        stepsCompleted: {},
      });
      reply.code(201);
      return {
        progressId: privyDid,
        currentStep: progress.currentStep,
        stepsCompleted: progress.stepsCompleted || {},
      };
    },
  );

  /**
   * PUT /v1/onboarding/step/:stepName
   */
  app.put(
    "/v1/onboarding/step/:stepName",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const privyDid = requirePrivyDid(request, reply);
      if (!privyDid) return;
      await getOrCreateUser(privyDid);

      const { stepName } = request.params;
      if (!VALID_STEPS.includes(stepName)) {
        return reply.code(400).send({
          error: "invalid_step",
          message: `Invalid step: ${stepName}`,
        });
      }

      const body = request.body || {};

      let progress = await getOnboardingProgress(privyDid);
      if (!progress) {
        progress = await upsertOnboardingProgress(privyDid, {
          currentStep: "welcome",
          stepsCompleted: {},
        });
      }

      const nextStep = getNextStep(stepName);
      const stepsCompleted = {
        ...(progress.stepsCompleted || {}),
        [stepName]: new Date().toISOString(),
      };
      progress = await upsertOnboardingProgress(privyDid, {
        currentStep: nextStep,
        stepsCompleted,
      });

      // Build profile update for this step
      const profileUpdate = {};
      switch (stepName) {
        case "basics":
          if (body.displayName) profileUpdate.displayName = body.displayName;
          if (body.username) profileUpdate.username = body.username;
          break;
        case "birthday":
          if (body.birthday) profileUpdate.birthday = new Date(body.birthday);
          if (body.birthdayTime) profileUpdate.birthdayTime = body.birthdayTime;
          if (body.birthLocation)
            profileUpdate.birthLocation = body.birthLocation;
          break;
        case "location":
          if (body.hometown) profileUpdate.hometown = body.hometown;
          if (body.currentCity) profileUpdate.currentCity = body.currentCity;
          break;
        case "education":
          if (body.almaMater !== undefined)
            profileUpdate.almaMater = body.almaMater;
          break;
        case "permissions":
          break;
        case "privacy_tier":
          if (body.tier) profileUpdate.privacyTier = body.tier;
          break;
        case "check_in_schedule":
          // Optional step; default OFF so onboarding never opts a new user
          // into proactive check-ins without explicit intent. Tenant
          // metadata is the source of truth for the scheduler — the seed
          // script or /tenants/:did/metadata writes the live copy.
          if (body.schedule) profileUpdate.checkInSchedule = body.schedule;
          break;
      }

      if (Object.keys(profileUpdate).length > 0) {
        await upsertProfile(privyDid, profileUpdate);
      }

      // Auto-derive horoscope at birthday step
      if (stepName === "birthday" && body.birthday) {
        const horoscope = deriveHoroscope(body.birthday);
        await upsertPersonalityProfile(privyDid, {
          profileType: "horoscope",
          result: horoscope,
          derivedFrom: "birthday",
          confidence: 100,
        });
      }

      const profile = await getProfile(privyDid);
      return {
        currentStep: progress.currentStep,
        stepsCompleted: progress.stepsCompleted || {},
        profile: profile || null,
      };
    },
  );

  /**
   * POST /v1/onboarding/complete
   */
  app.post(
    "/v1/onboarding/complete",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const privyDid = requirePrivyDid(request, reply);
      if (!privyDid) return;

      const progress = await getOnboardingProgress(privyDid);
      if (!progress) {
        return reply.code(400).send({
          error: "not_started",
          message: "Onboarding has not been started",
        });
      }

      const completed = progress.stepsCompleted || {};
      const requiredSteps = ["basics", "birthday"];
      const missing = requiredSteps.filter((s) => !completed[s]);
      if (missing.length > 0) {
        return reply.code(400).send({
          error: "incomplete",
          message: `Required steps not completed: ${missing.join(", ")}`,
        });
      }

      const profile = await getProfile(privyDid);
      if (!profile) {
        return reply
          .code(400)
          .send({ error: "no_profile", message: "User profile not found" });
      }

      const contentHash = sha256Hex(JSON.stringify(profile));
      const updatedProfile = await upsertProfile(privyDid, {
        onboardingCompletedAt: new Date(),
        contentHash,
      });

      await upsertOnboardingProgress(privyDid, { currentStep: "complete" });
      return updatedProfile;
    },
  );

  /**
   * GET /v1/onboarding/status
   */
  app.get(
    "/v1/onboarding/status",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const privyDid = requirePrivyDid(request, reply);
      if (!privyDid) return;

      const progress = await getOnboardingProgress(privyDid);
      const profile = await getProfile(privyDid);
      return {
        progress: progress ?? null,
        profile: profile ?? null,
      };
    },
  );
}
