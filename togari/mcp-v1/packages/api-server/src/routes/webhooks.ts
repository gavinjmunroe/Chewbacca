/**
 * @togari/api-server/routes/webhooks
 * Webhook endpoints for external service callbacks
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  logger,
  type ClayWebhookPayload,
  type ScoringUpdate,
} from '@natural-language-mcp/core';
import type { Services } from '../services';
import { handleError } from '../middleware';

// ============================================================================
// WEBHOOK SCHEMAS
// ============================================================================

const clayEnrichmentSchema = z.object({
  personId: z.string(),
  organizationId: z.string(),
  enrichmentData: z.object({
    linkedinData: z.object({
      headline: z.string().optional(),
      summary: z.string().optional(),
      experience: z.array(z.object({
        title: z.string(),
        company: z.string(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        current: z.boolean().optional(),
        description: z.string().optional(),
      })).optional(),
      skills: z.array(z.string()).optional(),
      connections: z.number().optional(),
    }).optional(),
    companyData: z.object({
      name: z.string().optional(),
      domain: z.string().optional(),
      industry: z.string().optional(),
      employeeCount: z.number().optional(),
      description: z.string().optional(),
      technologies: z.array(z.string()).optional(),
    }).optional(),
    emailVerification: z.object({
      valid: z.boolean(),
      deliverable: z.boolean().optional(),
      disposable: z.boolean().optional(),
    }).optional(),
  }),
  status: z.enum(['completed', 'failed', 'partial']),
  timestamp: z.string(),
});

const scoringUpdateSchema = z.object({
  personId: z.string(),
  internalScore: z.number().min(0).max(100),
  externalScore: z.number().min(0).max(100),
  compositeScore: z.number().min(0).max(100),
  routingTier: z.enum(['high_touch', 'standard', 'nurture', 'disqualify']),
  organizationId: z.string(),
});

const n8nCallbackSchema = z.object({
  entityType: z.enum(['person', 'company', 'campaign', 'touchpoint']),
  entityId: z.string(),
  organizationId: z.string(),
  updates: z.record(z.unknown()),
  metadata: z.record(z.unknown()).optional(),
});

export function createWebhooksRouter(services: Services): Router {
  const router = Router();

  /**
   * POST /api/v1/webhooks/clay/enrichment
   * Receive enrichment data from Clay
   */
  router.post('/clay/enrichment', async (req: Request, res: Response): Promise<void> => {
    try {
      logger.info('Received Clay enrichment webhook', {
        personId: req.body.personId,
        status: req.body.status,
      });

      // Validate payload
      const parseResult = clayEnrichmentSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid webhook payload',
          details: parseResult.error.errors,
        });
        return;
      }

      const payload = parseResult.data as ClayWebhookPayload;

      // Check if Clay client is available
      if (!services.clay) {
        logger.warn('Clay client not configured, processing webhook manually');
      }

      // Process the webhook
      const { personId, updates } = services.clay
        ? services.clay.handleEnrichmentWebhook(payload)
        : {
            personId: payload.personId,
            updates: {
              enrichmentData: {
                ...payload.enrichmentData,
                source: 'clay',
                enrichedAt: payload.timestamp,
              },
              linkedinHeadline: payload.enrichmentData.linkedinData?.headline,
              linkedinSummary: payload.enrichmentData.linkedinData?.summary,
              emailValid: payload.enrichmentData.emailVerification?.valid,
            },
          };

      // Update person in Structify
      const person = await services.structify.getPerson(personId);
      if (!person) {
        res.status(404).json({
          error: 'Not Found',
          message: `Person with ID ${personId} not found`,
        });
        return;
      }

      await services.structify.updatePerson(personId, updates);

      // Recalculate scores with new data
      const updatedPerson = await services.structify.getPerson(personId);
      if (updatedPerson) {
        const scores = services.scoring.calculateScores(updatedPerson);
        await services.structify.updatePerson(personId, {
          internalScore: scores.internalScore,
          externalScore: scores.externalScore,
          compositeScore: scores.compositeScore,
          routingTier: scores.routingTier,
        });
      }

      logger.info('Clay enrichment processed', { personId });
      res.json({ success: true, personId });
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * POST /api/v1/webhooks/scoring/update
   * Receive scoring updates from external scoring service
   */
  router.post('/scoring/update', async (req: Request, res: Response): Promise<void> => {
    try {
      logger.info('Received scoring update webhook', {
        personId: req.body.personId,
      });

      // Validate payload
      const parseResult = scoringUpdateSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid webhook payload',
          details: parseResult.error.errors,
        });
        return;
      }

      const { personId, internalScore, externalScore, compositeScore, routingTier } =
        parseResult.data as ScoringUpdate;

      // Verify person exists
      const person = await services.structify.getPerson(personId);
      if (!person) {
        res.status(404).json({
          error: 'Not Found',
          message: `Person with ID ${personId} not found`,
        });
        return;
      }

      // Update scores
      await services.structify.updatePerson(personId, {
        internalScore,
        externalScore,
        compositeScore,
        routingTier,
      });

      logger.info('Scoring update processed', { personId, compositeScore, routingTier });
      res.json({ success: true, personId, routingTier });
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * POST /api/v1/webhooks/n8n/callback
   * Generic callback endpoint for n8n workflows
   */
  router.post('/n8n/callback', async (req: Request, res: Response): Promise<void> => {
    try {
      logger.info('Received n8n callback', {
        entityType: req.body.entityType,
        entityId: req.body.entityId,
      });

      // Validate payload
      const parseResult = n8nCallbackSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid webhook payload',
          details: parseResult.error.errors,
        });
        return;
      }

      const { entityType, entityId, updates } = parseResult.data;

      // Route to appropriate update method
      switch (entityType) {
        case 'person':
          await services.structify.updatePerson(entityId, updates as Record<string, unknown>);
          break;
        case 'company':
          await services.structify.updateCompany(entityId, updates as Record<string, unknown>);
          break;
        case 'campaign':
          await services.structify.updateCampaign(entityId, updates as Record<string, unknown>);
          break;
        default:
          res.status(400).json({
            error: 'Bad Request',
            message: `Unsupported entity type: ${entityType}`,
          });
          return;
      }

      logger.info('n8n callback processed', { entityType, entityId });
      res.json({ success: true, entityType, entityId });
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * POST /api/v1/webhooks/exa/enrichment
   * Receive enrichment data from Exa (if using Exa webhooks)
   */
  router.post('/exa/enrichment', async (req: Request, res: Response): Promise<void> => {
    try {
      logger.info('Received Exa enrichment webhook', req.body);

      // Exa webhook processing would go here
      // For now, just acknowledge receipt

      res.json({ success: true, message: 'Exa webhook received' });
    } catch (error) {
      handleError(res, error);
    }
  });

  return router;
}
