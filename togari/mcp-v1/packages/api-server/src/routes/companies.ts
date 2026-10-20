/**
 * @togari/api-server/routes/companies
 * REST API routes for Company entity
 */

import { Router, type Request, type Response } from 'express';
import {
  logger,
  createCompanySchema,
  updateCompanySchema,
} from '@natural-language-mcp/core';
import type { Services } from '../services';
import { validateRequest, getOrganizationId, handleError, getPagination, getSorting } from '../middleware';

export function createCompaniesRouter(services: Services): Router {
  const router = Router();

  /**
   * GET /api/v1/companies
   * List all companies with optional filters
   */
  router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = getOrganizationId(req);
      const { vertical, companyTier, industry } = req.query;
      const { limit, offset } = getPagination(req);
      const { orderBy, orderDirection } = getSorting(req);

      const filters = [];

      if (organizationId) {
        filters.push({ field: 'organizationId', operator: 'eq' as const, value: organizationId });
      }
      if (vertical) {
        filters.push({ field: 'vertical', operator: 'eq' as const, value: vertical });
      }
      if (companyTier) {
        filters.push({ field: 'companyTier', operator: 'eq' as const, value: companyTier });
      }
      if (industry) {
        filters.push({ field: 'industry', operator: 'eq' as const, value: industry });
      }

      const result = await services.structify.listCompanies({
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
   * GET /api/v1/companies/:companyId
   * Get a single company by ID
   */
  router.get('/:companyId', async (req: Request, res: Response): Promise<void> => {
    try {
      const { companyId } = req.params;
      const company = await services.structify.getCompany(companyId);

      if (!company) {
        res.status(404).json({
          error: 'Not Found',
          message: `Company with ID ${companyId} not found`,
        });
        return;
      }

      res.json(company);
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * GET /api/v1/companies/domain/:domain
   * Find a company by domain
   */
  router.get('/domain/:domain', async (req: Request, res: Response): Promise<void> => {
    try {
      const { domain } = req.params;
      const organizationId = getOrganizationId(req);

      if (!organizationId) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'organizationId is required',
        });
        return;
      }

      const company = await services.structify.findCompanyByDomain(domain, organizationId);

      if (!company) {
        res.status(404).json({
          error: 'Not Found',
          message: `Company with domain ${domain} not found`,
        });
        return;
      }

      res.json(company);
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * POST /api/v1/companies
   * Create a new company
   */
  router.post('/', validateRequest(createCompanySchema), async (req: Request, res: Response): Promise<void> => {
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

      // Check for duplicate by domain
      const existing = await services.structify.findCompanyByDomain(
        input.domain,
        organizationId
      );

      if (existing) {
        res.status(409).json({
          error: 'Conflict',
          message: 'A company with this domain already exists',
          existingCompanyId: existing.companyId,
        });
        return;
      }

      const company = await services.structify.createCompany({
        ...input,
        organizationId,
      });

      logger.info('Company created', { companyId: company.companyId });
      res.status(201).json(company);
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * PUT /api/v1/companies/:companyId
   * Update an existing company
   */
  router.put('/:companyId', validateRequest(updateCompanySchema), async (req: Request, res: Response): Promise<void> => {
    try {
      const { companyId } = req.params;
      const updates = req.body;

      const existing = await services.structify.getCompany(companyId);
      if (!existing) {
        res.status(404).json({
          error: 'Not Found',
          message: `Company with ID ${companyId} not found`,
        });
        return;
      }

      const company = await services.structify.updateCompany(companyId, updates);
      res.json(company);
    } catch (error) {
      handleError(res, error);
    }
  });

  return router;
}
