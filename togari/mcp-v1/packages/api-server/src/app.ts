/**
 * @togari/api-server/app
 * Express application setup and configuration
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { logger } from '@natural-language-mcp/core';
import type { Services } from './services';

// Import routes
import { createPeopleRouter } from './routes/people';
import { createCompaniesRouter } from './routes/companies';
import { createCampaignsRouter } from './routes/campaigns';
import { createTouchpointsRouter } from './routes/touchpoints';
import { createRelationshipsRouter } from './routes/relationships';
import { createWebhooksRouter } from './routes/webhooks';
import { createAmberRouter } from './routes/amber';
import { createEnrichmentRouter } from './routes/enrichment';
import { createFilesRouter } from './routes/files';

/**
 * Create and configure Express application
 */
export function createApp(services: Services): Express {
  const app = express();

  // Security middleware
  app.use(helmet());

  // CORS configuration
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Organization-ID'],
  }));

  // Compression
  app.use(compression());

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs
    message: { error: 'Too many requests, please try again later' },
  });
  app.use('/api/', limiter);

  // Body parsing
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug('Incoming request', {
      method: req.method,
      path: req.path,
      query: req.query,
      ip: req.ip,
    });
    next();
  });

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
  });

  // API routes
  const apiRouter = express.Router();

  // Entity CRUD routes
  apiRouter.use('/people', createPeopleRouter(services));
  apiRouter.use('/companies', createCompaniesRouter(services));
  apiRouter.use('/campaigns', createCampaignsRouter(services));
  apiRouter.use('/touchpoints', createTouchpointsRouter(services));
  apiRouter.use('/relationships', createRelationshipsRouter(services));

  // Webhook routes
  apiRouter.use('/webhooks', createWebhooksRouter(services));

  // Amber integration
  apiRouter.use('/amber', createAmberRouter(services));

  // Enrichment routes
  apiRouter.use('/enrichment', createEnrichmentRouter(services));

  // File processing routes
  apiRouter.use('/files', createFilesRouter(services));

  // Mount API router
  app.use('/api/v1', apiRouter);

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: 'Not Found',
      message: 'The requested endpoint does not exist',
    });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error', err);
    res.status(500).json({
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred',
    });
  });

  return app;
}
