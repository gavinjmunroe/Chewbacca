import { z } from 'zod';
import { createPersonSchema, updatePersonSchema, createLogger } from '@togari/core';
import { router, protectedProcedure } from './trpc';
import { buildSafeURL } from '../utils/urlBuilder';
import { PAGINATION } from '../config/constants';

const logger = createLogger('PeopleRouter');

/**
 * People Router
 * Simple CRUD operations - delegates to Structify
 * NO scoring logic here - that's handled by Clay/n8n
 */
export const peopleRouter = router({
  /**
   * List people for the organization
   */
  list: protectedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        vertical: z.string().optional(),
        limit: z.number().min(PAGINATION.MIN_LIMIT).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
        offset: z.number().min(PAGINATION.MIN_OFFSET).default(PAGINATION.MIN_OFFSET),
      })
    )
    .query(async ({ ctx, input }) => {
      const filters = [];

      if (input.status) {
        filters.push({ field: 'currentStatus', operator: 'eq' as const, value: input.status });
      }

      if (input.vertical) {
        filters.push({ field: 'vertical', operator: 'eq' as const, value: input.vertical });
      }

      const people = await ctx.structify.listPeople(ctx.organizationId, {
        filters,
        limit: input.limit,
        offset: input.offset,
        orderBy: 'createdAt',
        orderDirection: 'desc',
      });

      return people;
    }),

  /**
   * Get single person by ID
   */
  get: protectedProcedure
    .input(z.object({ personId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.structify.getPerson(input.personId, ctx.organizationId);
    }),

  /**
   * Create a new person
   * Just saves to Structify - enrichment triggered externally
   */
  create: protectedProcedure
    .input(createPersonSchema.omit({ organizationId: true }))
    .mutation(async ({ ctx, input }) => {
      // Check for duplicate
      const existing = await ctx.structify.findPersonByLinkedIn(
        input.linkedinUrl,
        ctx.organizationId
      );

      if (existing) {
        return {
          person: existing,
          isNew: false,
          message: 'Person already exists',
        };
      }

      // Create new person with proper typing
      const person = await ctx.structify.createPerson({
        ...input,
        organizationId: ctx.organizationId,
        currentStatus: 'new' as const,
        totalTouches: 0,
        internalScore: 0,
        externalScore: 0,
        compositeScore: 0,
        routingTier: 'nurture' as const,
        createdBy: ctx.userId,
      });

      // Trigger n8n enrichment workflow (non-blocking)
      await triggerEnrichmentWorkflow(person.personId, ctx.organizationId);

      return {
        person,
        isNew: true,
        message: 'Person created successfully',
      };
    }),

  /**
   * Update person
   * Used to manually update fields or receive updates from webhooks
   */
  update: protectedProcedure
    .input(updatePersonSchema.omit({ organizationId: true }))
    .mutation(async ({ ctx, input }) => {
      const { personId, ...updates } = input;

      return ctx.structify.updatePerson(personId, {
        ...updates,
        updatedAt: new Date(),
      });
    }),

  /**
   * Delete person
   */
  delete: protectedProcedure
    .input(z.object({ personId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.structify.deletePerson(input.personId);
      return { success: true };
    }),

  /**
   * Get touchpoints for a person
   */
  touchpoints: protectedProcedure
    .input(z.object({ personId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.structify.listTouchpointsByPerson(input.personId, ctx.organizationId);
    }),
});

/**
 * Trigger n8n enrichment workflow for a person
 */
async function triggerEnrichmentWorkflow(personId: string, organizationId: string): Promise<void> {
  if (!process.env.N8N_BASE_URL) {
    logger.warn('N8N_BASE_URL not configured, skipping enrichment workflow');
    return;
  }

  try {
    // Build URL safely to prevent SSRF and injection attacks
    const url = buildSafeURL(process.env.N8N_BASE_URL, 'webhook', 'lead-enrichment');

    await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ personId, organizationId }),
    });
    logger.info('Triggered enrichment workflow', { personId, organizationId });
  } catch (error) {
    logger.error(
      'Failed to trigger enrichment workflow',
      error instanceof Error ? error : new Error(String(error)),
      { personId, organizationId }
    );
    // Don't throw - enrichment failure shouldn't fail the person creation
  }
}
