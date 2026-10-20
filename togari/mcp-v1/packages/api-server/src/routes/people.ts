/**
 * @togari/api-server/routes/people
 * REST API routes for Person (Lead) entity
 */

import { Router, type Request, type Response } from 'express';
import {
  logger,
  createPersonSchema,
  updatePersonSchema,
} from '@natural-language-mcp/core';
import type { Services } from '../services';
import { validateRequest, getOrganizationId, handleError } from '../middleware';

export function createPeopleRouter(services: Services): Router {
  const router = Router();

  /**
   * GET /api/v1/people
   * List all people with optional filters
   */
  router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = getOrganizationId(req);
      const { status, vertical, routingTier, limit, offset, orderBy, orderDirection } = req.query;

      const filters = [];

      if (organizationId) {
        filters.push({ field: 'organizationId', operator: 'eq' as const, value: organizationId });
      }
      if (status) {
        filters.push({ field: 'currentStatus', operator: 'eq' as const, value: status });
      }
      if (vertical) {
        filters.push({ field: 'vertical', operator: 'eq' as const, value: vertical });
      }
      if (routingTier) {
        filters.push({ field: 'routingTier', operator: 'eq' as const, value: routingTier });
      }

      const result = await services.structify.listPersons({
        filters,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
        orderBy: orderBy as string,
        orderDirection: orderDirection as 'asc' | 'desc',
      });

      res.json(result);
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * GET /api/v1/people/:personId
   * Get a single person by ID
   */
  router.get('/:personId', async (req: Request, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      const person = await services.structify.getPerson(personId);

      if (!person) {
        res.status(404).json({
          error: 'Not Found',
          message: `Person with ID ${personId} not found`,
        });
        return;
      }

      res.json(person);
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * POST /api/v1/people
   * Create a new person
   */
  router.post('/', validateRequest(createPersonSchema), async (req: Request, res: Response): Promise<void> => {
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

      // Check for duplicate by LinkedIn URL
      const existing = await services.structify.findPersonByLinkedIn(
        input.linkedinUrl,
        organizationId
      );

      if (existing) {
        res.status(409).json({
          error: 'Conflict',
          message: 'A person with this LinkedIn URL already exists',
          existingPersonId: existing.personId,
        });
        return;
      }

      // Calculate initial scores
      const scores = services.scoring.calculateScores({
        ...input,
        organizationId,
      });

      const person = await services.structify.createPerson({
        ...input,
        organizationId,
      });

      // Update with calculated scores
      const updatedPerson = await services.structify.updatePerson(person.personId, {
        internalScore: scores.internalScore,
        externalScore: scores.externalScore,
        compositeScore: scores.compositeScore,
        routingTier: scores.routingTier,
      });

      logger.info('Person created', { personId: updatedPerson.personId });
      res.status(201).json(updatedPerson);
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * PUT /api/v1/people/:personId
   * Update an existing person
   */
  router.put('/:personId', validateRequest(updatePersonSchema), async (req: Request, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      const updates = req.body;

      const existing = await services.structify.getPerson(personId);
      if (!existing) {
        res.status(404).json({
          error: 'Not Found',
          message: `Person with ID ${personId} not found`,
        });
        return;
      }

      // Recalculate scores if relevant fields changed
      if (updates.sourceChannel || updates.companyData || updates.currentTitle || updates.techStack) {
        const scores = services.scoring.calculateScores({
          ...existing,
          ...updates,
        });
        updates.internalScore = scores.internalScore;
        updates.externalScore = scores.externalScore;
        updates.compositeScore = scores.compositeScore;
        updates.routingTier = scores.routingTier;
      }

      const person = await services.structify.updatePerson(personId, updates);
      res.json(person);
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * DELETE /api/v1/people/:personId
   * Delete a person
   */
  router.delete('/:personId', async (req: Request, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;

      const existing = await services.structify.getPerson(personId);
      if (!existing) {
        res.status(404).json({
          error: 'Not Found',
          message: `Person with ID ${personId} not found`,
        });
        return;
      }

      await services.structify.deletePerson(personId);
      res.status(204).send();
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * GET /api/v1/people/:personId/touchpoints
   * Get all touchpoints for a person
   */
  router.get('/:personId/touchpoints', async (req: Request, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      const { limit, offset } = req.query;

      const result = await services.structify.listTouchpointsForPerson(personId, {
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });

      res.json(result);
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * POST /api/v1/people/:personId/score
   * Recalculate scores for a person
   */
  router.post('/:personId/score', async (req: Request, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;

      const person = await services.structify.getPerson(personId);
      if (!person) {
        res.status(404).json({
          error: 'Not Found',
          message: `Person with ID ${personId} not found`,
        });
        return;
      }

      const scores = services.scoring.calculateScores(person);

      const updated = await services.structify.updatePerson(personId, {
        internalScore: scores.internalScore,
        externalScore: scores.externalScore,
        compositeScore: scores.compositeScore,
        routingTier: scores.routingTier,
      });

      res.json({
        personId,
        scores: {
          internal: scores.internalScore,
          external: scores.externalScore,
          composite: scores.compositeScore,
          routingTier: scores.routingTier,
        },
        factors: scores.factors,
        person: updated,
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  return router;
}
