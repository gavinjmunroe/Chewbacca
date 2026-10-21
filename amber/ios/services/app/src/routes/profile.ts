import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { eq } from 'drizzle-orm';
import { authenticate, AuthenticatedRequest } from '../auth/middleware.js';
import { sha256Hex } from '../util/crypto.js';

const IMMUTABLE_FIELDS = ['birthday', 'almaMater', 'hometown', 'birthdayTime', 'birthLocation'];

const ProfileUpdateSchema = z.object({
  displayName: z.string().min(1).optional(),
  bio: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  currentCity: z.string().min(1).optional(),
  privacyTier: z.enum(['local_only', 'selective_cloud', 'full_social']).optional(),
});

export async function registerProfileRoutes(app: FastifyInstance) {
  /**
   * GET /profile
   * Returns authenticated user's full profile + personality profiles
   */
  app.get('/profile', { preHandler: authenticate }, async (req: AuthenticatedRequest, reply) => {
    const [profile] = await db
      .select()
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, req.userId!))
      .limit(1);

    if (!profile) {
      return reply.code(404).send({ error: 'not_found', message: 'Profile not found' });
    }

    const personalityProfiles = await db
      .select()
      .from(schema.personalityProfiles)
      .where(eq(schema.personalityProfiles.userId, req.userId!))
      .orderBy(schema.personalityProfiles.createdAt);

    return { ...profile, personalityProfiles };
  });

  /**
   * GET /profile/personality
   * Returns all personality profiles for authenticated user
   */
  app.get('/profile/personality', { preHandler: authenticate }, async (req: AuthenticatedRequest) => {
    return await db
      .select()
      .from(schema.personalityProfiles)
      .where(eq(schema.personalityProfiles.userId, req.userId!))
      .orderBy(schema.personalityProfiles.createdAt);
  });

  /**
   * PUT /profile
   * Update editable profile fields only
   */
  app.put('/profile', { preHandler: authenticate }, async (req: AuthenticatedRequest, reply) => {
    // Reject immutable fields
    const rawBody = req.body as Record<string, unknown>;
    const attempted = IMMUTABLE_FIELDS.filter((f) => f in rawBody);
    if (attempted.length > 0) {
      return reply.code(400).send({ error: 'immutable_fields', message: 'Cannot edit immutable fields after onboarding' });
    }

    const body = ProfileUpdateSchema.parse(req.body);

    const [existing] = await db
      .select()
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, req.userId!))
      .limit(1);

    if (!existing) {
      return reply.code(404).send({ error: 'not_found', message: 'Profile not found' });
    }

    // Build update
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (body.displayName !== undefined) update.displayName = body.displayName;
    if (body.bio !== undefined) update.bio = body.bio;
    if (body.avatarUrl !== undefined) update.avatarUrl = body.avatarUrl;
    if (body.currentCity !== undefined) update.currentCity = body.currentCity;
    if (body.privacyTier !== undefined) update.privacyTier = body.privacyTier;

    const [updatedProfile] = await db
      .update(schema.userProfiles)
      .set(update)
      .where(eq(schema.userProfiles.userId, req.userId!))
      .returning();

    // Regenerate content hash
    const contentHash = sha256Hex(JSON.stringify(updatedProfile));
    const [finalProfile] = await db
      .update(schema.userProfiles)
      .set({ contentHash })
      .where(eq(schema.userProfiles.userId, req.userId!))
      .returning();

    return finalProfile;
  });

  /**
   * GET /profile/:userId
   * Returns another user's profile filtered by their privacy tier
   */
  app.get<{ Params: { userId: string } }>(
    '/profile/:userId',
    { preHandler: authenticate },
    async (req: AuthenticatedRequest, reply) => {
      const targetUserId = Number((req.params as { userId: string }).userId);

      const [profile] = await db
        .select()
        .from(schema.userProfiles)
        .where(eq(schema.userProfiles.userId, targetUserId))
        .limit(1);

      if (!profile) {
        return reply.code(404).send({ error: 'not_found', message: 'User not found' });
      }

      switch (profile.privacyTier) {
        case 'local_only':
          return reply.code(404).send({ error: 'not_found', message: 'User not found' });

        case 'selective_cloud':
          return {
            displayName: profile.displayName,
            currentCity: profile.currentCity,
            avatarUrl: profile.avatarUrl,
          };

        case 'full_social': {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { birthdayTime, birthLocation, contentHash, ...publicProfile } = profile;
          return publicProfile;
        }

        default:
          return reply.code(404).send({ error: 'not_found', message: 'User not found' });
      }
    },
  );
}
