/**
 * @togari/api-server/routes/relationships
 * REST API routes for Relationship entity
 */

import { Router, type Request, type Response } from 'express';
import {
  logger,
  createRelationshipSchema,
  updateRelationshipSchema,
} from '@natural-language-mcp/core';
import type { Services } from '../services';
import { validateRequest, getOrganizationId, handleError, getPagination, getSorting } from '../middleware';

export function createRelationshipsRouter(services: Services): Router {
  const router = Router();

  /**
   * GET /api/v1/relationships
   * List all relationships with optional filters
   */
  router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = getOrganizationId(req);
      const { personId, relationshipType } = req.query;
      const { limit, offset } = getPagination(req);
      const { orderBy, orderDirection } = getSorting(req);

      const filters = [];

      if (organizationId) {
        filters.push({ field: 'organizationId', operator: 'eq' as const, value: organizationId });
      }
      if (relationshipType) {
        filters.push({ field: 'relationshipType', operator: 'eq' as const, value: relationshipType });
      }

      // If personId specified, use the special method
      if (personId) {
        const result = await services.structify.listRelationshipsForPerson(personId as string, {
          filters,
          limit,
          offset,
          orderBy,
          orderDirection,
        });
        res.json(result);
        return;
      }

      const result = await services.structify.listRelationships({
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
   * POST /api/v1/relationships
   * Create a new relationship
   */
  router.post('/', validateRequest(createRelationshipSchema), async (req: Request, res: Response): Promise<void> => {
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

      // Verify both persons exist
      const [personA, personB] = await Promise.all([
        services.structify.getPerson(input.personAId),
        services.structify.getPerson(input.personBId),
      ]);

      if (!personA) {
        res.status(404).json({
          error: 'Not Found',
          message: `Person A with ID ${input.personAId} not found`,
        });
        return;
      }

      if (!personB) {
        res.status(404).json({
          error: 'Not Found',
          message: `Person B with ID ${input.personBId} not found`,
        });
        return;
      }

      const relationship = await services.structify.createRelationship({
        ...input,
        organizationId,
      });

      logger.info('Relationship created', { relationshipId: relationship.relationshipId });
      res.status(201).json(relationship);
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * PUT /api/v1/relationships/:relationshipId
   * Update an existing relationship
   */
  router.put('/:relationshipId', validateRequest(updateRelationshipSchema), async (req: Request, res: Response): Promise<void> => {
    try {
      const { relationshipId } = req.params;
      const updates = req.body;

      const relationship = await services.structify.updateRelationship(relationshipId, updates);
      res.json(relationship);
    } catch (error) {
      handleError(res, error);
    }
  });

  return router;
}
