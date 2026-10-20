import { Normalizer } from './normalizer';
import {
  fillTemplate,
  NORMALIZE_BATCH_PROMPT,
  COMPANY_SCHEMA_DESCRIPTION,
  CONTACT_SCHEMA_DESCRIPTION,
} from './prompts';
import { Company, Contact } from '../../schemas';
import { createLogger } from '../../utils/logger';

const logger = createLogger('BatchNormalizer');

/**
 * Options for batch normalization operations
 */
export interface BatchOptions {
  /** Number of records per chunk (default: 10) */
  chunkSize?: number;
  /** Maximum parallel chunk operations (default: 3) */
  maxParallel?: number;
  /** Continue processing on individual failures (default: true) */
  continueOnError?: boolean;
  /** Callback for progress updates */
  onProgress?: (progress: BatchProgress) => void;
  /** Force a specific model instead of auto-selecting */
  forceModel?: string;
  /** User ID for cost tracking */
  userId?: string;
}

/**
 * Progress information for batch operations
 */
export interface BatchProgress {
  /** Total number of records to process */
  total: number;
  /** Number of successfully completed records */
  completed: number;
  /** Number of failed records */
  failed: number;
  /** Current chunk being processed (1-indexed) */
  currentChunk: number;
  /** Total number of chunks */
  totalChunks: number;
  /** Estimated time remaining in milliseconds */
  estimatedTimeRemaining?: number;
}

/**
 * Result for a single item in a batch
 */
export interface BatchItemResult<T> {
  /** Index of the item in the original array */
  index: number;
  /** Whether normalization succeeded */
  success: boolean;
  /** Normalized data (if successful) */
  data?: T;
  /** Confidence score (0-1) */
  confidence?: number;
  /** Issues encountered during normalization */
  issues?: string[];
  /** Error message (if failed) */
  error?: string;
}

/**
 * Result of a batch normalization operation
 */
export interface BatchResult<T> {
  /** Results for each item in the batch */
  results: BatchItemResult<T>[];
  /** Number of successfully processed items */
  succeeded: number;
  /** Number of failed items */
  failed: number;
  /** Total token usage */
  totalTokens: {
    input: number;
    output: number;
  };
  /** Total cost in dollars */
  totalCost: number;
}

/**
 * Default batch options
 */
const DEFAULT_BATCH_OPTIONS: Required<Omit<BatchOptions, 'onProgress' | 'forceModel' | 'userId'>> = {
  chunkSize: 10,
  maxParallel: 3,
  continueOnError: true,
};

/**
 * Service for batch normalization of multiple records
 */
export class BatchNormalizer {
  private normalizer: Normalizer;

  /**
   * Create a new BatchNormalizer instance
   * @param normalizer - Normalizer instance to use for processing
   */
  constructor(normalizer: Normalizer) {
    this.normalizer = normalizer;
  }

  /**
   * Normalize a batch of records
   * @param records - Array of raw records to normalize
   * @param entityType - Type of entity ('company' or 'contact')
   * @param source - Source identifier
   * @param options - Batch processing options
   * @returns Batch result with all processed items
   */
  async normalizeBatch<T extends Company | Contact>(
    records: unknown[],
    entityType: 'company' | 'contact',
    source: string,
    options?: BatchOptions
  ): Promise<BatchResult<T>> {
    const opts = { ...DEFAULT_BATCH_OPTIONS, ...options };
    const { chunkSize, maxParallel, continueOnError, onProgress } = opts;

    logger.info('Starting batch normalization', {
      recordCount: records.length,
      entityType,
      source,
      chunkSize,
      maxParallel,
    });

    // Split records into chunks
    const chunks: unknown[][] = [];
    for (let i = 0; i < records.length; i += chunkSize) {
      chunks.push(records.slice(i, i + chunkSize));
    }

    const totalChunks = chunks.length;
    let completed = 0;
    let failed = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;
    const allResults: BatchItemResult<T>[] = [];
    const startTime = Date.now();

    // Create chunk processors with their starting indices
    const chunkData = chunks.map((chunk, index) => ({
      chunk,
      startIndex: index * chunkSize,
      chunkIndex: index,
    }));

    // Process chunks with controlled concurrency
    const chunkResults = await this.processWithConcurrency(
      chunkData,
      async (data, _) => {
        const { chunk, startIndex, chunkIndex } = data;

        try {
          const result = await this.normalizeChunk<T>(
            chunk,
            startIndex,
            entityType,
            source,
            opts
          );

          // Update progress
          for (const item of result.items) {
            if (item.success) {
              completed++;
            } else {
              failed++;
            }
          }

          // Accumulate token usage and cost
          totalInputTokens += result.tokensUsed.input;
          totalOutputTokens += result.tokensUsed.output;
          totalCost += result.cost;

          // Report progress
          if (onProgress) {
            const elapsed = Date.now() - startTime;
            const completedChunks = completed + failed > 0
              ? Math.ceil((completed + failed) / chunkSize)
              : 0;
            const remainingChunks = totalChunks - completedChunks;
            const avgTimePerChunk = completedChunks > 0
              ? elapsed / completedChunks
              : 0;
            const estimatedTimeRemaining = remainingChunks > 0
              ? Math.round(remainingChunks * avgTimePerChunk)
              : 0;

            onProgress({
              total: records.length,
              completed,
              failed,
              currentChunk: chunkIndex + 1,
              totalChunks,
              estimatedTimeRemaining,
            });
          }

          return result.items;
        } catch (error) {
          logger.error('Chunk processing failed', error, {
            chunkIndex,
            startIndex,
          });

          if (!continueOnError) {
            throw error;
          }

          // Mark all items in chunk as failed
          return chunk.map((_, i): BatchItemResult<T> => {
            failed++;
            return {
              index: startIndex + i,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            };
          });
        }
      },
      maxParallel
    );

    // Flatten and sort results by index
    for (const chunkResult of chunkResults) {
      allResults.push(...chunkResult);
    }
    allResults.sort((a, b) => a.index - b.index);

    logger.info('Batch normalization completed', {
      total: records.length,
      succeeded: completed,
      failed,
      totalTokens: totalInputTokens + totalOutputTokens,
      totalCost,
    });

    return {
      results: allResults,
      succeeded: completed,
      failed,
      totalTokens: {
        input: totalInputTokens,
        output: totalOutputTokens,
      },
      totalCost,
    };
  }

  /**
   * Normalize a chunk of records in a single API call
   * @param chunk - Array of records to normalize
   * @param startIndex - Starting index in the original array
   * @param entityType - Type of entity
   * @param source - Source identifier
   * @param options - Batch options
   * @returns Chunk results with items, tokens, and cost
   */
  private async normalizeChunk<T extends Company | Contact>(
    chunk: unknown[],
    startIndex: number,
    entityType: 'company' | 'contact',
    _source: string,
    options: BatchOptions
  ): Promise<{
    items: BatchItemResult<T>[];
    tokensUsed: { input: number; output: number };
    cost: number;
  }> {
    const client = this.normalizer.getClient();
    const modelSelector = this.normalizer.getModelSelector();
    const costTracker = this.normalizer.getCostTracker();

    // Select appropriate schema description
    const schemaDescription = entityType === 'company'
      ? COMPANY_SCHEMA_DESCRIPTION
      : CONTACT_SCHEMA_DESCRIPTION;

    // Estimate complexity for model selection
    const complexity = modelSelector.estimateComplexity(chunk);
    const model = options.forceModel || modelSelector.select('normalization', { complexity });

    // Build batch prompt
    const prompt = fillTemplate(NORMALIZE_BATCH_PROMPT, {
      entityType,
      rawRecords: JSON.stringify(chunk, null, 2),
      schemaDescription,
    });

    logger.debug('Processing chunk', {
      chunkSize: chunk.length,
      startIndex,
      model,
    });

    // Call Claude API
    const result = await client.complete({
      model,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4000 * chunk.length, // Scale tokens with chunk size
    });

    // Parse response
    const parsed = this.parseChunkResponse<T>(result.content, chunk.length);

    // Map results to BatchItemResult with correct indices
    const items: BatchItemResult<T>[] = parsed.map((item, i) => ({
      index: startIndex + i,
      success: item.success,
      data: item.data,
      confidence: item.confidence,
      issues: item.issues,
      error: item.error,
    }));

    // Calculate cost
    const cost = costTracker?.getCost(
      result.model,
      result.usage.inputTokens,
      result.usage.outputTokens
    ) ?? 0;

    // Track cost if enabled
    if (costTracker && options.userId) {
      costTracker.recordUsage({
        userId: options.userId,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        task: `batch_${entityType}_normalization`,
      });
    }

    return {
      items,
      tokensUsed: {
        input: result.usage.inputTokens,
        output: result.usage.outputTokens,
      },
      cost,
    };
  }

  /**
   * Parse Claude's response for a batch of records
   * @param content - Raw response content
   * @param expectedCount - Expected number of results
   * @returns Array of parsed results
   */
  private parseChunkResponse<T>(
    content: string,
    expectedCount: number
  ): Array<{
    success: boolean;
    data?: T;
    confidence?: number;
    issues?: string[];
    error?: string;
  }> {
    // Strip markdown code blocks if present
    let jsonContent = content.trim();
    const jsonBlockMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonBlockMatch) {
      jsonContent = jsonBlockMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(jsonContent);

      if (!Array.isArray(parsed)) {
        logger.warn('Batch response was not an array, wrapping');
        return [{
          success: true,
          data: parsed.data ?? parsed,
          confidence: parsed.confidence ?? 0.7,
          issues: parsed.issues ?? ['Response was not in expected array format'],
        }];
      }

      // Map each result
      return parsed.map((item: unknown, index: number) => {
        if (typeof item !== 'object' || item === null) {
          return {
            success: false,
            error: `Invalid item at index ${index}: expected object`,
          };
        }

        const obj = item as Record<string, unknown>;

        // Check if item has explicit error
        if ('error' in obj && typeof obj.error === 'string') {
          return {
            success: false,
            error: obj.error,
            issues: Array.isArray(obj.issues) ? obj.issues as string[] : undefined,
          };
        }

        // Extract normalized data
        const data = ('data' in obj ? obj.data : obj) as T;
        const confidence = typeof obj.confidence === 'number' ? obj.confidence : 0.7;
        const issues = Array.isArray(obj.issues)
          ? (obj.issues as string[])
          : [];

        return {
          success: true,
          data,
          confidence,
          issues,
        };
      });
    } catch (error) {
      logger.error('Failed to parse batch response', error, {
        contentPreview: content.substring(0, 200),
      });

      // Return failures for all expected items
      return Array.from({ length: expectedCount }, () => ({
        success: false,
        error: `Failed to parse response: ${error instanceof Error ? error.message : String(error)}`,
      }));
    }
  }

  /**
   * Process items with controlled concurrency
   * @param items - Items to process
   * @param processor - Processing function
   * @param maxParallel - Maximum concurrent operations
   * @returns Results in order
   */
  private async processWithConcurrency<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    maxParallel: number
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let currentIndex = 0;
    const inProgress: Promise<void>[] = [];

    const processNext = async (): Promise<void> => {
      while (currentIndex < items.length) {
        const index = currentIndex++;
        const item = items[index];

        const process = async (): Promise<void> => {
          results[index] = await processor(item, index);
        };

        const task = process();
        inProgress.push(task);

        // If we've reached max parallel, wait for one to complete
        if (inProgress.length >= maxParallel) {
          await Promise.race(inProgress);
          // Remove completed promises
          for (let i = inProgress.length - 1; i >= 0; i--) {
            // Check if promise is settled by racing with an immediate resolve
            const settled = await Promise.race([
              inProgress[i].then(() => true).catch(() => true),
              Promise.resolve(false),
            ]);
            if (settled) {
              inProgress.splice(i, 1);
            }
          }
        }
      }
    };

    // Start processing
    await processNext();

    // Wait for all remaining tasks
    await Promise.all(inProgress);

    return results;
  }
}
