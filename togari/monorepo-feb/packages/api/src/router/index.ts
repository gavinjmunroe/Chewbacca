import { router } from './trpc';
import { peopleRouter } from './people';
import { companiesRouter } from './companies';
import { campaignsRouter } from './campaigns';
import { aiRouter } from './ai';

/**
 * Main app router
 * Combines all feature routers
 */
export const appRouter = router({
  people: peopleRouter,
  companies: companiesRouter,
  campaigns: campaignsRouter,
  ai: aiRouter,
});

export type AppRouter = typeof appRouter;

// Re-export procedures for convenience
export { publicProcedure, protectedProcedure } from './trpc';
