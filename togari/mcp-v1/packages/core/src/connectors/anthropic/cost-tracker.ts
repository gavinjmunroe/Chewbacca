import { MODELS } from '../../config/models';
import type { ModelId } from '../../config/models';

/**
 * Record of API usage for cost tracking
 */
export interface UsageRecord {
  /** User identifier */
  userId: string;
  /** Model used for the request */
  model: string;
  /** Number of input tokens used */
  inputTokens: number;
  /** Number of output tokens generated */
  outputTokens: number;
  /** Cost in dollars */
  cost: number;
  /** Task description or identifier */
  task: string;
  /** Timestamp of the request */
  timestamp: Date;
}

/**
 * Summary of usage statistics
 */
export interface UsageSummary {
  /** Total tokens used (input + output) */
  totalTokens: number;
  /** Total cost in dollars */
  totalCost: number;
  /** Usage breakdown by model */
  byModel: Record<string, { tokens: number; cost: number }>;
  /** Usage breakdown by task */
  byTask: Record<string, { tokens: number; cost: number }>;
}

/**
 * Parameters for recording usage
 */
export interface RecordUsageParams {
  userId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  task: string;
}

/**
 * Tracks API usage and costs for Claude completions
 */
export class CostTracker {
  private records: Map<string, UsageRecord[]>;

  constructor() {
    this.records = new Map();
  }

  /**
   * Record usage for a completion request
   * @param params - Usage parameters
   */
  recordUsage(params: RecordUsageParams): void {
    const cost = this.getCost(params.model, params.inputTokens, params.outputTokens);

    const record: UsageRecord = {
      userId: params.userId,
      model: params.model,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      cost,
      task: params.task,
      timestamp: new Date(),
    };

    const key = this.getRecordKey(params.userId, record.timestamp);
    const existingRecords = this.records.get(key) || [];
    existingRecords.push(record);
    this.records.set(key, existingRecords);
  }

  /**
   * Get usage summary for a user over a time period
   * @param userId - User identifier
   * @param period - Time period ('day' or 'month')
   * @returns Usage summary with totals and breakdowns
   */
  getUsage(userId: string, period: 'day' | 'month'): UsageSummary {
    const now = new Date();
    const records = this.getRecordsForPeriod(userId, now, period);

    let totalTokens = 0;
    let totalCost = 0;
    const byModel: Record<string, { tokens: number; cost: number }> = {};
    const byTask: Record<string, { tokens: number; cost: number }> = {};

    for (const record of records) {
      const tokens = record.inputTokens + record.outputTokens;
      totalTokens += tokens;
      totalCost += record.cost;

      // Aggregate by model
      if (!byModel[record.model]) {
        byModel[record.model] = { tokens: 0, cost: 0 };
      }
      byModel[record.model].tokens += tokens;
      byModel[record.model].cost += record.cost;

      // Aggregate by task
      if (!byTask[record.task]) {
        byTask[record.task] = { tokens: 0, cost: 0 };
      }
      byTask[record.task].tokens += tokens;
      byTask[record.task].cost += record.cost;
    }

    return {
      totalTokens,
      totalCost,
      byModel,
      byTask,
    };
  }

  /**
   * Calculate cost for a completion request
   * @param model - Model ID
   * @param inputTokens - Number of input tokens
   * @param outputTokens - Number of output tokens
   * @returns Cost in dollars
   */
  getCost(model: string, inputTokens: number, outputTokens: number): number {
    const modelInfo = MODELS[model as ModelId];

    if (!modelInfo) {
      // If model not found in config, return 0 cost
      // Could also throw an error or log a warning
      return 0;
    }

    const inputCost = (inputTokens * modelInfo.pricing.inputPerMillion) / 1_000_000;
    const outputCost = (outputTokens * modelInfo.pricing.outputPerMillion) / 1_000_000;

    return inputCost + outputCost;
  }

  /**
   * Generate a key for storing/retrieving records
   * @param userId - User identifier
   * @param timestamp - Record timestamp
   * @returns Storage key
   */
  private getRecordKey(userId: string, timestamp: Date): string {
    const dateStr = timestamp.toISOString().split('T')[0]; // YYYY-MM-DD
    return `${userId}:${dateStr}`;
  }

  /**
   * Get all records for a user within a time period
   * @param userId - User identifier
   * @param now - Current timestamp
   * @param period - Time period ('day' or 'month')
   * @returns Array of usage records
   */
  private getRecordsForPeriod(
    userId: string,
    now: Date,
    period: 'day' | 'month'
  ): UsageRecord[] {
    const results: UsageRecord[] = [];
    const startOfPeriod = this.getStartOfPeriod(now, period);

    // Iterate through all keys and filter matching records
    for (const [key, records] of this.records.entries()) {
      if (key.startsWith(`${userId}:`)) {
        for (const record of records) {
          if (record.timestamp >= startOfPeriod) {
            results.push(record);
          }
        }
      }
    }

    return results;
  }

  /**
   * Get the start of a time period
   * @param date - Reference date
   * @param period - Time period ('day' or 'month')
   * @returns Start of period timestamp
   */
  private getStartOfPeriod(date: Date, period: 'day' | 'month'): Date {
    const start = new Date(date);

    if (period === 'day') {
      start.setHours(0, 0, 0, 0);
    } else if (period === 'month') {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
    }

    return start;
  }
}
