import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Server } from 'http';
import { logger } from '@natural-language-mcp/core';
import { createApiRouter } from './routes';
import { errorHandler, validateApiKey } from './middleware';
import { ToolServices } from '../tools/handlers';

const API_VERSION = '1.0.0';

/**
 * Creates and starts the Express API server
 */
export async function createApiServer(
  services: ToolServices,
  port: number
): Promise<Server> {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS - permissive settings for development
  app.use(
    cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-user-id'],
    })
  );

  // Body parsing with large limit for file uploads
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '100mb' }));

  // Optional API key validation
  app.use(validateApiKey);

  // Root route - API info
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'Natural Language Processing API',
      version: API_VERSION,
      description: 'REST API for data enrichment using Structify and Exa',
      endpoints: {
        health: 'GET /api/health',
        tools: 'GET /api/tools',
        processFile: 'POST /api/tools/process-file',
        search: 'POST /api/tools/search',
        enrich: 'POST /api/tools/enrich',
        jobStatus: 'POST /api/tools/job-status',
        preview: 'POST /api/tools/preview',
      },
      documentation: 'GET /api/tools for detailed endpoint information',
    });
  });

  // Mount API routes
  const apiRouter = createApiRouter(services);
  app.use('/api', apiRouter);

  // 404 handler for unknown routes
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: 'Endpoint not found',
      hint: 'Visit / or /api/tools for available endpoints',
    });
  });

  // Global error handler
  app.use(errorHandler);

  // Start server
  return new Promise((resolve, reject) => {
    try {
      const server = app.listen(port, () => {
        logger.info(`API Server started on port ${port}`, {
          port,
          version: API_VERSION,
          endpoints: '/api/tools',
        });
      });

      server.on('error', (err) => {
        reject(err);
      });

      resolve(server);
    } catch (err) {
      reject(err);
    }
  });
}
