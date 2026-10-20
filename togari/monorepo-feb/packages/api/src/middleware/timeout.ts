import { Request, Response, NextFunction } from 'express';
import { createLogger } from '@togari/core';

const logger = createLogger('Timeout');

/**
 * Request Timeout Middleware
 * Automatically terminate requests that take too long
 */

const DEFAULT_TIMEOUT = 30000; // 30 seconds

export function timeoutMiddleware(timeoutMs: number = DEFAULT_TIMEOUT) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip timeout for health checks and streaming endpoints
    if (req.path === '/health' || req.path.includes('/stream')) {
      return next();
    }

    // Set timeout on the request
    req.setTimeout(timeoutMs, () => {
      if (!res.headersSent) {
        logger.warn('Request timeout', {
          requestId: req.id,
          path: req.path,
          method: req.method,
          timeout: timeoutMs,
        });

        res.status(408).json({
          success: false,
          message: 'Request timeout',
          code: 'TIMEOUT',
        });
      }
    });

    next();
  };
}
