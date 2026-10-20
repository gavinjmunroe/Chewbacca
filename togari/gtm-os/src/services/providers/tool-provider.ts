/**
 * @togari/bma-content/services/providers
 * ToolProvider interface: abstraction layer for external API dependencies
 * Decouples tool implementations from specific API clients
 * Supports: Exa, Clay, Structify, Gmail, Calendar
 */

export interface HealthCheckResult {
  healthy: boolean;
  latency_ms: number;
  error?: string;
  lastChecked?: Date;
}

export interface ToolProvider {
  /**
   * Provider name for logging and registry tracking
   */
  name: string;

  /**
   * Execute an operation on this provider
   * @param operation The specific operation to perform (e.g., "search", "enrich_contact")
   * @param params Operation-specific parameters
   * @returns Promise resolving to operation result with type T
   */
  execute<T = any>(operation: string, params: Record<string, any>): Promise<T>;

  /**
   * Health check for this provider
   * @returns Health status including latency and optional error details
   */
  healthCheck(): Promise<HealthCheckResult>;

  /**
   * Fallback execution when primary provider fails
   * Returns a degraded result or cached data
   * @param operation The operation being performed
   * @param params Operation parameters
   * @returns Promise resolving to fallback result with type T
   */
  fallback<T = any>(operation: string, params: Record<string, any>): Promise<T>;
}

/**
 * Base abstract class for common provider patterns
 */
export abstract class BaseToolProvider implements ToolProvider {
  abstract name: string;

  protected lastHealthCheck: Date | null = null;
  protected lastHealthStatus: HealthCheckResult | null = null;
  protected operationMetrics: Map<string, { count: number; totalLatency: number }> = new Map();

  abstract execute<T = any>(operation: string, params: Record<string, any>): Promise<T>;

  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      // Subclasses override with specific health check logic
      const latency_ms = Date.now() - startTime;
      const result: HealthCheckResult = {
        healthy: true,
        latency_ms,
        lastChecked: new Date(),
      };
      this.lastHealthStatus = result;
      this.lastHealthCheck = new Date();
      return result;
    } catch (error) {
      const latency_ms = Date.now() - startTime;
      const result: HealthCheckResult = {
        healthy: false,
        latency_ms,
        error: error instanceof Error ? error.message : String(error),
        lastChecked: new Date(),
      };
      this.lastHealthStatus = result;
      return result;
    }
  }

  async fallback<T = any>(operation: string, params: Record<string, any>): Promise<T> {
    // Default fallback: return empty or cached result
    // Subclasses override with specific fallback strategies
    throw new Error(`No fallback implemented for ${this.name}.${operation}`);
  }

  /**
   * Record operation metrics for monitoring
   */
  protected recordMetric(operation: string, latency_ms: number): void {
    const existing = this.operationMetrics.get(operation) || { count: 0, totalLatency: 0 };
    existing.count++;
    existing.totalLatency += latency_ms;
    this.operationMetrics.set(operation, existing);
  }

  /**
   * Get average latency for an operation
   */
  getAverageLatency(operation: string): number {
    const metric = this.operationMetrics.get(operation);
    if (!metric || metric.count === 0) return 0;
    return metric.totalLatency / metric.count;
  }
}
