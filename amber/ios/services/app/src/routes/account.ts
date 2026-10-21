/**
 * Account lifecycle routes — required by App Store data-deletion guidelines
 * and matches the iOS client contract in
 * AmberApp/AmberApp/Services/Live/LiveServices.swift (`/api/account/delete`).
 *
 * The iOS client posts an empty body and expects 2xx. We hard-delete the
 * authenticated user's row (other tables fan out via FK ON DELETE CASCADE
 * once the cascade migration runs). For pre-cascade DBs the explicit
 * cleanup below keeps deletion idempotent.
 */
import { FastifyInstance } from 'fastify';
import { db, schema } from '../db/client.js';
import { eq } from 'drizzle-orm';
import { authenticate, AuthenticatedRequest } from '../auth/middleware.js';

export async function registerAccountRoutes(app: FastifyInstance) {
  app.post(
    '/api/account/delete',
    { preHandler: authenticate },
    async (req: AuthenticatedRequest, reply) => {
      const userId = req.userId!;

      // Order matters until FK cascades are applied across the board: delete
      // child rows that reference users (and persons) before the user.
      try {
        await db.delete(schema.permissionAuditLog).where(eq(schema.permissionAuditLog.userId, userId));
        await db.delete(schema.userPermissions).where(eq(schema.userPermissions.userId, userId));
        await db.delete(schema.contacts).where(eq(schema.contacts.userId, userId));
        await db.delete(schema.notifications).where(eq(schema.notifications.userId, userId));
        await db.delete(schema.deviceTokens).where(eq(schema.deviceTokens.userId, userId));
        await db.delete(schema.circleMembers).where(eq(schema.circleMembers.userId, userId));
        await db.delete(schema.circles).where(eq(schema.circles.ownerId, userId));
        await db.delete(schema.signals).where(eq(schema.signals.sourceUserId, userId));
        await db.delete(schema.relationships).where(eq(schema.relationships.userId, userId));
        await db.delete(schema.persons).where(eq(schema.persons.userId, userId));
        await db.delete(schema.pipelineRuns).where(eq(schema.pipelineRuns.userId, userId));
        await db.delete(schema.pipelineDefs).where(eq(schema.pipelineDefs.userId, userId));
        await db.delete(schema.insights).where(eq(schema.insights.userId, userId));
        await db.delete(schema.vcRecords).where(eq(schema.vcRecords.userId, userId));
        await db.delete(schema.anchors).where(eq(schema.anchors.userId, userId));
        await db.delete(schema.userProfiles).where(eq(schema.userProfiles.userId, userId));
        await db.delete(schema.onboardingProgress).where(eq(schema.onboardingProgress.userId, userId));
        await db.delete(schema.personalityProfiles).where(eq(schema.personalityProfiles.userId, userId));
        await db.delete(schema.users).where(eq(schema.users.id, userId));
      } catch (error) {
        req.log.error({ err: error, userId }, 'account deletion failed');
        return reply.code(500).send({ error: 'deletion_failed', message: 'Account deletion partially failed; contact support.' });
      }

      reply.code(204);
      return null as unknown as undefined;
    },
  );
}
