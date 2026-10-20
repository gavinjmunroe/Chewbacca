import { Router } from 'express';
import { z } from 'zod';
import { createLogger, type Person, type Company, type Campaign } from '@togari/core';
import { API_ENDPOINTS, RETRY, SCORES } from '../config/constants';
import { retryWithBackoff, isTransientError } from '../utils/retry';
import { validateWebhookAuth } from '../middleware/webhookAuth';
import { createStructifyClient } from '../utils/structifyClient';

const logger = createLogger('Webhooks');

export const webhookRouter = Router();

/**
 * Clay Enrichment Callback
 * Receives enriched data from Clay and updates Structify
 */
webhookRouter.post(API_ENDPOINTS.CLAY_ENRICHMENT, validateWebhookAuth, async (req, res) => {
  try {
    const schema = z.object({
      personId: z.string(),
      organizationId: z.string(),
      enrichmentData: z.object({
        linkedinData: z
          .object({
            headline: z.string().optional(),
            summary: z.string().optional(),
            experience: z
              .array(
                z.object({
                  company: z.string(),
                  title: z.string(),
                  startDate: z.string().optional(),
                  endDate: z.string().optional(),
                  current: z.boolean(),
                })
              )
              .optional(),
          })
          .optional(),
        companyData: z
          .object({
            name: z.string().optional(),
            domain: z.string().optional(),
            industry: z.string().optional(),
            employeeCount: z.number().optional(),
          })
          .optional(),
        emailVerification: z
          .object({
            isValid: z.boolean(),
            email: z.string(),
          })
          .optional(),
      }),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) {
      logger.error('Clay webhook validation failed', undefined, { errors: validation.error.errors });
      // SECURITY: Don't expose validation errors (may contain PII from request)
      // Errors are logged for debugging but not returned to client
      return res.status(400).json({ success: false, message: 'Invalid payload format' });
    }

    const data = validation.data;

    // Initialize Structify
    const structify = createStructifyClient();

    // Update person with enriched data
    const updates: Partial<Person> = {
      enrichmentData: data.enrichmentData as Person['enrichmentData'],
      updatedAt: new Date(),
    };

    if (data.enrichmentData.linkedinData) {
      updates.linkedinHeadline = data.enrichmentData.linkedinData.headline;
      updates.linkedinSummary = data.enrichmentData.linkedinData.summary;
      updates.linkedinExperience = data.enrichmentData.linkedinData.experience;
    }

    if (data.enrichmentData.companyData) {
      updates.currentCompany = data.enrichmentData.companyData.name;
      updates.companyDomain = data.enrichmentData.companyData.domain;
      // companyData is set via enrichmentData above
    }

    if (data.enrichmentData.emailVerification) {
      updates.emailValid = data.enrichmentData.emailVerification.isValid;
      updates.workEmail = data.enrichmentData.emailVerification.email;
    }

    // Update person with retry logic for transient failures
    await retryWithBackoff(
      () => structify.updatePerson(data.personId, updates),
      { maxAttempts: RETRY.MAX_ATTEMPTS, delayMs: RETRY.DELAY_MS }
    );

    res.json({ success: true, message: 'Enrichment data received' });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Clay webhook error', err);

    // Return appropriate status code based on error type
    if (isTransientError(error)) {
      return res.status(503).json({
        success: false,
        message: 'Service temporarily unavailable, please retry',
      });
    }

    // Server errors (Structify API failures, database errors, etc.)
    res.status(500).json({
      success: false,
      message: 'Failed to process enrichment data',
    });
  }
});

/**
 * Clay/n8n Scoring Callback
 * Receives calculated scores and routing tier from external scoring
 */
webhookRouter.post(API_ENDPOINTS.SCORING_UPDATE, validateWebhookAuth, async (req, res) => {
  try {
    const schema = z.object({
      personId: z.string(),
      organizationId: z.string(),
      scores: z.object({
        internalScore: z.number().min(SCORES.MIN).max(SCORES.MAX),
        externalScore: z.number().min(SCORES.MIN).max(SCORES.MAX),
        compositeScore: z.number().min(SCORES.MIN).max(SCORES.MAX),
        routingTier: z.enum(['high_touch', 'standard', 'nurture', 'disqualify']),
      }),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) {
      logger.error('Scoring webhook validation failed', undefined, { errors: validation.error.errors });
      // SECURITY: Don't expose validation errors (may contain PII from request)
      // Errors are logged for debugging but not returned to client
      return res.status(400).json({ success: false, message: 'Invalid payload format' });
    }

    const data = validation.data;

    const structify = createStructifyClient();

    // Update scores with retry logic for transient failures
    await retryWithBackoff(
      () =>
        structify.updatePerson(data.personId, {
          internalScore: data.scores.internalScore,
          externalScore: data.scores.externalScore,
          compositeScore: data.scores.compositeScore,
          routingTier: data.scores.routingTier,
          updatedAt: new Date(),
        }),
      { maxAttempts: RETRY.MAX_ATTEMPTS, delayMs: RETRY.DELAY_MS }
    );

    res.json({ success: true, message: 'Scores updated' });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Scoring webhook error', err);

    if (isTransientError(error)) {
      return res.status(503).json({
        success: false,
        message: 'Service temporarily unavailable, please retry',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update scores',
    });
  }
});

/**
 * Generic n8n Callback
 * Flexible webhook for any n8n workflow to update Structify
 */
webhookRouter.post(API_ENDPOINTS.N8N_CALLBACK, validateWebhookAuth, async (req, res) => {
  try {
    const schema = z.object({
      entityType: z.enum(['person', 'company', 'campaign', 'touchpoint']),
      entityId: z.string(),
      organizationId: z.string(),
      updates: z.record(z.unknown()),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) {
      logger.error('n8n callback validation failed', undefined, { errors: validation.error.errors });
      // SECURITY: Don't expose validation errors (may contain PII from request)
      // Errors are logged for debugging but not returned to client
      return res.status(400).json({ success: false, message: 'Invalid payload format' });
    }

    const data = validation.data;

    const structify = createStructifyClient();

    // Update the appropriate entity with retry logic
    await retryWithBackoff(async () => {
      if (data.entityType === 'person') {
        await structify.updatePerson(data.entityId, {
          ...data.updates,
          updatedAt: new Date(),
        });
      } else if (data.entityType === 'company') {
        await structify.updateCompany(data.entityId, {
          ...data.updates,
          updatedAt: new Date(),
        });
      } else if (data.entityType === 'campaign') {
        await structify.updateCampaign(data.entityId, {
          ...data.updates,
          updatedAt: new Date(),
        });
      }
    }, { maxAttempts: RETRY.MAX_ATTEMPTS, delayMs: RETRY.DELAY_MS });

    res.json({ success: true, message: 'Entity updated' });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('n8n callback error', err);

    if (isTransientError(error)) {
      return res.status(503).json({
        success: false,
        message: 'Service temporarily unavailable, please retry',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update entity',
    });
  }
});
