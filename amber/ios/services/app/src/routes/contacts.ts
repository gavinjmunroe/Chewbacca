import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { eq, or, and } from 'drizzle-orm';
import { authenticate, AuthenticatedRequest } from '../auth/middleware.js';

const PersonCreateSchema = z.object({
  name: z.string().min(1),
  dob: z.string().optional(),
  email: z.string().email().optional(),
  wallets: z
    .array(z.object({ chain: z.literal('solana'), address: z.string().min(20) }))
    .optional(),
  metadata: z.record(z.any()).optional(),
});

const RelationshipCreateSchema = z.object({
  fromId: z.string(),
  toId: z.string(),
  type: z.enum(['parent', 'sibling', 'partner', 'child', 'other']),
  strength: z.number().min(0).max(100).optional(),
});

const PersonUpdateSchema = PersonCreateSchema.partial();

export async function registerContactRoutes(app: FastifyInstance) {
  /**
   * GET /persons
   * List all persons for authenticated user
   */
  app.get('/persons', { preHandler: authenticate }, async (req: AuthenticatedRequest) => {
    return await db
      .select()
      .from(schema.persons)
      .where(eq(schema.persons.userId, req.userId!))
      .orderBy(schema.persons.createdAt);
  });

  /**
   * POST /persons
   * Create a new person (family member)
   */
  app.post('/persons', { preHandler: authenticate }, async (req: AuthenticatedRequest, reply) => {
    const body = PersonCreateSchema.parse(req.body);
    const [person] = await db
      .insert(schema.persons)
      .values({
        userId: req.userId!,
        name: body.name,
        dob: body.dob ? new Date(body.dob) : undefined,
        email: body.email,
        metadata: body.metadata,
      })
      .returning();
    // TODO: Mint cNFT on Solana
    reply.code(201);
    return person;
  });

  /**
   * GET /persons/:id
   * Get person by ID (must belong to user)
   */
  app.get<{ Params: { id: string } }>(
    '/persons/:id',
    { preHandler: authenticate },
    async (req: AuthenticatedRequest, reply) => {
      const { id: idStr } = req.params as { id: string }; const id = Number(idStr);
      const [person] = await db
        .select()
        .from(schema.persons)
        .where(and(eq(schema.persons.id, id), eq(schema.persons.userId, req.userId!)));
      if (!person) return reply.code(404).send({ error: 'not_found' });
      return person;
    },
  );

  /**
   * PUT /persons/:id
   * Update person (must belong to user)
   */
  app.put<{ Params: { id: string } }>(
    '/persons/:id',
    { preHandler: authenticate },
    async (req: AuthenticatedRequest, reply) => {
      const { id: idStr } = req.params as { id: string }; const id = Number(idStr);
      const update = PersonUpdateSchema.parse(req.body);
      const [person] = await db
        .update(schema.persons)
        .set({
          ...update,
          dob: update.dob ? new Date(update.dob) : undefined,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.persons.id, id), eq(schema.persons.userId, req.userId!)))
        .returning();
      if (!person) return reply.code(404).send({ error: 'not_found' });
      return person;
    },
  );

  /**
   * DELETE /persons/:id
   * Delete person (must belong to user)
   */
  app.delete<{ Params: { id: string } }>(
    '/persons/:id',
    { preHandler: authenticate },
    async (req: AuthenticatedRequest, reply) => {
      const { id: idStr } = req.params as { id: string }; const id = Number(idStr);
      const [person] = await db
        .delete(schema.persons)
        .where(and(eq(schema.persons.id, id), eq(schema.persons.userId, req.userId!)))
        .returning();
      if (!person) return reply.code(404).send({ error: 'not_found' });
      reply.code(204);
      return null as unknown as undefined;
    },
  );

  /**
   * GET /relationships
   * List all relationships for authenticated user
   */
  app.get('/relationships', { preHandler: authenticate }, async (req: AuthenticatedRequest) => {
    return await db
      .select()
      .from(schema.relationships)
      .where(eq(schema.relationships.userId, req.userId!))
      .orderBy(schema.relationships.createdAt);
  });

  /**
   * POST /relationships
   * Create relationship between two persons (must belong to user)
   */
  app.post('/relationships', { preHandler: authenticate }, async (req: AuthenticatedRequest, reply) => {
    const body = RelationshipCreateSchema.parse(req.body);
    const fromId = Number(body.fromId);
    const toId = Number(body.toId);

    // Verify both persons belong to user
    const [fromPerson] = await db
      .select()
      .from(schema.persons)
      .where(and(eq(schema.persons.id, fromId), eq(schema.persons.userId, req.userId!)))
      .limit(1);
    const [toPerson] = await db
      .select()
      .from(schema.persons)
      .where(and(eq(schema.persons.id, toId), eq(schema.persons.userId, req.userId!)))
      .limit(1);

    if (!fromPerson || !toPerson) {
      return reply.code(404).send({ error: 'not_found', message: 'One or both persons not found' });
    }

    const [rel] = await db
      .insert(schema.relationships)
      .values({
        userId: req.userId!,
        fromId,
        toId,
        type: body.type,
        strength: body.strength ?? 50,
      })
      .returning();
    reply.code(201);
    return rel;
  });

  /**
   * GET /relationships/:id
   * Get relationship by ID (must belong to user)
   */
  app.get<{ Params: { id: string } }>(
    '/relationships/:id',
    { preHandler: authenticate },
    async (req: AuthenticatedRequest, reply) => {
      const { id: idStr } = req.params as { id: string }; const id = Number(idStr);
      const [rel] = await db
        .select()
        .from(schema.relationships)
        .where(and(eq(schema.relationships.id, id), eq(schema.relationships.userId, req.userId!)));
      if (!rel) return reply.code(404).send({ error: 'not_found' });
      return rel;
    },
  );

  /**
   * GET /persons/:personId/relationships
   * Get all relationships for a person (must belong to user)
   */
  app.get<{ Params: { personId: string } }>(
    '/persons/:personId/relationships',
    { preHandler: authenticate },
    async (req: AuthenticatedRequest) => {
      const { personId: personIdStr } = req.params as { personId: string }; const personId = Number(personIdStr);
      
      // Verify person belongs to user
      const [person] = await db
        .select()
        .from(schema.persons)
        .where(and(eq(schema.persons.id, personId), eq(schema.persons.userId, req.userId!)))
        .limit(1);
      
      if (!person) return [];

      return await db
        .select()
        .from(schema.relationships)
        .where(
          and(
            eq(schema.relationships.userId, req.userId!),
            or(
              eq(schema.relationships.fromId, personId),
              eq(schema.relationships.toId, personId),
            ),
          ),
        );
    },
  );
}



