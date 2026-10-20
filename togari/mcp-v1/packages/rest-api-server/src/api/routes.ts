import { Router, Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  ProcessFileInput,
  SearchEntitiesInput,
  EnrichEntityInput,
  GetJobStatusInput,
  PreviewFileInput,
} from '../tools/schemas';
import {
  handleProcessFile,
  handleSearchEntities,
  handleEnrichEntity,
  handleGetJobStatus,
  handlePreviewFile,
  ToolServices,
} from '../tools/handlers';
import { requestLogger } from './middleware';

const API_VERSION = '1.0.0';

export function createApiRouter(services: ToolServices): Router {
  const router = Router();

  // Apply request logging to all routes
  router.use(requestLogger);

  // GET /health - Health check endpoint
  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: API_VERSION,
    });
  });

  // GET /tools - List all available endpoints
  router.get('/tools', (_req: Request, res: Response) => {
    res.json({
      success: true,
      version: API_VERSION,
      endpoints: [
        {
          path: '/api/tools/process-file',
          method: 'POST',
          description: 'Upload and process a file for entity extraction and enrichment',
          parameters: {
            content: 'File content as base64 encoded string',
            fileName: 'Original file name with extension',
            mimeType: 'MIME type of the file',
            entityType: 'Type of entities: "company" or "contact"',
            enrichWithExa: 'Whether to enrich data using Exa (default: true)',
          },
        },
        {
          path: '/api/tools/search',
          method: 'POST',
          description: 'Search for entities using natural language queries',
          parameters: {
            query: 'Natural language search query',
            entityType: 'Type of entity: "company" or "contact"',
            limit: 'Maximum number of results (default: 10)',
            filters: 'Optional filters: { location, industry }',
          },
        },
        {
          path: '/api/tools/enrich',
          method: 'POST',
          description: 'Enrich a single entity with additional data',
          parameters: {
            identifier: 'Domain for companies, email or LinkedIn URL for contacts',
            entityType: 'Type of entity: "company" or "contact"',
          },
        },
        {
          path: '/api/tools/job-status',
          method: 'POST',
          description: 'Check the status of a processing job',
          parameters: {
            jobId: 'The job ID returned from process-file',
          },
        },
        {
          path: '/api/tools/preview',
          method: 'POST',
          description: 'Preview file parsing and column mapping without processing',
          parameters: {
            content: 'File content as base64 or raw text',
            fileName: 'Original file name',
            mimeType: 'MIME type of the file',
            entityType: 'Type of entities: "company" or "contact"',
          },
        },
      ],
    });
  });

  // POST /tools/process-file - Process uploaded file
  router.post('/tools/process-file', async (req: Request, res: Response) => {
    try {
      const params = ProcessFileInput.parse(req.body);
      // Use a default userId for API calls - in production this would come from auth
      const userId = req.headers['x-user-id'] as string || 'api-user';
      const result = await handleProcessFile(params, services, userId);
      res.json(result);
    } catch (error) {
      handleRouteError(error, res);
    }
  });

  // POST /tools/search - Search entities
  router.post('/tools/search', async (req: Request, res: Response) => {
    try {
      const params = SearchEntitiesInput.parse(req.body);
      const result = await handleSearchEntities(params, services);
      res.json(result);
    } catch (error) {
      handleRouteError(error, res);
    }
  });

  // POST /tools/enrich - Enrich single entity
  router.post('/tools/enrich', async (req: Request, res: Response) => {
    try {
      const params = EnrichEntityInput.parse(req.body);
      const result = await handleEnrichEntity(params, services);
      res.json(result);
    } catch (error) {
      handleRouteError(error, res);
    }
  });

  // POST /tools/job-status - Get job status
  router.post('/tools/job-status', async (req: Request, res: Response) => {
    try {
      const params = GetJobStatusInput.parse(req.body);
      const userId = req.headers['x-user-id'] as string || 'api-user';
      const result = await handleGetJobStatus(params, services, userId);
      res.json(result);
    } catch (error) {
      handleRouteError(error, res);
    }
  });

  // POST /tools/preview - Preview file parsing
  router.post('/tools/preview', async (req: Request, res: Response) => {
    try {
      const params = PreviewFileInput.parse(req.body);
      const result = await handlePreviewFile(params, services);
      res.json(result);
    } catch (error) {
      handleRouteError(error, res);
    }
  });

  return router;
}

/**
 * Handle route errors consistently
 */
function handleRouteError(error: unknown, res: Response): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: 'Validation error',
      details: error.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  if (error instanceof Error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
    return;
  }

  res.status(500).json({
    success: false,
    error: 'Unknown error occurred',
  });
}
