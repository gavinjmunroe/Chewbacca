/**
 * @togari/admin — Sentry integration with PHI scrubbing
 */

import { createLogger } from './logger';

const logger = createLogger('sentry');

let sentryInitialized = false;
let SentryModule: any = null;

export async function initSentry(dsn?: string): Promise<void> {
  if (sentryInitialized) return;

  const sentryDsn = dsn || process.env.SENTRY_DSN;
  if (!sentryDsn) {
    logger.debug('SENTRY_DSN not set — Sentry disabled');
    return;
  }

  try {
    SentryModule = await import('@sentry/node');
    SentryModule.init({
      dsn: sentryDsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      beforeSend(event: any) {
        // PHI scrubbing
        if (event.request) {
          delete event.request.data;
          delete event.request.cookies;
          if (event.request.headers) {
            delete event.request.headers.authorization;
            delete event.request.headers.cookie;
          }
        }
        if (event.user) {
          delete event.user.email;
          delete event.user.username;
          delete event.user.ip_address;
        }
        return event;
      },
      ignoreErrors: [
        'BulkheadRejectedError',
        'Rate limit exceeded',
      ],
    });
    sentryInitialized = true;
    logger.info('Sentry initialized');
  } catch (error) {
    logger.warn('Failed to load @sentry/node — Sentry disabled', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!SentryModule) return;
  if (context) {
    SentryModule.withScope((scope: any) => {
      Object.entries(context).forEach(([key, value]) => scope.setExtra(key, value));
      SentryModule.captureException(error);
    });
  } else {
    SentryModule.captureException(error);
  }
}

export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  if (!SentryModule) return;
  SentryModule.captureMessage(message, level);
}

export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!SentryModule) return;
  await SentryModule.close(timeoutMs);
}
