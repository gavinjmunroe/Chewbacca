import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runPipeline } from '../pipeline/engine.js';
import { db, schema } from '../db/client.js';
import { eq, and } from 'drizzle-orm';
import { authenticate, AuthenticatedRequest } from '../auth/middleware.js';

const NodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  config: z.record(z.any()).default({}),
});

const PipelineSchema = z.object({
  name: z.string(),
  nodes: z.array(NodeSchema),
  edges: z.array(z.tuple([z.string(), z.string()])),
  input: z.any().optional(),
});

export async function registerPipelineRoutes(app: FastifyInstance) {
  /**
   * POST /pipelines/run
   * Run a pipeline (for authenticated user)
   */
  app.post('/pipelines/run', { preHandler: authenticate }, async (req: AuthenticatedRequest) => {
    const body = PipelineSchema.parse(req.body);
    const { input, ...def } = body;
    
    // Save pipeline definition
    const [pipelineDef] = await db
      .insert(schema.pipelineDefs)
      .values({ userId: req.userId!, name: def.name, def: def as unknown })
      .returning();
    
    // Create run record
    const [run] = await db
      .insert(schema.pipelineRuns)
      .values({
        userId: req.userId!,
        defId: pipelineDef.id,
        status: 'running',
        log: [],
      })
      .returning();

    const logEntries: string[] = [];
    try {
      const result = await runPipeline(def, (entry) => logEntries.push(entry), input);
      await db
        .update(schema.pipelineRuns)
        .set({
          status: 'succeeded',
          log: logEntries,
          result: result as unknown,
          endedAt: new Date(),
        })
        .where(eq(schema.pipelineRuns.id, run.id));
      return { runId: String(run.id), status: 'succeeded', result };
    } catch (e: unknown) {
      logEntries.push(`error: ${e instanceof Error ? e.message : String(e)}`);
      await db
        .update(schema.pipelineRuns)
        .set({
          status: 'failed',
          log: logEntries,
          endedAt: new Date(),
        })
        .where(eq(schema.pipelineRuns.id, run.id));
      return { runId: String(run.id), status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * GET /pipelines/run/:id
   * Get pipeline run status (must belong to user)
   */
  app.get<{ Params: { id: string } }>(
    '/pipelines/run/:id',
    { preHandler: authenticate },
    async (req: AuthenticatedRequest, reply) => {
      const { id: idStr } = req.params as { id: string }; const id = Number(idStr);
      const [run] = await db
        .select()
        .from(schema.pipelineRuns)
        .where(and(eq(schema.pipelineRuns.id, id), eq(schema.pipelineRuns.userId, req.userId!)));
      if (!run) return reply.code(404).send({ error: 'not_found' });
      return {
        id: String(run.id),
        status: run.status,
        log: run.log || [],
        result: run.result,
      };
    },
  );
}



