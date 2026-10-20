/**
 * @togari/api-server/middleware
 * Express middleware functions
 */

import { type Request, type Response, type NextFunction } from 'express';
import { type ZodSchema, ZodError } from 'zod';
import { logger, config } from '@natural-language-mcp/core';

/**
 * Validate request body against a Zod schema
 */
export function validateRequest(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: 'Validation Error',
          message: 'Request body validation failed',
          details: error.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        });
        return;
      }
      next(error);
    }
  };
}

/**
 * Get organization ID from request headers or body
 */
export function getOrganizationId(req: Request): string | undefined {
  return (
    req.headers['x-organization-id'] as string ||
    req.body?.organizationId ||
    req.query?.organizationId as string
  );
}

/**
 * Require organization ID middleware
 */
export function requireOrganizationId(req: Request, res: Response, next: NextFunction): void {
  const organizationId = getOrganizationId(req);
  if (!organizationId) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'X-Organization-ID header or organizationId is required',
    });
    return;
  }
  next();
}

/**
 * Validate API key for protected endpoints
 */
export function validateApiKey(expectedKeyEnvVar: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const apiKey = req.headers['x-api-key'] as string;
    const expectedKey = process.env[expectedKeyEnvVar];

    if (!expectedKey) {
      logger.warn(`API key validation skipped: ${expectedKeyEnvVar} not configured`);
      next();
      return;
    }

    if (!apiKey || apiKey !== expectedKey) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or missing API key',
      });
      return;
    }

    next();
  };
}

/**
 * Handle errors and send appropriate response
 */
export function handleError(res: Response, error: unknown): void {
  logger.error('Request error', error);

  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Validation Error',
      message: 'Request validation failed',
      details: error.errors,
    });
    return;
  }

  const err = error as Error & { status?: number; code?: string };

  if (err.status === 404) {
    res.status(404).json({
      error: 'Not Found',
      message: err.message,
    });
    return;
  }

  if (err.status === 409) {
    res.status(409).json({
      error: 'Conflict',
      message: err.message,
    });
    return;
  }

  if (err.code === 'UPSTREAM_API_ERROR') {
    res.status(502).json({
      error: 'Bad Gateway',
      message: 'External service error',
      details: config.env === 'development' ? err.message : undefined,
    });
    return;
  }

  res.status(500).json({
    error: 'Internal Server Error',
    message: config.env === 'development' ? err.message : 'An unexpected error occurred',
  });
}

/**
 * Parse pagination parameters from request
 */
export function getPagination(req: Request): { limit: number; offset: number } {
  const limit = Math.min(
    parseInt(req.query.limit as string, 10) || 50,
    100 // Max limit
  );
  const offset = parseInt(req.query.offset as string, 10) || 0;
  return { limit, offset };
}

/**
 * Parse sorting parameters from request
 */
export function getSorting(req: Request): { orderBy?: string; orderDirection?: 'asc' | 'desc' } {
  return {
    orderBy: req.query.orderBy as string,
    orderDirection: req.query.orderDirection as 'asc' | 'desc',
  };
}
