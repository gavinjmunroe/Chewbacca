import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sha256Hex } from '../util/crypto.js';
import { db, schema } from '../db/client.js';
import { eq } from 'drizzle-orm';
import { authenticate, AuthenticatedRequest } from '../auth/middleware.js';

const AnchorBody = z.object({ uri: z.string().url(), kind: z.enum(['graph', 'pipeline', 'vc']).optional() });

/**
 * Anchor routes: blockchain anchoring for graph state
 */
export async function registerAnchorRoutes(app: FastifyInstance) {
  /**
   * POST /anchor/create
   * Create on-chain anchor (for authenticated user)
   */
  app.post('/anchor/create', { preHandler: authenticate }, async (req: AuthenticatedRequest) => {
    const { uri, kind } = AnchorBody.parse(req.body);
    const hash = sha256Hex(uri);
    
    // Store anchor record
    const [anchor] = await db
      .insert(schema.anchors)
      .values({
        userId: req.userId!,
        kind: kind || 'graph',
        contentHash: hash,
        uri,
      })
      .returning();
    
    // TODO: call Solana client to write anchor on-chain
    return { id: anchor.id, hash, uri, tx: null };
  });

  /**
   * GET /anchor/list
   * List anchors for authenticated user
   */
  app.get('/anchor/list', { preHandler: authenticate }, async (req: AuthenticatedRequest) => {
    return await db
      .select()
      .from(schema.anchors)
      .where(eq(schema.anchors.userId, req.userId!))
      .orderBy(schema.anchors.createdAt);
  });
}



