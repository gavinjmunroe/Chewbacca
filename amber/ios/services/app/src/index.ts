// Environment variables loaded via tsx --env-file flag
// Now import everything else
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config/env.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerContactRoutes } from './routes/contacts.js';
import { registerPipelineRoutes } from './routes/pipelines.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerIdentityRoutes } from './routes/identity.js';
import { registerAnchorRoutes } from './routes/anchor.js';
import { registerInsightRoutes } from './routes/insights.js';
import { registerOnboardingRoutes } from './routes/onboarding.js';
import { registerProfileRoutes } from './routes/profile.js';
import { registerPrivacyRoutes } from './routes/privacy.js';
import { registerSignalRoutes } from './routes/signals.js';
import { registerCircleRoutes } from './routes/circles.js';
import { registerAccountRoutes } from './routes/account.js';
import { handleError } from './util/errors.js';
import { registerGlobalRateLimit } from './util/ratelimit.js';
import './pipeline/nodes/registry.js';

const app = Fastify({
  logger: true,
  requestIdLogLabel: 'reqId',
  disableRequestLogging: false,
  // Behind Railway/Cloud Run proxies, trust the first hop so request.ip
  // reflects the real client and our rate limiter keys correctly.
  trustProxy: true,
});

// CORS — explicit allowlist instead of `origin: true` which echoes any origin.
// Native iOS clients don't send Origin so they're unaffected; this only
// constrains browser callers. Set CORS_ALLOWED_ORIGINS=https://a,https://b
// to widen.
const defaultOrigins = config.isProduction
  ? ['https://amber.app', 'https://www.amber.app']
  : true;
const envOrigins = process.env.CORS_ALLOWED_ORIGINS;
const allowedOrigins = envOrigins
  ? envOrigins.split(',').map((s) => s.trim()).filter(Boolean)
  : defaultOrigins;

await app.register(cors, {
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});

// Minimal security headers (avoids new dependency on @fastify/helmet to keep
// the existing pnpm lockfile valid).
app.addHook('onSend', async (_req, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  return payload;
});

// Global rate limit (disabled for /health). Per-user keyed once auth ran.
registerGlobalRateLimit(app);

// Global error handler
app.setErrorHandler((error, request, reply) => {
  const { code, message, statusCode, context } = handleError(error);
  app.log.error({ error, code, context, reqId: request.id }, message);
  reply.code(statusCode).send({ error: code, message, ...context });
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// Legacy / infrastructure
await app.register(registerHealthRoutes);
await app.register(registerAuthRoutes);
await app.register(registerContactRoutes);
await app.register(registerPipelineRoutes);
await app.register(registerAiRoutes);
await app.register(registerIdentityRoutes);
await app.register(registerAnchorRoutes);
await app.register(registerInsightRoutes);

// GCP+Onboarding+Auth
await app.register(registerOnboardingRoutes);
await app.register(registerProfileRoutes);

// Sprint 1 MVP
await app.register(registerPrivacyRoutes);    // PRIVACY-01
await app.register(registerSignalRoutes);     // SIGNAL-01/02/03/04/05
await app.register(registerCircleRoutes);     // SOCIAL-01
await app.register(registerAccountRoutes);    // Account lifecycle (App Store deletion compliance)

// ─── Server ───────────────────────────────────────────────────────────────────

app.listen({ port: config.server.port, host: config.server.host }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`🚀 Amber API listening on ${config.server.host}:${config.server.port}`);
  app.log.info(`✅ Privy configured: ${config.privy.appId ? config.privy.appId.substring(0, 8) + '...' : 'missing'}`);
  app.log.info(`📊 Sentry DSN: ${config.sentry.dsn ? 'configured' : 'not set (optional)'}`);
});

// Export for Cloud Functions (if needed)
export const http = app;
