import { CloudStorageClient, StoredFile } from '../../connectors/gcp';
import { StructifyClient, ExtractionResult } from '../../connectors/structify';
import { ExaClient, CompanyEnrichmentResult, ContactEnrichmentResult } from '../../connectors/exa';
import { createLogger } from '../../utils';
import { v4 as uuid } from 'uuid';
import {
  EntityType,
  ProcessingOptions,
  ProcessingStep,
  ProcessingJob,
  ProcessingResult,
} from './types';

const logger = createLogger('DataProcessor');

/**
 * Data processing pipeline that orchestrates Cloud Storage, Structify, and Exa
 */
export class DataProcessor {
  constructor(
    private cloudStorage: CloudStorageClient,
    private structify: StructifyClient,
    private exa: ExaClient
  ) {}

  /**
   * Process a file through the complete pipeline
   * @param fileContent - Raw file content
   * @param fileName - Original file name
   * @param mimeType - File MIME type
   * @param options - Processing options
   * @returns Processing result with job details and data
   */
  async processFile(
    fileContent: Buffer,
    fileName: string,
    mimeType: string,
    options: ProcessingOptions
  ): Promise<ProcessingResult> {
    const job = this.createJob(options);

    logger.info('Starting file processing', {
      jobId: job.id,
      fileName,
      entityType: options.entityType,
      userId: options.userId,
    });

    try {
      job.status = 'processing';
      await this.saveJob(job);

      // Step 1: Upload raw file to Cloud Storage
      this.updateStep(job, 'upload', 'running');
      const rawFile = await this.cloudStorage.uploadFile(fileContent, {
        fileName,
        mimeType,
        userId: options.userId,
        folder: 'raw',
        metadata: {
          jobId: job.id,
          entityType: options.entityType,
        },
      });
      job.rawFile = rawFile;
      this.updateStep(job, 'upload', 'completed', { rawFile });
      await this.saveJob(job);

      logger.info('Raw file uploaded', { jobId: job.id, path: rawFile.path });

      // Step 2: Extract structure with Structify
      this.updateStep(job, 'structure', 'running');
      const structuredData = await this.structify.extractFromFile(
        fileContent,
        fileName,
        mimeType
      );
      job.structuredData = structuredData;
      job.totalRecords = structuredData.totalRecords;
      this.updateStep(job, 'structure', 'completed', {
        recordCount: structuredData.totalRecords,
        status: structuredData.status,
      });
      await this.saveJob(job);

      logger.info('Data structured', {
        jobId: job.id,
        recordCount: structuredData.totalRecords,
        status: structuredData.status,
      });

      // Step 3: Enrich with Exa (if enabled)
      let enrichedData: Array<CompanyEnrichmentResult | ContactEnrichmentResult> = [];
      const shouldEnrich = options.enrichWithExa !== false;

      if (shouldEnrich && structuredData.records.length > 0) {
        this.updateStep(job, 'enrich', 'running');
        try {
          enrichedData = await this.enrichRecords(
            structuredData.records.map((r) => r.data),
            options.entityType,
            options.enrichmentFields
          );
          job.enrichedData = enrichedData;
          job.successfulRecords = enrichedData.length;
          job.failedRecords = structuredData.totalRecords - enrichedData.length;
          this.updateStep(job, 'enrich', 'completed', {
            enrichedCount: enrichedData.length,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error('Enrichment failed', error, { jobId: job.id });
          this.updateStep(job, 'enrich', 'failed', undefined);
          const step = job.steps.find((s) => s.name === 'enrich');
          if (step) step.error = errorMessage;
        }
        await this.saveJob(job);
      } else {
        this.updateStep(job, 'enrich', 'skipped');
        job.successfulRecords = structuredData.totalRecords;
      }

      // Step 4: Combine and save results to Cloud Storage
      const finalData = this.combineResults(structuredData, enrichedData, options.entityType);
      let resultFile: StoredFile | undefined;
      let downloadUrl: string | undefined;

      const shouldSave = options.saveResults !== false;
      if (shouldSave) {
        this.updateStep(job, 'save', 'running');
        resultFile = await this.cloudStorage.saveJson(
          {
            jobId: job.id,
            entityType: options.entityType,
            totalRecords: finalData.length,
            processedAt: new Date().toISOString(),
            records: finalData,
          },
          {
            fileName: `${job.id}-results.json`,
            mimeType: 'application/json',
            userId: options.userId,
            folder: 'results',
            metadata: {
              jobId: job.id,
              entityType: options.entityType,
              recordCount: String(finalData.length),
            },
          }
        );
        job.resultFile = resultFile;
        this.updateStep(job, 'save', 'completed', { resultFile });

        // Generate signed download URL
        downloadUrl = await this.cloudStorage.getSignedUrl(resultFile.path, 60);
        await this.saveJob(job);

        logger.info('Results saved', { jobId: job.id, path: resultFile.path });
      } else {
        this.updateStep(job, 'save', 'skipped');
      }

      // Mark job as completed
      job.status = 'completed';
      job.completedAt = new Date();
      job.updatedAt = new Date();
      await this.saveJob(job);

      logger.info('Processing completed', {
        jobId: job.id,
        totalRecords: job.totalRecords,
        successfulRecords: job.successfulRecords,
        failedRecords: job.failedRecords,
      });

      return {
        job,
        data: finalData,
        downloadUrl,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Processing failed', error, { jobId: job.id });

      job.status = 'failed';
      job.updatedAt = new Date();

      // Mark current running step as failed
      const runningStep = job.steps.find((s) => s.status === 'running');
      if (runningStep) {
        runningStep.status = 'failed';
        runningStep.completedAt = new Date();
        runningStep.error = errorMessage;
      }

      await this.saveJob(job);

      throw error;
    }
  }

  /**
   * Enrich records using Exa
   * @param records - Records to enrich
   * @param entityType - Type of entity
   * @param fields - Specific fields to enrich
   * @returns Array of enrichment results
   */
  private async enrichRecords(
    records: Array<Record<string, unknown>>,
    entityType: EntityType,
    fields?: string[]
  ): Promise<Array<CompanyEnrichmentResult | ContactEnrichmentResult>> {
    const results: Array<CompanyEnrichmentResult | ContactEnrichmentResult> = [];
    const delayMs = 200; // Rate limiting delay between requests

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      try {
        let enrichment: CompanyEnrichmentResult | ContactEnrichmentResult;

        if (entityType === 'company') {
          // Extract domain from record
          const domain = this.extractDomain(record);
          if (!domain) {
            logger.warn('No domain found for company record', { index: i });
            continue;
          }
          enrichment = await this.exa.enrichCompany(domain);
        } else {
          // Extract identifier for contact
          const identifier = this.extractContactIdentifier(record);
          if (!identifier) {
            logger.warn('No identifier found for contact record', { index: i });
            continue;
          }
          enrichment = await this.exa.enrichContact(identifier);
        }

        // Filter to specific fields if requested
        if (fields && fields.length > 0) {
          enrichment = this.filterEnrichmentFields(enrichment, fields);
        }

        results.push(enrichment);

        // Rate limiting delay
        if (i < records.length - 1) {
          await this.delay(delayMs);
        }
      } catch (error) {
        logger.warn('Failed to enrich record', {
          index: i,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with other records
      }
    }

    return results;
  }

  /**
   * Extract domain from a company record
   */
  private extractDomain(record: Record<string, unknown>): string | null {
    // Try common field names
    const domainFields = ['domain', 'website', 'url', 'company_website', 'web'];
    for (const field of domainFields) {
      const value = record[field];
      if (typeof value === 'string' && value.length > 0) {
        // Extract domain from URL if needed
        try {
          if (value.includes('://')) {
            return new URL(value).hostname.replace(/^www\./, '');
          }
          return value.replace(/^www\./, '');
        } catch {
          return value;
        }
      }
    }
    return null;
  }

  /**
   * Extract identifier from a contact record
   */
  private extractContactIdentifier(record: Record<string, unknown>): string | null {
    // Try email first
    const emailFields = ['email', 'e-mail', 'mail', 'contact_email'];
    for (const field of emailFields) {
      const value = record[field];
      if (typeof value === 'string' && value.includes('@')) {
        return value;
      }
    }

    // Try LinkedIn URL
    const linkedinFields = ['linkedin', 'linkedin_url', 'linkedinUrl'];
    for (const field of linkedinFields) {
      const value = record[field];
      if (typeof value === 'string' && value.includes('linkedin.com')) {
        return value;
      }
    }

    // Try name + company combination
    const nameFields = ['name', 'full_name', 'fullName', 'contact_name'];
    const companyFields = ['company', 'organization', 'employer'];
    let name: string | null = null;
    let company: string | null = null;

    for (const field of nameFields) {
      const value = record[field];
      if (typeof value === 'string' && value.length > 0) {
        name = value;
        break;
      }
    }

    for (const field of companyFields) {
      const value = record[field];
      if (typeof value === 'string' && value.length > 0) {
        company = value;
        break;
      }
    }

    if (name && company) {
      return `${name} at ${company}`;
    }

    return name;
  }

  /**
   * Filter enrichment result to specific fields
   */
  private filterEnrichmentFields(
    enrichment: CompanyEnrichmentResult | ContactEnrichmentResult,
    fields: string[]
  ): CompanyEnrichmentResult | ContactEnrichmentResult {
    const enrichmentRecord = enrichment as unknown as Record<string, unknown>;
    const filtered: Record<string, unknown> = {};
    for (const field of fields) {
      if (field in enrichmentRecord) {
        filtered[field] = enrichmentRecord[field];
      }
    }
    // Always include sources and confidence
    if ('sources' in enrichmentRecord) filtered.sources = enrichmentRecord.sources;
    if ('confidence' in enrichmentRecord) filtered.confidence = enrichmentRecord.confidence;
    if ('domain' in enrichmentRecord) filtered.domain = enrichmentRecord.domain;
    return filtered as unknown as CompanyEnrichmentResult | ContactEnrichmentResult;
  }

  /**
   * Combine structured and enriched data
   */
  private combineResults(
    structuredData: ExtractionResult,
    enrichedData: Array<CompanyEnrichmentResult | ContactEnrichmentResult>,
    _entityType: EntityType
  ): Array<Record<string, unknown>> {
    return structuredData.records.map((record, index) => {
      const enrichment = enrichedData[index];
      return {
        _index: record.index,
        _source: record.source,
        _confidence: record.confidence,
        ...record.data,
        ...(enrichment ? { _enrichment: enrichment } : {}),
      };
    });
  }

  /**
   * Create a new processing job
   */
  private createJob(options: ProcessingOptions): ProcessingJob {
    const now = new Date();
    return {
      id: uuid(),
      userId: options.userId,
      status: 'pending',
      entityType: options.entityType,
      rawFile: {} as StoredFile, // Will be populated after upload
      steps: [
        { name: 'upload', status: 'pending' },
        { name: 'structure', status: 'pending' },
        { name: 'enrich', status: 'pending' },
        { name: 'save', status: 'pending' },
      ],
      totalRecords: 0,
      successfulRecords: 0,
      failedRecords: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Update a processing step
   */
  private updateStep(
    job: ProcessingJob,
    stepName: string,
    status: ProcessingStep['status'],
    result?: unknown
  ): void {
    let step = job.steps.find((s) => s.name === stepName);
    if (!step) {
      step = { name: stepName, status: 'pending' };
      job.steps.push(step);
    }

    step.status = status;

    if (status === 'running') {
      step.startedAt = new Date();
    } else if (status === 'completed' || status === 'failed' || status === 'skipped') {
      step.completedAt = new Date();
    }

    if (result !== undefined) {
      step.result = result;
    }

    job.updatedAt = new Date();
  }

  /**
   * Get a job by ID
   * @param jobId - Job ID
   * @param userId - User ID for access control
   * @returns Job or null if not found
   */
  async getJob(jobId: string, userId: string): Promise<ProcessingJob | null> {
    try {
      const path = `jobs/${userId}/${jobId}.json`;
      const exists = await this.cloudStorage.fileExists(path);
      if (!exists) {
        return null;
      }
      return await this.cloudStorage.readJson<ProcessingJob>(path);
    } catch (error) {
      logger.warn('Failed to load job', {
        jobId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Save job state to Cloud Storage
   */
  private async saveJob(job: ProcessingJob): Promise<void> {
    try {
      await this.cloudStorage.saveJson(job, {
        fileName: `${job.id}.json`,
        mimeType: 'application/json',
        userId: job.userId,
        folder: `jobs/${job.userId}`,
      });
    } catch (error) {
      logger.error('Failed to save job', error, { jobId: job.id });
      // Don't throw - job saving failure shouldn't stop processing
    }
  }

  /**
   * Delay helper for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
