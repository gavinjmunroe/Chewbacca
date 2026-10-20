import { Request, Response, NextFunction } from 'express';
import { logger } from '@natural-language-mcp/core';

/**
 * Request logging middleware - logs method, path, duration, and status code
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info('HTTP Request', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
    });
  });

  next();
}

/**
 * Global error handler - formats errors consistently
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error('Unhandled error', err, {
    method: req.method,
    path: req.path,
  });

  const statusCode = res.statusCode !== 200 ? res.statusCode : 500;

  res.status(statusCode).json({
    success: false,
    error: err.message || 'Internal server error',
  });
}

/**
 * Optional API key validation middleware
 * Enable via REQUIRE_API_KEY environment variable
 */
export function validateApiKey(req: Request, res: Response, next: NextFunction): void {
  const requireApiKey = process.env.REQUIRE_API_KEY === 'true';

  if (!requireApiKey) {
    return next();
  }

  const apiKey = req.headers['x-api-key'];
  const validApiKey = process.env.API_KEY;

  if (!validApiKey) {
    logger.warn('REQUIRE_API_KEY is enabled but API_KEY is not set');
    return next();
  }

  if (!apiKey || apiKey !== validApiKey) {
    res.status(401).json({
      success: false,
      error: 'Invalid or missing API key',
    });
    return;
  }

  next();
}
