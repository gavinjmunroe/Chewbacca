/**
 * SOCIAL-01: Circle data model & basic feed
 *
 * Circles are lightweight groups. For Sprint 1 they're a grouping mechanism only.
 * Full signal matching across circles is Sprint 2.
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { eq, and, inArray } from 'drizzle-orm';
import { authenticate, AuthenticatedRequest } from '../auth/middleware.js';
import { randomBytes } from 'crypto';

const CircleCreateSchema = z.object({
  name: z.string().min(1).max(255),
  visibility: z.enum(['private', 'members', 'public']).default('private'),
});

function generateInviteToken(): string {
  return randomBytes(24).toString('hex');
}

export async function registerCircleRoutes(app: FastifyInstance) {
  /**
   * GET /circles
   * List circles the authenticated user belongs to
   */
  app.get('/circles', { preHandler: authenticate }, async (req: AuthenticatedRequest) => {
    const memberships = await db
      .select({ circleId: schema.circleMembers.circleId })
      .from(schema.circleMembers)
      .where(eq(schema.circleMembers.userId, req.userId!));

    if (memberships.length === 0) return [];

    const ids = memberships.map((m) => m.circleId);
    return db.select().from(schema.circles).where(inArray(schema.circles.id, ids));
  });

  /**
   * POST /circles
   * Create a circle. Creator is automatically added as a member.
   */
  app.post('/circles', { preHandler: authenticate }, async (req: AuthenticatedRequest, reply) => {
    const body = CircleCreateSchema.parse(req.body);
    const inviteToken = generateInviteToken();

    const [circle] = await db
      .insert(schema.circles)
      .values({
        ownerId: req.userId!,
        createdByUserId: req.userId!,
        name: body.name,
        visibility: body.visibility,
        inviteToken,
      })
      .returning();

    // Auto-add creator as member
    await db.insert(schema.circleMembers).values({
      circleId: circle.id,
      userId: req.userId!,
    });

    reply.code(201);
    return {
      ...circle,
      shareLink: `https://amber.app/join/${inviteToken}`,
    };
  });

  /**
   * GET /circles/:id
   * Get circle details + member count
   */
  app.get<{ Params: { id: string } }>(
    '/circles/:id',
    { preHandler: authenticate },
    async (req: AuthenticatedRequest, reply) => {
      const { id: idStr } = req.params as { id: string }; const id = Number(idStr);

      // Verify user is a member
      const [membership] = await db
        .select()
        .from(schema.circleMembers)
        .where(and(eq(schema.circleMembers.circleId, id), eq(schema.circleMembers.userId, req.userId!)))
        .limit(1);

      if (!membership) return reply.code(403).send({ error: 'not_a_member' });

      const [circle] = await db
        .select()
        .from(schema.circles)
        .where(eq(schema.circles.id, id))
        .limit(1);

      if (!circle) return reply.code(404).send({ error: 'not_found' });

      const members = await db
        .select()
        .from(schema.circleMembers)
        .where(eq(schema.circleMembers.circleId, id));

      return {
        ...circle,
        memberCount: members.length,
        shareLink: `https://amber.app/join/${circle.inviteToken}`,
      };
    },
  );

  /**
   * POST /circles/join/:token
   * Join a circle via invite token (from iMessage share link)
   */
  app.post<{ Params: { token: string } }>(
    '/circles/join/:token',
    { preHandler: authenticate },
    async (req: AuthenticatedRequest, reply) => {
      const { token } = req.params as { token: string };

      const [circle] = await db
        .select()
        .from(schema.circles)
        .where(eq(schema.circles.inviteToken, token))
        .limit(1);

      if (!circle) return reply.code(404).send({ error: 'invalid_invite' });

      // Idempotent — already a member is fine
      await db
        .insert(schema.circleMembers)
        .values({ circleId: circle.id, userId: req.userId! })
        .onConflictDoNothing();

      return { circleId: circle.id, name: circle.name };
    },
  );

  /**
   * DELETE /circles/:id
   * Delete a circle (creator only)
   */
  app.delete<{ Params: { id: string } }>(
    '/circles/:id',
    { preHandler: authenticate },
    async (req: AuthenticatedRequest, reply) => {
      const { id: idStr } = req.params as { id: string }; const id = Number(idStr);

      const [circle] = await db
        .select()
        .from(schema.circles)
        .where(and(eq(schema.circles.id, id), eq(schema.circles.createdByUserId, req.userId!)))
        .limit(1);

      if (!circle) return reply.code(403).send({ error: 'forbidden' });

      await db.delete(schema.circleMembers).where(eq(schema.circleMembers.circleId, id));
      await db.delete(schema.circles).where(eq(schema.circles.id, id));

      reply.code(204);
      return null as unknown as undefined;
    },
  );

  /**
   * GET /circles/:id/members
   * List members of a circle (must be a member yourself)
   */
  app.get<{ Params: { id: string } }>(
    '/circles/:id/members',
    { preHandler: authenticate },
    async (req: AuthenticatedRequest, reply) => {
      const { id: idStr } = req.params as { id: string }; const id = Number(idStr);

      const [membership] = await db
        .select()
        .from(schema.circleMembers)
        .where(and(eq(schema.circleMembers.circleId, id), eq(schema.circleMembers.userId, req.userId!)))
        .limit(1);

      if (!membership) return reply.code(403).send({ error: 'not_a_member' });

      return db.select().from(schema.circleMembers).where(eq(schema.circleMembers.circleId, id));
    },
  );
}
