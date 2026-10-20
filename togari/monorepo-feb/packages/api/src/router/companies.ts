import { z } from 'zod';
import { createCompanySchema } from '@togari/core';
import { router, protectedProcedure } from './trpc';
import { PAGINATION } from '../config/constants';

/**
 * Companies Router
 * Simple CRUD operations for companies
 */
export const companiesRouter = router({
  /**
   * List companies
   */
  list: protectedProcedure
    .input(
      z.object({
        vertical: z.string().optional(),
        limit: z.number().min(PAGINATION.MIN_LIMIT).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
        offset: z.number().min(PAGINATION.MIN_OFFSET).default(PAGINATION.MIN_OFFSET),
      })
    )
    .query(async ({ ctx, input }) => {
      const filters = input.vertical
        ? [{ field: 'vertical', operator: 'eq' as const, value: input.vertical }]
        : [];

      return ctx.structify.listCompanies(ctx.organizationId, {
        filters,
        limit: input.limit,
        offset: input.offset,
        orderBy: 'name',
        orderDirection: 'asc',
      });
    }),

  /**
   * Get single company
   */
  get: protectedProcedure
    .input(z.object({ companyId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.structify.getCompany(input.companyId, ctx.organizationId);
    }),

  /**
   * Create company
   */
  create: protectedProcedure
    .input(createCompanySchema.omit({ organizationId: true }))
    .mutation(async ({ ctx, input }) => {
      // Check for duplicate by domain
      const existing = await ctx.structify.findCompanyByDomain(
        input.domain,
        ctx.organizationId
      );

      if (existing) {
        return {
          company: existing,
          isNew: false,
        };
      }

      return {
        company: await ctx.structify.createCompany({
          ...input,
          organizationId: ctx.organizationId,
          companyTier: input.companyTier || ('smb' as const),
        }),
        isNew: true,
      };
    }),
});
