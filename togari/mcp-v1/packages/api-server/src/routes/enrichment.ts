/**
 * @togari/api-server/routes/enrichment
 * Data enrichment API endpoints (Exa and Clay)
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { logger, type ClayEnrichmentData, type CompanyEnrichmentResult } from '@natural-language-mcp/core';
import type { Services } from '../services';
import { handleError } from '../middleware';

const enrichPersonSchema = z.object({
  personId: z.string().optional(),
  linkedinUrl: z.string().optional(),
  email: z.string().email().optional(),
  fullName: z.string().optional(),
  companyDomain: z.string().optional(),
  provider: z.enum(['exa', 'clay', 'auto']).default('auto'),
});

const enrichCompanySchema = z.object({
  companyId: z.string().optional(),
  domain: z.string(),
  provider: z.enum(['exa', 'clay', 'auto']).default('auto'),
});

const searchEntitiesSchema = z.object({
  query: z.string(),
  entityType: z.enum(['company', 'contact']),
  limit: z.number().min(1).max(100).default(10),
  filters: z.object({
    location: z.string().optional(),
    industry: z.string().optional(),
  }).optional(),
});

export function createEnrichmentRouter(services: Services): Router {
  const router = Router();

  /**
   * POST /api/v1/enrichment/person
   * Enrich a person with external data
   */
  router.post('/person', async (req: Request, res: Response): Promise<void> => {
    try {
      const parseResult = enrichPersonSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation Error',
          details: parseResult.error.errors,
        });
        return;
      }

      const { personId, linkedinUrl, email, fullName, companyDomain, provider } = parseResult.data;

      // If personId provided, load existing person data
      let existingPerson = null;
      if (personId) {
        existingPerson = await services.structify.getPerson(personId);
        if (!existingPerson) {
          res.status(404).json({
            error: 'Not Found',
            message: `Person with ID ${personId} not found`,
          });
          return;
        }
      }

      // Determine which provider to use
      const useProvider = provider === 'auto'
        ? (services.exa ? 'exa' : services.clay ? 'clay' : null)
        : provider;

      if (!useProvider) {
        res.status(503).json({
          error: 'Service Unavailable',
          message: 'No enrichment provider is configured',
        });
        return;
      }

      let enrichmentResult;

      if (useProvider === 'exa' && services.exa) {
        // Use Exa for enrichment - build identifier string
        const identifier = email || linkedinUrl || existingPerson?.workEmail || existingPerson?.linkedinUrl;
        if (!identifier) {
          res.status(400).json({
            error: 'Bad Request',
            message: 'Either email, linkedinUrl, or personId with email/linkedin is required',
          });
          return;
        }

        enrichmentResult = await services.exa.enrichContact(identifier);
      } else if (useProvider === 'clay' && services.clay) {
        // Use Clay for enrichment
        enrichmentResult = await services.clay.enrichPerson({
          linkedinUrl: linkedinUrl || existingPerson?.linkedinUrl,
          email: email || existingPerson?.workEmail,
          fullName: fullName || existingPerson?.fullName,
          companyDomain: companyDomain || existingPerson?.companyDomain,
        });
      } else {
        res.status(503).json({
          error: 'Service Unavailable',
          message: `Provider ${useProvider} is not configured`,
        });
        return;
      }

      // If we have a personId, update the person with enrichment data
      if (personId && existingPerson) {
        await services.structify.updatePerson(personId, {
          enrichmentData: {
            ...(existingPerson.enrichmentData || {}),
            [useProvider]: {
              data: enrichmentResult,
              enrichedAt: new Date().toISOString(),
            },
          },
        });

        // Recalculate scores
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
      }

      logger.info('Person enrichment completed', { personId, provider: useProvider });

      res.json({
        success: true,
        provider: useProvider,
        personId,
        enrichmentData: enrichmentResult,
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * POST /api/v1/enrichment/company
   * Enrich a company with external data
   */
  router.post('/company', async (req: Request, res: Response): Promise<void> => {
    try {
      const parseResult = enrichCompanySchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation Error',
          details: parseResult.error.errors,
        });
        return;
      }

      const { companyId, domain, provider } = parseResult.data;

      // If companyId provided, load existing company data
      let existingCompany = null;
      if (companyId) {
        existingCompany = await services.structify.getCompany(companyId);
        if (!existingCompany) {
          res.status(404).json({
            error: 'Not Found',
            message: `Company with ID ${companyId} not found`,
          });
          return;
        }
      }

      // Determine which provider to use
      const useProvider = provider === 'auto'
        ? (services.exa ? 'exa' : services.clay ? 'clay' : null)
        : provider;

      if (!useProvider) {
        res.status(503).json({
          error: 'Service Unavailable',
          message: 'No enrichment provider is configured',
        });
        return;
      }

      let enrichmentResult: ClayEnrichmentData | CompanyEnrichmentResult;

      if (useProvider === 'exa' && services.exa) {
        enrichmentResult = await services.exa.enrichCompany(domain);
      } else if (useProvider === 'clay' && services.clay) {
        enrichmentResult = await services.clay.enrichCompany(domain);
      } else {
        res.status(503).json({
          error: 'Service Unavailable',
          message: `Provider ${useProvider} is not configured`,
        });
        return;
      }

      // If we have a companyId, update the company with enrichment data
      if (companyId && existingCompany) {
        const updates: Record<string, unknown> = {};

        // Map common fields from enrichment - handle both provider types
        if ('companyData' in enrichmentResult && enrichmentResult.companyData) {
          // Clay enrichment result
          const data = enrichmentResult.companyData;
          if (data.industry) updates.industry = data.industry;
          if (data.employeeCount) updates.employeeCount = data.employeeCount;
          if (data.description) updates.description = data.description;
          if (data.technologies) updates.techStack = data.technologies;
        } else if ('industry' in enrichmentResult) {
          // Exa enrichment result (CompanyEnrichmentResult)
          const data = enrichmentResult as CompanyEnrichmentResult;
          if (data.industry) updates.industry = data.industry;
          if (data.employeeCount) updates.employeeCount = data.employeeCount;
          if (data.description) updates.description = data.description;
          if (data.technologies) updates.techStack = data.technologies;
        }

        await services.structify.updateCompany(companyId, updates);
      }

      logger.info('Company enrichment completed', { companyId, domain, provider: useProvider });

      res.json({
        success: true,
        provider: useProvider,
        companyId,
        domain,
        enrichmentData: enrichmentResult,
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * POST /api/v1/enrichment/search
   * Search for entities using Exa
   */
  router.post('/search', async (req: Request, res: Response): Promise<void> => {
    try {
      const parseResult = searchEntitiesSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation Error',
          details: parseResult.error.errors,
        });
        return;
      }

      const { query, entityType, limit, filters } = parseResult.data;

      if (!services.exa) {
        res.status(503).json({
          error: 'Service Unavailable',
          message: 'Exa search is not configured',
        });
        return;
      }

      // Build search query with filters
      let searchQuery = query;
      if (filters?.location) {
        searchQuery += ` location:${filters.location}`;
      }
      if (filters?.industry) {
        searchQuery += ` industry:${filters.industry}`;
      }

      const results = await services.exa.search(searchQuery, {
        numResults: limit,
        type: 'neural',
      });

      logger.info('Entity search completed', { query, entityType, resultCount: results.results.length });

      res.json({
        success: true,
        query,
        entityType,
        resultCount: results.results.length,
        results: results.results.map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.text?.substring(0, 200),
          score: r.score,
        })),
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * POST /api/v1/enrichment/batch
   * Batch enrich multiple entities
   */
  router.post('/batch', async (req: Request, res: Response): Promise<void> => {
    try {
      const { entityType, entityIds } = req.body;

      if (!Array.isArray(entityIds) || entityIds.length === 0) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'entityIds array is required',
        });
        return;
      }

      if (entityIds.length > 50) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Maximum 50 entities per batch',
        });
        return;
      }

      const results = {
        total: entityIds.length,
        successful: 0,
        failed: 0,
        errors: [] as Array<{ entityId: string; error: string }>,
      };

      // Process in parallel with limited concurrency
      const concurrency = 5;
      for (let i = 0; i < entityIds.length; i += concurrency) {
        const batch = entityIds.slice(i, i + concurrency);
        const promises = batch.map(async (entityId: string) => {
          try {
            if (entityType === 'person') {
              const person = await services.structify.getPerson(entityId);
              if (person && services.clay) {
                await services.clay.pushToClayForEnrichment(person);
              }
            }
            results.successful++;
          } catch (error) {
            results.failed++;
            results.errors.push({
              entityId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });

        await Promise.allSettled(promises);

        // Rate limiting delay between batches
        if (i + concurrency < entityIds.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      logger.info('Batch enrichment completed', results);

      res.json({
        success: true,
        ...results,
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  return router;
}
