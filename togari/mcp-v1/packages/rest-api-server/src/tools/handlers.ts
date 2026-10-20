import {
  CloudStorageClient,
  StructifyClient,
  ExaClient,
  DataProcessor,
  UploadPipeline,
  logger,
} from '@natural-language-mcp/core';
import type {
  ProcessFileParams,
  SearchEntitiesParams,
  EnrichEntityParams,
  GetJobStatusParams,
  PreviewFileParams,
} from './schemas';

export interface ToolServices {
  cloudStorage: CloudStorageClient;
  structify: StructifyClient;
  exa: ExaClient;
  dataProcessor: DataProcessor;
  uploadPipeline: UploadPipeline; // for preview
}

export async function handleProcessFile(
  params: ProcessFileParams,
  services: ToolServices,
  userId: string
): Promise<unknown> {
  try {
    // Decode base64 content
    const buffer = Buffer.from(params.content, 'base64');

    // Process through pipeline
    const result = await services.dataProcessor.processFile(
      buffer,
      params.fileName,
      params.mimeType,
      {
        entityType: params.entityType,
        userId,
        enrichWithExa: params.enrichWithExa,
        saveResults: true,
      }
    );

    return {
      success: true,
      jobId: result.job.id,
      status: result.job.status,
      totalRecords: result.job.totalRecords,
      successfulRecords: result.job.successfulRecords,
      downloadUrl: result.downloadUrl,
      steps: result.job.steps.map((s) => ({ name: s.name, status: s.status })),
    };
  } catch (error) {
    logger.error('Error processing file', error as Error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleSearchEntities(
  params: SearchEntitiesParams,
  services: ToolServices
): Promise<unknown> {
  try {
    const results = await services.exa.search(params.query, {
      numResults: params.limit,
      includeText: true,
    });

    return {
      success: true,
      query: params.query,
      resultCount: results.results.length,
      results: results.results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.text?.slice(0, 300),
        score: r.score,
      })),
    };
  } catch (error) {
    logger.error('Error searching entities', error as Error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleEnrichEntity(
  params: EnrichEntityParams,
  services: ToolServices
): Promise<unknown> {
  try {
    if (params.entityType === 'company') {
      const result = await services.exa.enrichCompany(params.identifier);
      return { success: true, entityType: 'company', data: result };
    } else {
      const result = await services.exa.enrichContact(params.identifier);
      return { success: true, entityType: 'contact', data: result };
    }
  } catch (error) {
    logger.error('Error enriching entity', error as Error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleGetJobStatus(
  params: GetJobStatusParams,
  services: ToolServices,
  userId: string
): Promise<unknown> {
  try {
    const job = await services.dataProcessor.getJob(params.jobId, userId);

    if (!job) {
      return { success: false, error: 'Job not found' };
    }

    return {
      success: true,
      job: {
        id: job.id,
        status: job.status,
        totalRecords: job.totalRecords,
        successfulRecords: job.successfulRecords,
        failedRecords: job.failedRecords,
        steps: job.steps,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
      },
    };
  } catch (error) {
    logger.error('Error getting job status', error as Error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handlePreviewFile(
  params: PreviewFileParams,
  services: ToolServices
): Promise<unknown> {
  try {
    // Decode content
    let content: string;
    try {
      content = Buffer.from(params.content, 'base64').toString('utf-8');
    } catch {
      content = params.content; // already plain text
    }

    // Determine file type from mime
    let fileType: 'csv' | 'xlsx' | 'json' = 'csv';
    if (params.mimeType.includes('json')) fileType = 'json';
    else if (params.mimeType.includes('spreadsheet') || params.mimeType.includes('excel'))
      fileType = 'xlsx';

    // Use upload pipeline for preview
    const result = await services.uploadPipeline.process(content, fileType, {
      entityType: params.entityType,
    });

    return {
      success: true,
      totalRows: result.totalRows,
      columnMapping: result.mapping,
      preview: result.preview,
      validationErrors: result.validationErrors,
    };
  } catch (error) {
    logger.error('Error previewing file', error as Error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
