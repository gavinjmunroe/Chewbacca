import { z } from 'zod';
import { createCampaignSchema } from '@togari/core';
import { router, protectedProcedure } from './trpc';

/**
 * Campaigns Router
 * Basic campaign CRUD - sequences handled in Clay/Instantly
 */
export const campaignsRouter = router({
  /**
   * List campaigns
   */
  list: protectedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        limit: z.number().default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const filters = input.status
        ? [{ field: 'status', operator: 'eq' as const, value: input.status }]
        : [];

      return ctx.structify.listCampaigns(ctx.organizationId, {
        filters,
        limit: input.limit,
        orderBy: 'createdAt',
        orderDirection: 'desc',
      });
    }),

  /**
   * Get campaign
   */
  get: protectedProcedure
    .input(z.object({ campaignId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.structify.getCampaign(input.campaignId, ctx.organizationId);
    }),

  /**
   * Create campaign
   */
  create: protectedProcedure
    .input(createCampaignSchema.omit({ organizationId: true }))
    .mutation(async ({ ctx, input }) => {
      return ctx.structify.createCampaign({
        ...input,
        organizationId: ctx.organizationId,
        status: 'draft' as const,
        totalLeads: 0,
        emailsSent: 0,
        emailsOpened: 0,
        emailsReplied: 0,
        meetingsBooked: 0,
        createdBy: ctx.userId,
      });
    }),
});
