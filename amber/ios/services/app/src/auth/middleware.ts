import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyPrivyToken } from './privy.js';
import { db, schema } from '../db/client.js';
import { eq } from 'drizzle-orm';

export interface AuthenticatedRequest extends FastifyRequest {
  userId?: number;
  privyUserId?: string;
}

/**
 * Authentication middleware: verifies Privy token and loads user from DB
 * Attaches userId and privyUserId to request
 */
export async function authenticate(
  request: AuthenticatedRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'unauthorized', message: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const privyUser = await verifyPrivyToken(token);

    // Get or create user in our DB
    let [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.privyUserId, privyUser.id))
      .limit(1);

    if (!user) {
      [user] = await db
        .insert(schema.users)
        .values({ privyUserId: privyUser.id })
        .returning();
    }

    request.userId = user.id;
    request.privyUserId = privyUser.id;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid token';
    reply.code(401).send({ error: 'unauthorized', message });
    return;
  }
}

/**
 * Optional auth: sets userId if token is valid, but doesn't fail if missing
 */
export async function optionalAuth(
  request: AuthenticatedRequest,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return; // No auth, continue without userId
  }

  const token = authHeader.slice(7);
  try {
    const privyUser = await verifyPrivyToken(token);
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.privyUserId, privyUser.id))
      .limit(1);

    if (user) {
      request.userId = user.id;
      request.privyUserId = privyUser.id;
    }
  } catch {
    // Ignore errors for optional auth
  }
}
