import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { eq, and } from 'drizzle-orm';
import { authenticate, AuthenticatedRequest } from '../auth/middleware.js';

const InsightCreateSchema = z.object({
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  topic: z.enum(['health', 'connection', 'memory']),
  content: z.string().min(1),
  sources: z.array(z.string()).default([]),
});

export async function registerInsightRoutes(app: FastifyInstance) {
  /**
   * GET /insights
   * List insights for authenticated user (filtered by priority/topic)
   */
  app.get('/insights', { preHandler: authenticate }, async (req: AuthenticatedRequest) => {
    const { priority, topic } = req.query as { priority?: string; topic?: string };
    const conditions = [eq(schema.insights.userId, req.userId!)];
    
    if (priority) conditions.push(eq(schema.insights.priority, priority as typeof schema.insights.priority.enumValues[number]));
    if (topic) conditions.push(eq(schema.insights.topic, topic as typeof schema.insights.topic.enumValues[number]));
    
    return await db
      .select()
      .from(schema.insights)
      .where(and(...conditions))
      .orderBy(schema.insights.createdAt);
  });

  /**
   * POST /insights
   * Create insight (for authenticated user)
   */
  app.post('/insights', { preHandler: authenticate }, async (req: AuthenticatedRequest, reply) => {
    const body = InsightCreateSchema.parse(req.body);
    const [insight] = await db
      .insert(schema.insights)
      .values({
        userId: req.userId!,
        priority: body.priority,
        topic: body.topic,
        content: body.content,
        sources: body.sources,
      })
      .returning();
    reply.code(201);
    return insight;
  });

  /**
   * GET /insights/:id
   * Get insight by ID (must belong to user)
   */
  app.get<{ Params: { id: string } }>(
    '/insights/:id',
    { preHandler: authenticate },
    async (req: AuthenticatedRequest, reply) => {
      const { id: idStr } = req.params as { id: string }; const id = Number(idStr);
      const [insight] = await db
        .select()
        .from(schema.insights)
        .where(and(eq(schema.insights.id, id), eq(schema.insights.userId, req.userId!)));
      if (!insight) return reply.code(404).send({ error: 'not_found' });
      return insight;
    },
  );

  /**
   * POST /insights/generate
   * Generate AI insights from graph context (for authenticated user)
   */
  app.post('/insights/generate', { preHandler: authenticate }, async (req: AuthenticatedRequest, reply) => {
    // TODO: Call LLM with graph context, calendar, weather to generate insights
    const [insight] = await db
      .insert(schema.insights)
      .values({
        userId: req.userId!,
        priority: 'medium',
        topic: 'health',
        content: "Dad mentioned knee pain 3 weeks ago. Weather is rainy today; ask him how his joints feel.",
        sources: ['Last chat 3 days ago', 'HealthKit trend'],
      })
      .returning();
    reply.code(201);
    return insight;
  });
}

