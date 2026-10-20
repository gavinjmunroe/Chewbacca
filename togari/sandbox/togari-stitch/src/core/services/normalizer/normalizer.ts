import { z } from 'zod';
import { AnthropicClient, CostTracker } from '../../connectors';
import { ModelSelector } from './model-selector';
import {
  fillTemplate,
  NORMALIZE_COMPANY_PROMPT,
  NORMALIZE_CONTACT_PROMPT,
  COMPANY_SCHEMA_DESCRIPTION,
  CONTACT_SCHEMA_DESCRIPTION,
} from './prompts';
import { CompanySchema, ContactSchema, Company, Contact } from '../../schemas';
import { ValidationError } from '../../errors';
import { createLogger } from '../../utils/logger';

const logger = createLogger('Normalizer');

/**
 * Options for normalization operations
 */
export interface NormalizerOptions {
  /** Force a specific model instead of auto-selecting */
  forceModel?: string;
  /** Maximum number of retries for failed operations */
  maxRetries?: number;
  /** Whether to track costs (default: true) */
  trackCost?: boolean;
  /** User ID for cost tracking */
  userId?: string;
}

/**
 * Result of a normalization operation
 */
export interface NormalizerResult<T> {
  /** The normalized data */
  data: T;
  /** Confidence score (0-1) */
  confidence: number;
  /** Any issues encountered during normalization */
  issues: string[];
  /** Model used for normalization */
  model: string;
  /** Token usage statistics */
  tokensUsed: {
    input: number;
    output: number;
  };
}

/**
 * Default options for normalization
 */
const DEFAULT_OPTIONS: Required<Omit<NormalizerOptions, 'forceModel' | 'userId'>> = {
  maxRetries: 2,
  trackCost: true,
};

/**
 * Service for normalizing raw lead data using Claude AI
 */
export class Normalizer {
  private anthropic: AnthropicClient;
  private modelSelector: ModelSelector;
  private costTracker?: CostTracker;

  /**
   * Create a new Normalizer instance
   * @param anthropic - AnthropicClient for API calls
   * @param modelSelector - ModelSelector for choosing appropriate models
   * @param costTracker - Optional CostTracker for usage tracking
   */
  constructor(
    anthropic: AnthropicClient,
    modelSelector: ModelSelector,
    costTracker?: CostTracker
  ) {
    this.anthropic = anthropic;
    this.modelSelector = modelSelector;
    this.costTracker = costTracker;
  }

  /**
   * Normalize raw company data
   * @param rawData - Raw company data from any source
   * @param source - Source identifier (e.g., 'csv', 'api', 'manual')
   * @param options - Normalization options
   * @returns Normalized company data with metadata
   */
  async normalizeCompany(
    rawData: unknown,
    source: string,
    options?: NormalizerOptions
  ): Promise<NormalizerResult<Company>> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    logger.info('Starting company normalization', { source });

    // Estimate complexity to select appropriate model
    const complexity = this.modelSelector.estimateComplexity(rawData);
    const model = opts.forceModel || this.modelSelector.select('normalization', { complexity });

    logger.debug('Model selected for normalization', { model, complexity });

    // Build prompt
    const prompt = fillTemplate(NORMALIZE_COMPANY_PROMPT, {
      rawData: JSON.stringify(rawData, null, 2),
      schemaDescription: COMPANY_SCHEMA_DESCRIPTION,
    });

    // Call Claude API with retries
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
      try {
        const result = await this.anthropic.complete({
          model,
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 2000,
        });

        // Parse Claude's response
        const parsed = this.parseClaudeResponse(result.content);

        // Validate and coerce data against schema
        const validation = this.validateAndCoerce(parsed.data, CompanySchema);

        if (!validation.valid || !validation.data) {
          throw new ValidationError(
            `Failed to validate normalized company data: ${validation.errors.join(', ')}`
          );
        }

        // Track cost if enabled
        if (this.costTracker && opts.trackCost && opts.userId) {
          this.costTracker.recordUsage({
            userId: opts.userId,
            model: result.model,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            task: 'company_normalization',
          });
        }

        logger.info('Company normalization completed', {
          source,
          model: result.model,
          confidence: parsed.confidence,
          issueCount: parsed.issues.length,
        });

        return {
          data: validation.data,
          confidence: parsed.confidence,
          issues: [...parsed.issues, ...validation.errors],
          model: result.model,
          tokensUsed: {
            input: result.usage.inputTokens,
            output: result.usage.outputTokens,
          },
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn(`Normalization attempt ${attempt + 1} failed`, {
          error: lastError.message,
          attempt: attempt + 1,
          maxRetries: opts.maxRetries,
        });

        if (attempt < opts.maxRetries) {
          // Wait before retry with exponential backoff
          await this.delay(Math.pow(2, attempt) * 1000);
        }
      }
    }

    logger.error('Company normalization failed after all retries', lastError);
    throw lastError || new Error('Normalization failed');
  }

  /**
   * Normalize raw contact data
   * @param rawData - Raw contact data from any source
   * @param source - Source identifier (e.g., 'csv', 'api', 'manual')
   * @param options - Normalization options
   * @returns Normalized contact data with metadata
   */
  async normalizeContact(
    rawData: unknown,
    source: string,
    options?: NormalizerOptions
  ): Promise<NormalizerResult<Contact>> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    logger.info('Starting contact normalization', { source });

    // Estimate complexity to select appropriate model
    const complexity = this.modelSelector.estimateComplexity(rawData);
    const model = opts.forceModel || this.modelSelector.select('normalization', { complexity });

    logger.debug('Model selected for normalization', { model, complexity });

    // Build prompt
    const prompt = fillTemplate(NORMALIZE_CONTACT_PROMPT, {
      rawData: JSON.stringify(rawData, null, 2),
      schemaDescription: CONTACT_SCHEMA_DESCRIPTION,
    });

    // Call Claude API with retries
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
      try {
        const result = await this.anthropic.complete({
          model,
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 2000,
        });

        // Parse Claude's response
        const parsed = this.parseClaudeResponse(result.content);

        // Validate and coerce data against schema
        const validation = this.validateAndCoerce(parsed.data, ContactSchema);

        if (!validation.valid || !validation.data) {
          throw new ValidationError(
            `Failed to validate normalized contact data: ${validation.errors.join(', ')}`
          );
        }

        // Track cost if enabled
        if (this.costTracker && opts.trackCost && opts.userId) {
          this.costTracker.recordUsage({
            userId: opts.userId,
            model: result.model,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            task: 'contact_normalization',
          });
        }

        logger.info('Contact normalization completed', {
          source,
          model: result.model,
          confidence: parsed.confidence,
          issueCount: parsed.issues.length,
        });

        return {
          data: validation.data,
          confidence: parsed.confidence,
          issues: [...parsed.issues, ...validation.errors],
          model: result.model,
          tokensUsed: {
            input: result.usage.inputTokens,
            output: result.usage.outputTokens,
          },
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn(`Normalization attempt ${attempt + 1} failed`, {
          error: lastError.message,
          attempt: attempt + 1,
          maxRetries: opts.maxRetries,
        });

        if (attempt < opts.maxRetries) {
          // Wait before retry with exponential backoff
          await this.delay(Math.pow(2, attempt) * 1000);
        }
      }
    }

    logger.error('Contact normalization failed after all retries', lastError);
    throw lastError || new Error('Normalization failed');
  }

  /**
   * Normalize raw data based on entity type
   * @param rawData - Raw data from any source
   * @param entityType - Type of entity to normalize
   * @param source - Source identifier
   * @param options - Normalization options
   * @returns Normalized data with metadata
   */
  async normalize(
    rawData: unknown,
    entityType: 'company' | 'contact',
    source: string,
    options?: NormalizerOptions
  ): Promise<NormalizerResult<Company | Contact>> {
    if (entityType === 'company') {
      return this.normalizeCompany(rawData, source, options);
    } else {
      return this.normalizeContact(rawData, source, options);
    }
  }

  /**
   * Parse Claude's response content to extract normalized data
   * @param content - Raw response content from Claude
   * @returns Parsed response with data, confidence, and issues
   * @throws ValidationError if response is not valid JSON
   */
  private parseClaudeResponse(content: string): {
    data: unknown;
    confidence: number;
    issues: string[];
  } {
    // Strip markdown code blocks if present
    let jsonContent = content.trim();

    // Handle ```json ... ``` format
    const jsonBlockMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonBlockMatch) {
      jsonContent = jsonBlockMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(jsonContent);

      // Extract structured response or treat entire response as data
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'data' in parsed
      ) {
        return {
          data: parsed.data,
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
          issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        };
      }

      // If no structured format, treat entire response as data
      return {
        data: parsed,
        confidence: 0.7,
        issues: ['Response was not in expected structured format'],
      };
    } catch (error) {
      logger.error('Failed to parse Claude response as JSON', error, {
        contentPreview: content.substring(0, 200),
      });
      throw new ValidationError(
        `Failed to parse Claude response as JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Validate and coerce data against a Zod schema
   * @param data - Data to validate
   * @param schema - Zod schema to validate against
   * @returns Validation result with coerced data or errors
   */
  private validateAndCoerce<T>(
    data: unknown,
    schema: z.ZodSchema<T>
  ): { valid: boolean; data: T | null; errors: string[] } {
    const result = schema.safeParse(data);

    if (result.success) {
      return {
        valid: true,
        data: result.data,
        errors: [],
      };
    }

    const errors = result.error.errors.map((err) => {
      const path = err.path.join('.');
      return path ? `${path}: ${err.message}` : err.message;
    });

    return {
      valid: false,
      data: null,
      errors,
    };
  }

  /**
   * Delay execution for a specified duration
   * @param ms - Milliseconds to delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get the Anthropic client for advanced operations
   * @returns AnthropicClient instance
   */
  getClient(): AnthropicClient {
    return this.anthropic;
  }

  /**
   * Get the model selector for model selection
   * @returns ModelSelector instance
   */
  getModelSelector(): ModelSelector {
    return this.modelSelector;
  }

  /**
   * Get the cost tracker for usage tracking
   * @returns CostTracker instance or undefined
   */
  getCostTracker(): CostTracker | undefined {
    return this.costTracker;
  }
}
