/**
 * @togari/instrument
 * Sentry initialization — MUST be imported before all other modules.
 *
 * HIPAA compliance:
 * - sendDefaultPii: false — no automatic PII collection
 * - beforeSend: strips request bodies (may contain PHI), cookies, user data
 * - Server-side data scrubbing configured in Sentry dashboard
 */

import * as Sentry from '@sentry/node';

// DSN from env var (set via Secret Manager volume mount or .env)
const dsn = process.env.SENTRY_DSN || '';

if (dsn) {
  Sentry.init({
    dsn,

    // HIPAA: Never send PII automatically
    sendDefaultPii: false,

    // Sample 10% of transactions for performance monitoring
    tracesSampleRate: 0.1,

    // Environment and release tagging
    environment: process.env.NODE_ENV || 'production',
    release: process.env.K_REVISION || 'local',

    // PHI scrubbing: strip sensitive data before sending to Sentry
    beforeSend(event) {
      // Strip request body — may contain patient data
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers?.['cookie'];
        delete event.request.headers?.['authorization'];
      }

      // Strip user PII entirely
      delete event.user;

      // Scrub breadcrumbs that might contain PHI
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((crumb) => {
          // Remove HTTP request/response bodies from breadcrumbs
          if (crumb.category === 'http' && crumb.data) {
            delete crumb.data.request_body;
            delete crumb.data.response_body;
          }
          return crumb;
        });
      }

      return event;
    },

    // Ignore expected errors (rate limits, circuit breakers)
    ignoreErrors: [
      'BulkheadRejectedError',
      'Rate limit exceeded',
    ],
  });

  // eslint-disable-next-line no-console
  console.error('[sentry] Initialized with PHI scrubbing enabled');
} else {
  // eslint-disable-next-line no-console
  console.error('[sentry] No DSN configured — error tracking disabled');
}

export { Sentry };
