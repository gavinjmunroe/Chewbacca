import { FileParser, FileType } from './parser';
import { DataValidator } from './validators';
import { ColumnMapper, ColumnMapping } from './column-mapper';
import { BatchNormalizer, Normalizer, BatchOptions } from '../normalizer';
import { ModelSelector } from '../normalizer/model-selector';
import { AnthropicClient } from '../../connectors';
import { Company, Contact } from '../../schemas';
import { createLogger } from '../../utils';
import { validateFileSize, validateRowCount, TenantTier } from './limits';
import { deduplicateRows } from './deduplicator';
import { publishEntityEvent } from '../event-publisher';

const logger = createLogger('UploadPipeline');

/**
 * Options for the upload pipeline
 */
export interface UploadOptions {
  /** Type of entity to process */
  entityType: 'company' | 'contact';
  /** Manual column mapping override */
  columnMapping?: ColumnMapping;
  /** Skip normalization step (default false) */
  skipNormalization?: boolean;
  /** Only validate without processing (default false) */
  validateOnly?: boolean;
  /** User ID for tracking */
  userId?: string;
  /** Batch processing options */
  batchOptions?: Partial<BatchOptions>;
  /** Tenant client_id — injected into every row */
  clientId?: string;
  /** Tenant tier for row limit enforcement */
  tier?: TenantTier;
}

/**
 * Result of the upload pipeline processing
 */
export interface UploadResult {
  /** Total rows in the file */
  totalRows: number;
  /** Number of rows successfully parsed */
  parsedRows: number;
  /** Number of rows successfully normalized */
  normalizedRows: number;
  /** Number of rows that failed processing */
  failedRows: number;
  /** Number of duplicate rows removed */
  duplicatesRemoved: number;
  /** Column mapping used */
  mapping: ColumnMapping;
  /** Validation errors by row */
  validationErrors: Array<{ row: number; errors: string[] }>;
  /** Preview of first 5 rows showing original and normalized data */
  preview?: Array<{ original: unknown; normalized: unknown }>;
}

/**
 * Pipeline for processing uploaded files through parsing, mapping,
 * validation, deduplication, and normalization stages
 */
export class UploadPipeline {
  constructor(
    private readonly fileParser: FileParser,
    private readonly columnMapper: ColumnMapper,
    private readonly batchNormalizer: BatchNormalizer,
    private readonly validator: DataValidator
  ) {}

  /**
   * Process an uploaded file through the complete pipeline
   * @param fileContent - Raw file content as string or Buffer
   * @param fileType - Type of file (csv, xlsx, json)
   * @param options - Processing options
   * @returns Upload result with statistics and preview
   */
  async process(
    fileContent: string | Buffer,
    fileType: FileType,
    options: UploadOptions
  ): Promise<UploadResult> {
    logger.info('Starting upload pipeline', {
      fileType,
      entityType: options.entityType,
      validateOnly: options.validateOnly,
      skipNormalization: options.skipNormalization,
      clientId: options.clientId,
      tier: options.tier,
    });

    // Step 0: Validate file size (50MB max)
    const sizeBytes = Buffer.isBuffer(fileContent)
      ? fileContent.length
      : Buffer.byteLength(fileContent, 'utf-8');
    validateFileSize(sizeBytes);

    // Step 1: Parse the file (now async for ExcelJS streaming)
    const parseResult = await this.fileParser.parse(fileContent, fileType);
    logger.info('File parsed', {
      headers: parseResult.headers,
      rowCount: parseResult.rowCount,
      issues: parseResult.issues,
    });

    // Step 1.5: Validate row count against tier limits
    validateRowCount(parseResult.rowCount, options.tier ?? 'pro');

    // Step 2: Determine column mapping
    const mapping = options.columnMapping ?? this.columnMapper.inferMapping(
      parseResult.headers,
      options.entityType
    );
    logger.info('Column mapping determined', { mapping });

    // Step 3: Apply column mapping to rows
    let mappedRows = this.applyMapping(parseResult.rows, mapping);
    logger.info('Mapping applied', { mappedRowCount: mappedRows.length });

    // Step 3.5: Inject client_id on every row
    if (options.clientId) {
      for (const row of mappedRows) {
        row.client_id = options.clientId;
      }
    }

    // Step 3.6: Deduplicate rows (by email + linkedin)
    const dedupResult = deduplicateRows(mappedRows);
    const duplicatesRemoved = dedupResult.duplicates.length;
    if (duplicatesRemoved > 0) {
      logger.info('Duplicates removed', {
        removed: duplicatesRemoved,
        remaining: dedupResult.unique.length,
      });
    }
    mappedRows = dedupResult.unique;

    // Step 4: Validate mapped data
    const validationResult = this.validator.validate(mappedRows, options.entityType);

    // Group errors by row
    const errorsByRow = new Map<number, string[]>();
    for (const err of validationResult.errors) {
      const existing = errorsByRow.get(err.row) || [];
      existing.push(err.message);
      errorsByRow.set(err.row, existing);
    }
    const groupedValidationErrors = Array.from(errorsByRow.entries()).map(
      ([row, errors]) => ({ row, errors })
    );

    logger.info('Validation complete', {
      valid: validationResult.valid,
      errorCount: validationResult.errors.length,
      warningCount: validationResult.warnings.length,
    });

    // Step 5: If validateOnly, return early with preview
    if (options.validateOnly) {
      const preview = mappedRows.slice(0, 5).map((row) => ({
        original: row,
        normalized: null,
      }));

      return {
        totalRows: parseResult.rowCount,
        parsedRows: mappedRows.length,
        normalizedRows: 0,
        failedRows: groupedValidationErrors.length,
        duplicatesRemoved,
        mapping,
        validationErrors: groupedValidationErrors,
        preview,
      };
    }

    // Step 6: If skipNormalization, return mapped data
    if (options.skipNormalization) {
      return {
        totalRows: parseResult.rowCount,
        parsedRows: mappedRows.length,
        normalizedRows: 0,
        failedRows: groupedValidationErrors.length,
        duplicatesRemoved,
        mapping,
        validationErrors: groupedValidationErrors,
      };
    }

    // Step 7: Normalize using batch normalizer with progress events
    const totalRows = mappedRows.length;
    let lastReportedChunk = 0;

    const batchResult = await this.batchNormalizer.normalizeBatch<Company | Contact>(
      mappedRows,
      options.entityType,
      'upload',
      {
        ...options.batchOptions,
        userId: options.userId,
        onProgress: (progress) => {
          // Emit progress event roughly every 100 records (or on chunk boundaries)
          const processed = progress.completed + progress.failed;
          if (progress.currentChunk !== lastReportedChunk && (processed % 100 < 20 || processed === totalRows)) {
            lastReportedChunk = progress.currentChunk;
            publishEntityEvent('file_processed', 'file', fileType, {
              clientId: options.clientId,
              processedRows: processed,
              totalRows,
              percentComplete: Math.round((processed / totalRows) * 100),
              chunk: `${progress.currentChunk}/${progress.totalChunks}`,
            }).catch(() => { /* fire and forget */ });
          }
        },
      }
    );

    logger.info('Normalization complete', {
      succeeded: batchResult.succeeded,
      failed: batchResult.failed,
      totalTokens: batchResult.totalTokens,
    });

    // Step 8: Build preview of first 5 rows
    const preview = mappedRows.slice(0, 5).map((original, index) => {
      const result = batchResult.results.find((r) => r.index === index);
      return {
        original,
        normalized: result?.success ? result.data : null,
      };
    });

    // Step 9: Return complete result
    return {
      totalRows: parseResult.rowCount,
      parsedRows: mappedRows.length,
      normalizedRows: batchResult.succeeded,
      failedRows: batchResult.failed + groupedValidationErrors.length,
      duplicatesRemoved,
      mapping,
      validationErrors: groupedValidationErrors,
      preview,
    };
  }

  /**
   * Apply column mapping to transform rows
   * @param rows - Original rows from parsed file
   * @param mapping - Column mapping configuration
   * @returns Transformed rows with mapped field names
   */
  private applyMapping(
    rows: Record<string, unknown>[],
    mapping: ColumnMapping
  ): Record<string, unknown>[] {
    return rows.map((row) => {
      const mapped: Record<string, unknown> = {};
      const unmapped: Record<string, unknown> = {};

      for (const [sourceColumn, value] of Object.entries(row)) {
        const targetField = mapping.mappings[sourceColumn];

        if (targetField) {
          // Handle nested fields (e.g., "location.city")
          if (targetField.includes('.')) {
            const parts = targetField.split('.');
            let current = mapped;

            for (let i = 0; i < parts.length - 1; i++) {
              const part = parts[i];
              if (!current[part] || typeof current[part] !== 'object') {
                current[part] = {};
              }
              current = current[part] as Record<string, unknown>;
            }

            current[parts[parts.length - 1]] = value;
          } else {
            mapped[targetField] = value;
          }
        } else {
          // Put unmapped columns in _unmapped field
          unmapped[sourceColumn] = value;
        }
      }

      if (Object.keys(unmapped).length > 0) {
        mapped._unmapped = unmapped;
      }

      return mapped;
    });
  }
}

/**
 * Factory function to create an UploadPipeline with all dependencies
 * @param anthropicClient - Anthropic API client
 * @returns Configured UploadPipeline instance
 */
export function createUploadPipeline(anthropicClient: AnthropicClient): UploadPipeline {
  // Create dependencies
  const modelSelector = new ModelSelector();
  const normalizer = new Normalizer(anthropicClient, modelSelector);
  const batchNormalizer = new BatchNormalizer(normalizer);
  const fileParser = new FileParser();
  const columnMapper = new ColumnMapper();
  const validator = new DataValidator();

  return new UploadPipeline(fileParser, columnMapper, batchNormalizer, validator);
}
