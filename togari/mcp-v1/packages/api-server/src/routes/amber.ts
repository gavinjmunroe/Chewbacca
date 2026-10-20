/**
 * @togari/api-server/routes/amber
 * Amber mobile app integration endpoints
 */

import { Router, type Request, type Response } from 'express';
import {
  logger,
  config,
  amberSubmissionSchema,
  normalizeLinkedInUrl,
  parseName,
} from '@natural-language-mcp/core';
import type { Services } from '../services';
import { handleError, validateApiKey } from '../middleware';

export function createAmberRouter(services: Services): Router {
  const router = Router();

  /**
   * POST /api/v1/amber/submit
   * Receive lead submissions from Amber mobile app
   */
  router.post(
    '/submit',
    validateApiKey('AMBER_API_KEY'),
    async (req: Request, res: Response): Promise<void> => {
      try {
        logger.info('Received Amber submission', {
          linkedinUrl: req.body.linkedinUrl,
          submitter: req.body.submitterEmail,
        });

        // Validate payload
        const parseResult = amberSubmissionSchema.safeParse(req.body);
        if (!parseResult.success) {
          res.status(400).json({
            error: 'Validation Error',
            message: 'Invalid submission payload',
            details: parseResult.error.errors,
          });
          return;
        }

        const submission = parseResult.data;

        // Normalize LinkedIn URL
        const normalizedLinkedInUrl = normalizeLinkedInUrl(submission.linkedinUrl);

        // Check for existing person with this LinkedIn URL
        const existingPerson = await services.structify.findPersonByLinkedIn(
          normalizedLinkedInUrl,
          submission.organizationId
        );

        if (existingPerson) {
          // Update existing person with new notes
          const existingEnrichmentData = existingPerson.enrichmentData || {};
          const notes = (existingEnrichmentData as { amberNotes?: Array<{ note: string; submitter: string; timestamp: string }> }).amberNotes || [];

          await services.structify.updatePerson(existingPerson.personId, {
            enrichmentData: {
              ...existingEnrichmentData,
              amberNotes: [
                ...notes,
                {
                  note: submission.notes,
                  submitter: submission.submitterEmail,
                  timestamp: new Date().toISOString(),
                },
              ],
            },
          });

          logger.info('Updated existing person from Amber', {
            personId: existingPerson.personId,
          });

          res.json({
            success: true,
            action: 'updated',
            personId: existingPerson.personId,
            message: 'Lead already exists, notes appended',
          });
          return;
        }

        // Parse name if provided
        const { firstName, lastName } = submission.fullName
          ? parseName(submission.fullName)
          : { firstName: undefined, lastName: undefined };

        // Infer vertical from company/title if possible
        const textForVertical = [
          submission.currentTitle || '',
          submission.currentCompany || '',
        ].join(' ');
        const inferredVertical = services.scoring.inferVertical(textForVertical);

        // Create new person
        const person = await services.structify.createPerson({
          linkedinUrl: normalizedLinkedInUrl,
          fullName: submission.fullName || 'Unknown',
          firstName,
          lastName,
          currentTitle: submission.currentTitle,
          currentCompany: submission.currentCompany,
          vertical: inferredVertical || 'healthcare',
          sourceType: 'amber_form',
          sourceChannel: submission.sourceChannel,
          sourceSubmitter: submission.submitterEmail,
          organizationId: submission.organizationId,
        });

        // Store initial notes
        if (submission.notes) {
          await services.structify.updatePerson(person.personId, {
            enrichmentData: {
              amberNotes: [
                {
                  note: submission.notes,
                  submitter: submission.submitterEmail,
                  timestamp: new Date().toISOString(),
                },
              ],
            },
          });
        }

        // Calculate initial scores
        const scores = services.scoring.calculateScores(person);
        await services.structify.updatePerson(person.personId, {
          internalScore: scores.internalScore,
          externalScore: scores.externalScore,
          compositeScore: scores.compositeScore,
          routingTier: scores.routingTier,
        });

        // Trigger n8n workflow if configured
        if (config.n8n.webhookUrl) {
          try {
            await triggerN8nWorkflow(config.n8n.webhookUrl, {
              workflow: 'lead-enrichment',
              personId: person.personId,
              linkedinUrl: normalizedLinkedInUrl,
              organizationId: submission.organizationId,
            });
            logger.info('n8n workflow triggered', { personId: person.personId });
          } catch (error) {
            // Don't fail the request if n8n trigger fails
            logger.warn('Failed to trigger n8n workflow', { error });
          }
        }

        // Optionally push to Clay for enrichment
        if (services.clay) {
          try {
            await services.clay.pushToClayForEnrichment(person);
            logger.info('Pushed to Clay for enrichment', { personId: person.personId });
          } catch (error) {
            logger.warn('Failed to push to Clay', { error });
          }
        }

        logger.info('Created new person from Amber', { personId: person.personId });

        res.status(201).json({
          success: true,
          action: 'created',
          personId: person.personId,
          routingTier: scores.routingTier,
        });
      } catch (error) {
        handleError(res, error);
      }
    }
  );

  /**
   * GET /api/v1/amber/status/:personId
   * Check enrichment status for a person submitted via Amber
   */
  router.get('/status/:personId', async (req: Request, res: Response): Promise<void> => {
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

      const enrichmentStatus = {
        personId: person.personId,
        fullName: person.fullName,
        currentStatus: person.currentStatus,
        routingTier: person.routingTier,
        scores: {
          internal: person.internalScore,
          external: person.externalScore,
          composite: person.compositeScore,
        },
        hasLinkedInData: !!(person.linkedinHeadline || person.linkedinExperience),
        hasCompanyData: !!person.companyData,
        hasTechStack: !!(person.techStack && person.techStack.length > 0),
        touchCount: person.touchCount,
        lastUpdated: person.updatedAt,
      };

      res.json(enrichmentStatus);
    } catch (error) {
      handleError(res, error);
    }
  });

  return router;
}

/**
 * Trigger an n8n workflow
 */
async function triggerN8nWorkflow(webhookUrl: string, data: Record<string, unknown>): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`n8n webhook failed: ${response.status}`);
  }
}
