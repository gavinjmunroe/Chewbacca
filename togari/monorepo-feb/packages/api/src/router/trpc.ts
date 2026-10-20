import { initTRPC, TRPCError } from '@trpc/server';
import { Context } from '../context';

/**
 * Initialize tRPC instance
 */
const t = initTRPC.context<Context>().create();

/**
 * Public procedure - no auth required
 */
export const publicProcedure = t.procedure;

/**
 * Protected procedure - requires authentication
 */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.userId || !ctx.organizationId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Not authenticated',
    });
  }

  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId,
      organizationId: ctx.organizationId,
    },
  });
});

/**
 * Router builder
 */
export const router = t.router;
