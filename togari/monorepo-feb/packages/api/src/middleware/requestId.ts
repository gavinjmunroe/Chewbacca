import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * Request ID Middleware
 * Adds a unique ID to each request for tracing and logging
 */

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  // Check if request already has an ID (from load balancer or proxy)
  const existingId = req.headers['x-request-id'] as string;

  // Generate new ID if none exists
  const requestId = existingId || randomUUID();

  // Attach to request object
  req.id = requestId;

  // Add to response headers for client-side tracing
  res.setHeader('X-Request-ID', requestId);

  next();
}
