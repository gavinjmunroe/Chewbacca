/**
 * @togari/api-server/routes/files
 * File processing API endpoints
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { logger, type FileType } from '@natural-language-mcp/core';
import type { Services } from '../services';
import { handleError, getOrganizationId } from '../middleware';

const processFileSchema = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  content: z.string(), // Base64 encoded
  entityType: z.enum(['company', 'contact']),
  enrichWithExa: z.boolean().default(false),
  enrichWithClay: z.boolean().default(false),
});

const previewFileSchema = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  content: z.string(), // Base64 encoded
  entityType: z.enum(['company', 'contact']),
});

/**
 * Determine file type from filename extension
 */
function getFileType(fileName: string): FileType {
  const ext = fileName.toLowerCase().split('.').pop();
  switch (ext) {
    case 'csv':
      return 'csv';
    case 'xlsx':
    case 'xls':
      return 'xlsx';
    case 'json':
      return 'json';
    default:
      return 'csv'; // Default to CSV
  }
}

export function createFilesRouter(services: Services): Router {
  const router = Router();

  /**
   * POST /api/v1/files/process
   * Process a file (upload, structure, enrich, save)
   */
  router.post('/process', async (req: Request, res: Response): Promise<void> => {
    try {
      const parseResult = processFileSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation Error',
          details: parseResult.error.errors,
        });
        return;
      }

      const { fileName, mimeType, content, entityType, enrichWithExa } = parseResult.data;
      const organizationId = getOrganizationId(req);

      if (!organizationId) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'organizationId is required',
        });
        return;
      }

      logger.info('Processing file', { fileName, entityType, enrichWithExa });

      // Decode base64 content
      const fileBuffer = Buffer.from(content, 'base64');

      // Check if dataProcessor is available
      if (!services.dataProcessor) {
        res.status(503).json({
          error: 'Service Unavailable',
          message: 'File processing is not available. Exa API must be configured.',
        });
        return;
      }

      // Process file through the data processor
      const result = await services.dataProcessor.processFile(
        fileBuffer,
        fileName,
        mimeType,
        {
          entityType,
          userId: organizationId,
          enrichWithExa: enrichWithExa && !!services.exa,
          saveResults: true,
        }
      );

      logger.info('File processing completed', {
        jobId: result.job.id,
        status: result.job.status,
        totalRecords: result.job.totalRecords,
      });

      res.json({
        success: true,
        jobId: result.job.id,
        status: result.job.status,
        totalRecords: result.job.totalRecords,
        successfulRecords: result.job.successfulRecords,
        failedRecords: result.job.failedRecords,
        downloadUrl: result.downloadUrl,
        steps: result.job.steps,
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * POST /api/v1/files/preview
   * Preview file parsing and column mapping without full processing
   */
  router.post('/preview', async (req: Request, res: Response): Promise<void> => {
    try {
      const parseResult = previewFileSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation Error',
          details: parseResult.error.errors,
        });
        return;
      }

      const { fileName, content, entityType } = parseResult.data;

      logger.info('Previewing file', { fileName, entityType });

      // Decode base64 content
      const fileContent = Buffer.from(content, 'base64').toString('utf-8');
      const fileType = getFileType(fileName);

      // Preview through upload pipeline with validateOnly option
      const result = await services.uploadPipeline.process(
        fileContent,
        fileType,
        {
          entityType,
          validateOnly: true,
        }
      );

      res.json({
        success: true,
        fileName,
        entityType,
        totalRows: result.totalRows,
        parsedRows: result.parsedRows,
        columnMapping: result.mapping,
        preview: result.preview?.slice(0, 5), // First 5 rows
        validationErrors: result.validationErrors,
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * GET /api/v1/files/jobs/:jobId
   * Get status of a file processing job
   */
  router.get('/jobs/:jobId', async (req: Request, res: Response): Promise<void> => {
    try {
      const { jobId } = req.params;
      const organizationId = getOrganizationId(req);

      if (!organizationId) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'organizationId is required',
        });
        return;
      }

      if (!services.dataProcessor) {
        res.status(503).json({
          error: 'Service Unavailable',
          message: 'File processing is not available.',
        });
        return;
      }

      const job = await services.dataProcessor.getJob(jobId, organizationId);

      if (!job) {
        res.status(404).json({
          error: 'Not Found',
          message: `Job with ID ${jobId} not found`,
        });
        return;
      }

      res.json({
        jobId: job.id,
        status: job.status,
        totalRecords: job.totalRecords,
        successfulRecords: job.successfulRecords,
        failedRecords: job.failedRecords,
        steps: job.steps,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * GET /api/v1/files/list
   * List uploaded files
   */
  router.get('/list', async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = getOrganizationId(req);
      const { prefix } = req.query;

      if (!organizationId) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'organizationId is required',
        });
        return;
      }

      const filePrefix = (prefix as string) || 'uploads';
      const files = await services.cloudStorage.listFiles(filePrefix, organizationId);

      res.json({
        success: true,
        files: files.map(f => ({
          id: f.id,
          name: f.originalName,
          path: f.path,
          size: f.size,
          mimeType: f.mimeType,
          uploadedAt: f.uploadedAt,
        })),
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  /**
   * POST /api/v1/files/upload
   * Upload a file to cloud storage
   */
  router.post('/upload', async (req: Request, res: Response): Promise<void> => {
    try {
      const { fileName, mimeType, content } = req.body;
      const organizationId = getOrganizationId(req);

      if (!organizationId) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'organizationId is required',
        });
        return;
      }

      if (!fileName || !content) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'fileName and content are required',
        });
        return;
      }

      // Decode base64 content
      const fileBuffer = Buffer.from(content, 'base64');

      // Upload to cloud storage
      const result = await services.cloudStorage.uploadFile(fileBuffer, {
        fileName: `${Date.now()}_${fileName}`,
        mimeType: mimeType || 'application/octet-stream',
        userId: organizationId,
        folder: 'uploads',
        metadata: {
          organizationId,
          originalFileName: fileName,
        },
      });

      logger.info('File uploaded', { fileName, organizationId });

      res.json({
        success: true,
        fileName,
        path: result.path,
        size: result.size,
        mimeType: result.mimeType,
        gsUrl: result.gsUrl,
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  return router;
}
