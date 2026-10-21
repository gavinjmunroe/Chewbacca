import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sha256Hex } from '../util/crypto.js';
import { putJsonObject } from '../util/storage.js';
import { db, schema } from '../db/client.js';
import { eq } from 'drizzle-orm';
import { authenticate, AuthenticatedRequest } from '../auth/middleware.js';

const WebhookSchema = z.object({
  provider: z.enum(['persona', 'stripe']).default('persona'),
  verification: z.object({ id: z.string(), status: z.string(), payload: z.record(z.any()).optional() }),
  userId: z.string().optional(),
});

/**
 * Identity routes: verifiable credentials and identity verification
 */
export async function registerIdentityRoutes(app: FastifyInstance) {
  /**
   * POST /identity/vc/issue
   * Issue verifiable credential (for authenticated user)
   */
  app.post('/identity/vc/issue', { preHandler: authenticate }, async (req: AuthenticatedRequest, reply) => {
    const body = WebhookSchema.parse(req.body);
    
    // Transform provider payload into VC format
    const vc = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', 'GovernmentIDVerification'],
      issuer: body.provider,
      credentialSubject: { verificationId: body.verification.id, status: body.verification.status },
      issuedAt: new Date().toISOString(),
    };
    
    const hash = sha256Hex(JSON.stringify(vc));
    const { uri } = await putJsonObject({
      obj: vc,
      key: `vc/${hash}.json`,
      localDir: '.data',
    });
    
    // Store VC record in DB
    const [vcRecord] = await db
      .insert(schema.vcRecords)
      .values({
        userId: req.userId!,
        issuer: body.provider,
        contentHash: hash,
        s3Uri: uri,
        status: 'active',
      })
      .returning();
    
    reply.code(201);
    return { id: vcRecord.id, hash, uri };
  });

  /**
   * GET /identity/vc
   * List VCs for authenticated user
   */
  app.get('/identity/vc', { preHandler: authenticate }, async (req: AuthenticatedRequest) => {
    return await db
      .select()
      .from(schema.vcRecords)
      .where(eq(schema.vcRecords.userId, req.userId!))
      .orderBy(schema.vcRecords.issuedAt);
  });
}



