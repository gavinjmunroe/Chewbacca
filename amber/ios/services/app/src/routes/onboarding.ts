import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { eq, and } from 'drizzle-orm';
import { authenticate, AuthenticatedRequest } from '../auth/middleware.js';
import { sha256Hex } from '../util/crypto.js';
import { deriveHoroscope } from '../util/horoscope.js';

const STEP_ORDER = ['welcome', 'basics', 'birthday', 'location', 'education', 'permissions', 'privacy_tier', 'complete'] as const;

const VALID_STEPS = ['basics', 'birthday', 'location', 'education', 'permissions', 'privacy_tier'] as const;

const stepSchemas = {
  basics: z.object({
    displayName: z.string().min(1),
    username: z.string().min(3).max(50),
  }),
  birthday: z.object({
    birthday: z.string(), // ISO date
    birthdayTime: z.string().optional(),
    birthLocation: z.string().optional(),
  }),
  location: z.object({
    hometown: z.string().optional(),
    currentCity: z.string().min(1),
  }),
  education: z.object({
    almaMater: z.string().optional(),
  }),
  permissions: z.object({
    contacts: z.boolean(),
    location: z.boolean(),
    healthKit: z.boolean(),
    calendar: z.boolean(),
  }),
  privacy_tier: z.object({
    tier: z.enum(['local_only', 'selective_cloud', 'full_social']),
  }),
} as const;

function getNextStep(current: string): (typeof STEP_ORDER)[number] {
  const idx = STEP_ORDER.indexOf(current as (typeof STEP_ORDER)[number]);
  return idx >= 0 && idx < STEP_ORDER.length - 1 ? STEP_ORDER[idx + 1] : 'complete';
}

export async function registerOnboardingRoutes(app: FastifyInstance) {
  /**
   * POST /onboarding/start
   * Creates onboarding progress record (or returns existing)
   */
  app.post('/onboarding/start', { preHandler: authenticate }, async (req: AuthenticatedRequest, reply) => {
    // Check for existing progress
    const [existing] = await db
      .select()
      .from(schema.onboardingProgress)
      .where(eq(schema.onboardingProgress.userId, req.userId!))
      .limit(1);

    if (existing) {
      return { progressId: existing.id, currentStep: existing.currentStep, stepsCompleted: existing.stepsCompleted };
    }

    const [progress] = await db
      .insert(schema.onboardingProgress)
      .values({ userId: req.userId!, currentStep: 'welcome', stepsCompleted: {} })
      .returning();

    reply.code(201);
    return { progressId: progress.id, currentStep: progress.currentStep, stepsCompleted: progress.stepsCompleted };
  });

  /**
   * PUT /onboarding/step/:stepName
   * Update a specific onboarding step with validated data
   */
  app.put<{ Params: { stepName: string } }>(
    '/onboarding/step/:stepName',
    { preHandler: authenticate },
    async (req: AuthenticatedRequest, reply) => {
      const { stepName } = req.params as { stepName: string };

      if (!VALID_STEPS.includes(stepName as (typeof VALID_STEPS)[number])) {
        return reply.code(400).send({ error: 'invalid_step', message: `Invalid step: ${stepName}` });
      }

      const stepSchema = stepSchemas[stepName as keyof typeof stepSchemas];
      const body = stepSchema.parse(req.body);

      // Get or create onboarding progress
      let [progress] = await db
        .select()
        .from(schema.onboardingProgress)
        .where(eq(schema.onboardingProgress.userId, req.userId!))
        .limit(1);

      if (!progress) {
        [progress] = await db
          .insert(schema.onboardingProgress)
          .values({ userId: req.userId!, currentStep: 'welcome', stepsCompleted: {} })
          .returning();
      }

      const nextStep = getNextStep(stepName);
      const stepsCompleted = { ...(progress.stepsCompleted as Record<string, string>), [stepName]: new Date().toISOString() };

      // Update progress
      [progress] = await db
        .update(schema.onboardingProgress)
        .set({ currentStep: nextStep, stepsCompleted, updatedAt: new Date() })
        .where(eq(schema.onboardingProgress.id, progress.id))
        .returning();

      // Build profile update values based on step
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let profileUpdate: Record<string, any> = {};
      switch (stepName) {
        case 'basics': {
          const b = body as z.infer<typeof stepSchemas.basics>;
          profileUpdate = { displayName: b.displayName, username: b.username };
          break;
        }
        case 'birthday': {
          const b = body as z.infer<typeof stepSchemas.birthday>;
          profileUpdate = { birthday: new Date(b.birthday), birthdayTime: b.birthdayTime, birthLocation: b.birthLocation };
          break;
        }
        case 'location': {
          const l = body as z.infer<typeof stepSchemas.location>;
          profileUpdate = { hometown: l.hometown, currentCity: l.currentCity };
          break;
        }
        case 'education':
          profileUpdate = { almaMater: (body as z.infer<typeof stepSchemas.education>).almaMater };
          break;
        case 'permissions':
          // Permissions are stored as metadata but don't map to profile columns directly
          // Store as-is for the app layer to consume
          break;
        case 'privacy_tier':
          profileUpdate = { privacyTier: (body as z.infer<typeof stepSchemas.privacy_tier>).tier };
          break;
      }

      // Upsert user profile
      if (Object.keys(profileUpdate).length > 0) {
        const [existingProfile] = await db
          .select()
          .from(schema.userProfiles)
          .where(eq(schema.userProfiles.userId, req.userId!))
          .limit(1);

        if (existingProfile) {
          await db
            .update(schema.userProfiles)
            .set({ ...profileUpdate, updatedAt: new Date() })
            .where(eq(schema.userProfiles.userId, req.userId!));
        } else {
          // For initial insert, birthday is required by the schema — use a placeholder if not this step
          const insertValues = {
            userId: req.userId!,
            birthday: profileUpdate.birthday ?? new Date(0),
            ...profileUpdate,
          };
          await db.insert(schema.userProfiles).values(insertValues);
        }
      }

      // Auto-derive horoscope for birthday step
      if (stepName === 'birthday') {
        const b = body as z.infer<typeof stepSchemas.birthday>;
        const horoscope = deriveHoroscope(b.birthday);

        const [existingHoroscope] = await db
          .select()
          .from(schema.personalityProfiles)
          .where(and(
            eq(schema.personalityProfiles.userId, req.userId!),
            eq(schema.personalityProfiles.profileType, 'horoscope'),
          ))
          .limit(1);

        if (existingHoroscope) {
          await db
            .update(schema.personalityProfiles)
            .set({ result: horoscope, derivedFrom: 'birthday', confidence: 100, updatedAt: new Date() })
            .where(eq(schema.personalityProfiles.id, existingHoroscope.id));
        } else {
          await db
            .insert(schema.personalityProfiles)
            .values({
              userId: req.userId!,
              profileType: 'horoscope',
              result: horoscope,
              derivedFrom: 'birthday',
              confidence: 100,
            });
        }
      }

      // Fetch current profile to return
      const [profile] = await db
        .select()
        .from(schema.userProfiles)
        .where(eq(schema.userProfiles.userId, req.userId!))
        .limit(1);

      return { currentStep: progress.currentStep, stepsCompleted: progress.stepsCompleted, profile: profile ?? null };
    },
  );

  /**
   * POST /onboarding/complete
   * Validates required steps and finalizes onboarding
   */
  app.post('/onboarding/complete', { preHandler: authenticate }, async (req: AuthenticatedRequest, reply) => {
    const [progress] = await db
      .select()
      .from(schema.onboardingProgress)
      .where(eq(schema.onboardingProgress.userId, req.userId!))
      .limit(1);

    if (!progress) {
      return reply.code(400).send({ error: 'not_started', message: 'Onboarding has not been started' });
    }

    const completed = progress.stepsCompleted as Record<string, string>;
    const requiredSteps = ['basics', 'birthday'];
    const missing = requiredSteps.filter((s) => !completed[s]);

    if (missing.length > 0) {
      return reply.code(400).send({ error: 'incomplete', message: `Required steps not completed: ${missing.join(', ')}` });
    }

    const [profile] = await db
      .select()
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, req.userId!))
      .limit(1);

    if (!profile) {
      return reply.code(400).send({ error: 'no_profile', message: 'User profile not found' });
    }

    // Generate content hash for blockchain anchoring
    const contentHash = sha256Hex(JSON.stringify(profile));

    const [updatedProfile] = await db
      .update(schema.userProfiles)
      .set({ onboardingCompletedAt: new Date(), contentHash, updatedAt: new Date() })
      .where(eq(schema.userProfiles.userId, req.userId!))
      .returning();

    // Mark progress as complete
    await db
      .update(schema.onboardingProgress)
      .set({ currentStep: 'complete', updatedAt: new Date() })
      .where(eq(schema.onboardingProgress.id, progress.id));

    return updatedProfile;
  });

  /**
   * GET /onboarding/status
   * Returns current onboarding progress and partial profile
   */
  app.get('/onboarding/status', { preHandler: authenticate }, async (req: AuthenticatedRequest) => {
    const [progress] = await db
      .select()
      .from(schema.onboardingProgress)
      .where(eq(schema.onboardingProgress.userId, req.userId!))
      .limit(1);

    const [profile] = await db
      .select()
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, req.userId!))
      .limit(1);

    return {
      progress: progress ?? null,
      profile: profile ?? null,
    };
  });
}
