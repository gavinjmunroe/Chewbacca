/**
 * @togari/api-server/routes/touchpoints
 * REST API routes for Touchpoint entity
 */

import { Router, type Request, type Response } from 'express';
import {
  logger,
  createTouchpointSchema,
} from '@natural-language-mcp/core';
import type { Services } from '../services';
import { validateRequest, getOrganizationId, handleError, getPagination, getSorting } from '../middleware';

export function createTouchpointsRouter(services: Services): Router {
  const router = Router();

  /**
   * GET /api/v1/touchpoints
   * List all touchpoints with optional filters
   */
  router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = getOrganizationId(req);
      const { personId, campaignId, touchpointType } = req.query;
      const { limit, offset } = getPagination(req);
      const { orderBy, orderDirection } = getSorting(req);

      const filters = [];

      if (organizationId) {
        filters.push({ field: 'organizationId', operator: 'eq' as const, value: organizationId });
      }
      if (personId) {
        filters.push({ field: 'personId', operator: 'eq' as const, value: personId });
      }
      if (campaignId) {
        filters.push({ field: 'campaignId', operator: 'eq' as const, value: campaignId });
      }
      if (touchpointType) {
        filters.push({ field: 'touchpointType', operator: 'eq' as const, value: touchpointType });
      }

      const result = await services.structify.listTouchpoints({
        filters,
        limit,
        offset,
        orderBy: orderBy || 'occurredAt',
        orderDirection: orderDirection || 'desc',
      });

      res.json(result);
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * POST /api/v1/touchpoints
   * Create a new touchpoint
   */
  router.post('/', validateRequest(createTouchpointSchema), async (req: Request, res: Response): Promise<void> => {
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

      // Verify person exists
      const person = await services.structify.getPerson(input.personId);
      if (!person) {
        res.status(404).json({
          error: 'Not Found',
          message: `Person with ID ${input.personId} not found`,
        });
        return;
      }

      const touchpoint = await services.structify.createTouchpoint({
        ...input,
        organizationId,
      });

      // Update person's touch count and last contacted
      await services.structify.updatePerson(input.personId, {
        lastContactedAt: new Date(),
      });

      logger.info('Touchpoint created', { touchpointId: touchpoint.touchpointId });
      res.status(201).json(touchpoint);
    } catch (error) {
      handleError(res, error);
    }
  });

  return router;
}
