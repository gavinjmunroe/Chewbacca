/**
 * @togari/api-server/routes/campaigns
 * REST API routes for Campaign entity
 */

import { Router, type Request, type Response } from 'express';
import {
  logger,
  createCampaignSchema,
  updateCampaignSchema,
} from '@natural-language-mcp/core';
import type { Services } from '../services';
import { validateRequest, getOrganizationId, handleError, getPagination, getSorting } from '../middleware';

export function createCampaignsRouter(services: Services): Router {
  const router = Router();

  /**
   * GET /api/v1/campaigns
   * List all campaigns with optional filters
   */
  router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = getOrganizationId(req);
      const { status, campaignType, vertical } = req.query;
      const { limit, offset } = getPagination(req);
      const { orderBy, orderDirection } = getSorting(req);

      const filters = [];

      if (organizationId) {
        filters.push({ field: 'organizationId', operator: 'eq' as const, value: organizationId });
      }
      if (status) {
        filters.push({ field: 'status', operator: 'eq' as const, value: status });
      }
      if (campaignType) {
        filters.push({ field: 'campaignType', operator: 'eq' as const, value: campaignType });
      }
      if (vertical) {
        filters.push({ field: 'vertical', operator: 'eq' as const, value: vertical });
      }

      const result = await services.structify.listCampaigns({
        filters,
        limit,
        offset,
        orderBy,
        orderDirection,
      });

      res.json(result);
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * GET /api/v1/campaigns/:campaignId
   * Get a single campaign by ID
   */
  router.get('/:campaignId', async (req: Request, res: Response): Promise<void> => {
    try {
      const { campaignId } = req.params;
      const campaign = await services.structify.getCampaign(campaignId);

      if (!campaign) {
        res.status(404).json({
          error: 'Not Found',
          message: `Campaign with ID ${campaignId} not found`,
        });
        return;
      }

      res.json(campaign);
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * POST /api/v1/campaigns
   * Create a new campaign
   */
  router.post('/', validateRequest(createCampaignSchema), async (req: Request, res: Response): Promise<void> => {
    try {
      const input = req.body;
      const organizationId = getOrganizationId(req) || input.organizationId;

      if (!organizationId) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'organizationId is required',
        });
        return;
      }

      const campaign = await services.structify.createCampaign({
        ...input,
        organizationId,
      });

      logger.info('Campaign created', { campaignId: campaign.campaignId });
      res.status(201).json(campaign);
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * PUT /api/v1/campaigns/:campaignId
   * Update an existing campaign
   */
  router.put('/:campaignId', validateRequest(updateCampaignSchema), async (req: Request, res: Response): Promise<void> => {
    try {
      const { campaignId } = req.params;
      const updates = req.body;

      const existing = await services.structify.getCampaign(campaignId);
      if (!existing) {
        res.status(404).json({
          error: 'Not Found',
          message: `Campaign with ID ${campaignId} not found`,
        });
        return;
      }

      const campaign = await services.structify.updateCampaign(campaignId, updates);
      res.json(campaign);
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * POST /api/v1/campaigns/:campaignId/metrics
   * Update campaign metrics
   */
  router.post('/:campaignId/metrics', async (req: Request, res: Response): Promise<void> => {
    try {
      const { campaignId } = req.params;
      const { emailsSent, emailsOpened, emailsReplied, meetingsBooked } = req.body;

      const existing = await services.structify.getCampaign(campaignId);
      if (!existing) {
        res.status(404).json({
          error: 'Not Found',
          message: `Campaign with ID ${campaignId} not found`,
        });
        return;
      }

      const updates: Partial<typeof existing> = {};
      if (emailsSent !== undefined) updates.emailsSent = (existing.emailsSent || 0) + emailsSent;
      if (emailsOpened !== undefined) updates.emailsOpened = (existing.emailsOpened || 0) + emailsOpened;
      if (emailsReplied !== undefined) updates.emailsReplied = (existing.emailsReplied || 0) + emailsReplied;
      if (meetingsBooked !== undefined) updates.meetingsBooked = (existing.meetingsBooked || 0) + meetingsBooked;

      const campaign = await services.structify.updateCampaign(campaignId, updates);
      res.json(campaign);
    } catch (error) {
      handleError(res, error);
    }
  });

  return router;
}
