import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './router';
import { createContext } from './context';
import { amberWebhookRouter } from './routes/amber';
import { webhookRouter } from './routes/webhooks';
import { validateEnv } from './config/env-validation';
import { createLogger } from '@togari/core';
import { API_ROUTES, DEFAULT_VALUES } from './config/constants';
import { apiRateLimiter, webhookRateLimiter, healthCheckRateLimiter } from './middleware/rateLimiter';
import { requestIdMiddleware } from './middleware/requestId';
import { timeoutMiddleware } from './middleware/timeout';
import { securityHeadersMiddleware } from './middleware/securityHeaders';

// Load environment variables - dotenv will search upwards for .env file
dotenv.config();

const logger = createLogger('Server');

// Validate environment configuration at startup
try {
  validateEnv();
} catch (error) {
  logger.error('Environment validation failed', error instanceof Error ? error : new Error(String(error)));
  process.exit(1);
}

const app = express();
const PORT = parseInt(process.env.PORT || String(DEFAULT_VALUES.PORT), 10);

// CORS configuration - restrict to allowed origins
const allowedOrigins = (process.env.ALLOWED_ORIGINS || DEFAULT_VALUES.ALLOWED_ORIGINS)
  .split(',')
  .map((origin) => origin.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // Explicitly allow only configured origins
      // SECURITY: Always reject null origins and requests without origin headers
      // null origin can come from file://, data:, or sandboxed iframes - security risk
      if (!origin || origin === 'null') {
        return callback(new Error('Origin header required and must not be null'));
      }

      // Check if origin is in whitelist
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
  })
);

// Security headers middleware
app.use(securityHeadersMiddleware);

// Request ID middleware for tracing
app.use(requestIdMiddleware);

// Request timeout middleware (30 seconds)
app.use(timeoutMiddleware(30000));

app.use(express.json({ limit: DEFAULT_VALUES.REQUEST_SIZE_LIMIT }));

// Health check with rate limiting
app.get(API_ROUTES.HEALTH, healthCheckRateLimiter, (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// tRPC endpoint (for authenticated web app)
app.use(
  API_ROUTES.TRPC,
  apiRateLimiter,
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

// Amber webhook endpoint (API key auth)
app.use(API_ROUTES.AMBER_WEBHOOK, webhookRateLimiter, amberWebhookRouter);

// Clay/n8n webhook receivers
app.use(API_ROUTES.WEBHOOKS, webhookRateLimiter, webhookRouter);

// Start server
app.listen(PORT, () => {
  logger.info('Togari API started', {
    port: PORT,
    trpcEndpoint: API_ROUTES.TRPC,
    amberWebhook: `${API_ROUTES.AMBER_WEBHOOK}/submit`,
    webhooks: API_ROUTES.WEBHOOKS,
  });
});
