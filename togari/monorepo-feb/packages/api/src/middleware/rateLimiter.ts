import rateLimit from 'express-rate-limit';
import { createLogger } from '@togari/core';

const logger = createLogger('RateLimiter');

/**
 * Rate limiter for webhook endpoints
 * Protects against abuse and DDoS attacks
 */
export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 100 requests per minute
  message: { success: false, message: 'Too many requests, please try again later' },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      userAgent: req.get('user-agent'),
    });
    res.status(429).json({
      success: false,
      message: 'Too many requests, please try again later',
    });
  },
});

/**
 * Rate limiter for Amber form submissions
 * More restrictive to prevent spam
 */
export const amberSubmissionRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 submissions per minute
  message: { success: false, message: 'Too many submissions, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Amber submission rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.status(429).json({
      success: false,
      message: 'Too many submissions, please try again later',
    });
  },
});

/**
 * Rate limiter for health check endpoint
 * Prevents abuse while allowing monitoring
 */
export const healthCheckRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 100 health checks per minute
  message: { success: false, message: 'Too many health check requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for API endpoints
 * General protection for tRPC endpoints
 */
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 500, // Limit each IP to 500 requests per minute
  message: { success: false, message: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
