import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { createLogger } from '@togari/core';

const logger = createLogger('WebhookAuth');

/**
 * Webhook Authentication Middleware
 * Validates API key using constant-time comparison to prevent timing attacks
 *
 * Usage:
 *   app.use('/webhook', validateWebhookAuth, handler)
 *
 * Expects:
 *   - Header: 'x-webhook-key' with the API key
 *   - Environment: WEBHOOK_API_KEY or AMBER_API_KEY
 */
export function validateWebhookAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-webhook-key'];
  const expectedKey = process.env.WEBHOOK_API_KEY || process.env.AMBER_API_KEY;

  // Validate that both API key and expected key exist
  if (!apiKey || !expectedKey || typeof apiKey !== 'string') {
    logger.warn('Webhook authentication failed: missing or invalid API key', {
      hasApiKey: !!apiKey,
      hasExpectedKey: !!expectedKey,
      apiKeyType: typeof apiKey,
      path: req.path,
      ip: req.ip,
    });

    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Invalid webhook authentication',
    });
  }

  // Use constant-time comparison to prevent timing attacks
  const apiKeyBuffer = Buffer.from(apiKey);
  const expectedKeyBuffer = Buffer.from(expectedKey);

  // First check length (safe to do before timing-safe comparison)
  if (apiKeyBuffer.length !== expectedKeyBuffer.length) {
    logger.warn('Webhook authentication failed: key length mismatch', {
      path: req.path,
      ip: req.ip,
    });

    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Invalid webhook authentication',
    });
  }

  // Constant-time comparison
  if (!timingSafeEqual(apiKeyBuffer, expectedKeyBuffer)) {
    logger.warn('Webhook authentication failed: invalid key', {
      path: req.path,
      ip: req.ip,
    });

    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Invalid webhook authentication',
    });
  }

  // Authentication successful
  next();
}
