import { Router } from 'express';
import { timingSafeEqual } from 'crypto';
import { amberSubmissionSchema } from '@togari/core';
import { normalizeLinkedInUrl } from '@togari/core';
import { createLogger } from '@togari/core';
import { API_ENDPOINTS } from '../config/constants';
import { buildSafeURL } from '../utils/urlBuilder';
import { createStructifyClient } from '../utils/structifyClient';

const logger = createLogger('AmberWebhook');

export const amberWebhookRouter = Router();

/**
 * Amber Lead Submission Endpoint
 * Simple passthrough to Structify - enrichment handled by n8n
 */
amberWebhookRouter.post(API_ENDPOINTS.AMBER_SUBMIT, async (req, res) => {
  try {
    // 1. Validate API key with timing-safe comparison
    const apiKey = req.headers['x-api-key'];
    const expectedKey = process.env.AMBER_API_KEY;

    if (!apiKey || !expectedKey || typeof apiKey !== 'string') {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Invalid API key',
      });
    }

    // Use constant-time comparison to prevent timing attacks
    const apiKeyBuffer = Buffer.from(apiKey);
    const expectedKeyBuffer = Buffer.from(expectedKey);

    if (apiKeyBuffer.length !== expectedKeyBuffer.length ||
        !timingSafeEqual(apiKeyBuffer, expectedKeyBuffer)) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Invalid API key',
      });
    }

    // 2. Validate request body
    const validation = amberSubmissionSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: `Validation error: ${validation.error.errors[0]?.message || 'Invalid request data'}`,
      });
    }

    const data = validation.data;

    // 3. Initialize Structify client
    const structify = createStructifyClient();

    // 4. Check for duplicate by LinkedIn URL
    const normalizedLinkedIn = normalizeLinkedInUrl(data.linkedinUrl);
    const existing = await structify.findPersonByLinkedIn(
      normalizedLinkedIn,
      data.organizationId
    );

    if (existing) {
      // Update notes if provided
      if (data.notes) {
        await structify.updatePerson(existing.personId, {
          enrichmentData: {
            ...existing.enrichmentData,
            amberNotes: [
              ...(existing.enrichmentData?.amberNotes || []),
              {
                note: data.notes,
                submittedBy: data.submittedBy,
                submittedAt: new Date().toISOString(),
              },
            ],
          },
          updatedAt: new Date(),
        });
      }

      return res.status(200).json({
        success: true,
        personId: existing.personId,
        message: 'Lead already exists, updated with new information',
      });
    }

    // 5. Create new person in Structify
    const person = await structify.createPerson({
      linkedinUrl: normalizedLinkedIn,
      fullName: data.submittedName || 'Unknown',
      currentCompany: data.submittedCompany,
      currentTitle: data.submittedTitle,
      vertical: 'healthcare' as const, // Default, will be updated by enrichment
      sourceType: 'amber_form' as const,
      sourceChannel: data.sourceChannel,
      sourceCampaign: data.sourceCampaign,
      submittedBy: data.submittedBy,
      currentStatus: 'new' as const,
      totalTouches: 0,
      internalScore: 0,
      externalScore: 0,
      compositeScore: 0,
      routingTier: 'nurture' as const,
      organizationId: data.organizationId,
      enrichmentData: data.notes
        ? {
            amberNotes: [
              {
                note: data.notes,
                submittedBy: data.submittedBy,
                submittedAt: new Date().toISOString(),
              },
            ],
          }
        : undefined,
    });

    // 6. Trigger n8n enrichment workflow
    await triggerN8nWorkflow('lead-enrichment', {
      personId: person.personId,
      organizationId: data.organizationId,
    });

    // 7. Return success
    return res.status(200).json({
      success: true,
      personId: person.personId,
      message: 'Lead submitted successfully',
    });
  } catch (error) {
    logger.error('Amber submission error', error instanceof Error ? error : new Error(String(error)));

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

/**
 * Trigger n8n workflow
 */
interface N8nWorkflowData {
  personId: string;
  organizationId: string;
}

async function triggerN8nWorkflow(workflowName: string, data: N8nWorkflowData): Promise<void> {
  try {
    const n8nBaseUrl = process.env.N8N_BASE_URL;
    if (!n8nBaseUrl) {
      logger.warn('N8N_BASE_URL not configured, skipping workflow trigger');
      return;
    }

    // Build URL safely to prevent SSRF and injection attacks
    const url = buildSafeURL(n8nBaseUrl, 'webhook', workflowName);

    await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
  } catch (error) {
    logger.error(
      `Failed to trigger n8n workflow ${workflowName}`,
      error instanceof Error ? error : new Error(String(error))
    );
    // Don't throw - workflow trigger failure shouldn't fail the submission
  }
}
