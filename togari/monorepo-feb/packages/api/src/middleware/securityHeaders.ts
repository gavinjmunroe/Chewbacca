import { Request, Response, NextFunction } from 'express';

/**
 * Security Headers Middleware
 * Adds recommended HTTP security headers to all responses
 *
 * Headers included:
 * - X-Content-Type-Options: Prevent MIME type sniffing
 * - X-Frame-Options: Prevent clickjacking attacks
 * - X-XSS-Protection: Enable browser XSS protection
 * - Strict-Transport-Security: Enforce HTTPS
 * - Content-Security-Policy: Restrict resource loading
 * - Referrer-Policy: Control referrer information
 * - Permissions-Policy: Restrict browser features
 */
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction) {
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking - only allow same origin
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // Enable XSS protection (legacy header, but still useful)
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Enforce HTTPS (only in production)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // Content Security Policy
  // Strict in production, relaxed in development only
  const isDev = process.env.NODE_ENV !== 'production';

  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      isDev
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" // Development only - NEVER in production
        : "script-src 'self'", // Production - no unsafe directives
      isDev
        ? "style-src 'self' 'unsafe-inline'" // Development only
        : "style-src 'self'", // Production - no unsafe directives
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://api.anthropic.com https://api.openai.com",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );

  // Referrer Policy - send only origin on cross-origin requests
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions Policy - restrict powerful browser features
  res.setHeader(
    'Permissions-Policy',
    [
      'geolocation=()',
      'microphone=()',
      'camera=()',
      'payment=()',
      'usb=()',
      'magnetometer=()',
      'gyroscope=()',
      'accelerometer=()',
    ].join(', ')
  );

  next();
}
