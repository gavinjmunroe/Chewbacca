import { MODEL_IDS, ModelId } from '../../config/models';

/**
 * Task types that require model selection
 */
export type TaskType = 'normalization' | 'enrichment' | 'search' | 'classification';

/**
 * Complexity levels for model selection
 */
export type ComplexityLevel = 'low' | 'medium' | 'high';

/**
 * Options for model selection
 */
export interface ModelSelectionOptions {
  /** Estimated complexity of the task */
  complexity?: ComplexityLevel;
  /** Whether accuracy is critical (use more capable model) */
  highAccuracy?: boolean;
  /** Maximum cost tolerance (use cheaper model if possible) */
  lowCost?: boolean;
}

/**
 * Model selection thresholds
 */
const COMPLEXITY_THRESHOLDS = {
  /** Data size threshold for medium complexity (bytes) */
  mediumSize: 1000,
  /** Data size threshold for high complexity (bytes) */
  highSize: 5000,
  /** Field count threshold for medium complexity */
  mediumFields: 10,
  /** Field count threshold for high complexity */
  highFields: 25,
};

/**
 * Service for selecting appropriate Claude models based on task requirements
 */
export class ModelSelector {
  /**
   * Select a model based on task type and options
   * @param task - Type of task to perform
   * @param options - Selection options
   * @returns Model ID to use
   */
  select(task: TaskType, options?: ModelSelectionOptions): ModelId {
    const complexity = options?.complexity ?? 'medium';
    const highAccuracy = options?.highAccuracy ?? false;
    const lowCost = options?.lowCost ?? false;

    // High accuracy always uses Sonnet or Opus
    if (highAccuracy) {
      return complexity === 'high' ? MODEL_IDS.OPUS : MODEL_IDS.SONNET;
    }

    // Low cost always uses Haiku
    if (lowCost) {
      return MODEL_IDS.HAIKU;
    }

    // Select based on task and complexity
    switch (task) {
      case 'normalization':
        return this.selectForNormalization(complexity);
      case 'enrichment':
        return this.selectForEnrichment(complexity);
      case 'search':
        return this.selectForSearch(complexity);
      case 'classification':
        return this.selectForClassification(complexity);
      default:
        return MODEL_IDS.SONNET;
    }
  }

  /**
   * Estimate complexity from raw data
   * @param data - Raw data to analyze
   * @returns Estimated complexity level
   */
  estimateComplexity(data: unknown): ComplexityLevel {
    if (data === null || data === undefined) {
      return 'low';
    }

    // Estimate size
    const serialized = JSON.stringify(data);
    const size = serialized.length;

    // Count fields for objects/arrays
    let fieldCount = 0;
    if (Array.isArray(data)) {
      fieldCount = data.length;
      if (data.length > 0 && typeof data[0] === 'object') {
        fieldCount += Object.keys(data[0] as object).length;
      }
    } else if (typeof data === 'object') {
      fieldCount = this.countNestedFields(data as Record<string, unknown>);
    }

    // Determine complexity based on size and field count
    if (size >= COMPLEXITY_THRESHOLDS.highSize || fieldCount >= COMPLEXITY_THRESHOLDS.highFields) {
      return 'high';
    }

    if (size >= COMPLEXITY_THRESHOLDS.mediumSize || fieldCount >= COMPLEXITY_THRESHOLDS.mediumFields) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Select model for normalization tasks
   */
  private selectForNormalization(complexity: ComplexityLevel): ModelId {
    switch (complexity) {
      case 'low':
        return MODEL_IDS.HAIKU;
      case 'medium':
        return MODEL_IDS.SONNET;
      case 'high':
        return MODEL_IDS.SONNET;
    }
  }

  /**
   * Select model for enrichment tasks
   */
  private selectForEnrichment(complexity: ComplexityLevel): ModelId {
    switch (complexity) {
      case 'low':
        return MODEL_IDS.HAIKU;
      case 'medium':
        return MODEL_IDS.SONNET;
      case 'high':
        return MODEL_IDS.OPUS;
    }
  }

  /**
   * Select model for search tasks
   */
  private selectForSearch(complexity: ComplexityLevel): ModelId {
    // Search typically benefits from faster models
    switch (complexity) {
      case 'low':
        return MODEL_IDS.HAIKU;
      case 'medium':
        return MODEL_IDS.HAIKU;
      case 'high':
        return MODEL_IDS.SONNET;
    }
  }

  /**
   * Select model for classification tasks
   */
  private selectForClassification(complexity: ComplexityLevel): ModelId {
    switch (complexity) {
      case 'low':
        return MODEL_IDS.HAIKU;
      case 'medium':
        return MODEL_IDS.SONNET;
      case 'high':
        return MODEL_IDS.SONNET;
    }
  }

  /**
   * Count nested fields in an object
   */
  private countNestedFields(obj: Record<string, unknown>, depth = 0): number {
    if (depth > 3) return 0; // Limit recursion depth

    let count = Object.keys(obj).length;

    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        count += this.countNestedFields(value as Record<string, unknown>, depth + 1);
      }
    }

    return count;
  }
}
