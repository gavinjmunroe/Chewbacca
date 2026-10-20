/**
 * @togari/bma-content/services/providers/tool-registry
 * Central registry for all ToolProvider instances
 * Tracks provider health, routes operations, manages fallbacks
 */

import { ToolProvider, HealthCheckResult } from './tool-provider';
import { ExaProvider } from './exa-provider';
import { ClayProvider } from './clay-provider';
import { StructifyProvider } from './structify-provider';
import { GmailProvider } from './gmail-provider';
import { CalendarProvider } from './calendar-provider';
import { withRetry } from '../../lib/retry';
import { CircuitBreaker } from '../../lib/circuit-breaker';

export interface ProviderHealthDetail extends HealthCheckResult {
  circuit?: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount?: number;
}

export interface RegistryHealthCheckResult {
  healthy: boolean;
  timestamp: Date;
  providers: {
    [providerName: string]: ProviderHealthDetail;
  };
  failedProviders: string[];
  averageLatency_ms: number;
}

export class ToolRegistry {
  private providers: Map<string, ToolProvider> = new Map();
  private breakers: Map<string, CircuitBreaker> = new Map();
  private lastHealthCheck: RegistryHealthCheckResult | null = null;

  constructor() {
    this.initializeDefaultProviders();
  }

  /**
   * Initialize all default providers
   */
  private initializeDefaultProviders(): void {
    this.registerProvider(new ExaProvider());
    this.registerProvider(new ClayProvider());
    this.registerProvider(new StructifyProvider());
    this.registerProvider(new GmailProvider());
    this.registerProvider(new CalendarProvider());
  }

  /**
   * Register a provider (and create a circuit breaker for it)
   */
  registerProvider(provider: ToolProvider): void {
    this.providers.set(provider.name, provider);
    this.breakers.set(provider.name, new CircuitBreaker({
      name: provider.name,
      failureThreshold: 5,
      failureWindow: 60_000,
      resetTimeout: 300_000,
    }));
  }

  /**
   * Get a provider by name
   */
  getProvider(name: string): ToolProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Get a circuit breaker by provider name
   */
  getBreaker(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  /**
   * Get all registered providers
   */
  getAllProviders(): Map<string, ToolProvider> {
    return new Map(this.providers);
  }

  /**
   * Execute an operation through a specific provider.
   *
   * Execution pipeline:
   *   1. Circuit breaker gate — if OPEN, return fallback immediately
   *   2. Retry wrapper — 3 attempts with 1s/2s/4s exponential backoff
   *   3. On exhausted retries, attempt provider.fallback()
   */
  async execute<T = any>(providerName: string, operation: string, params: Record<string, any>): Promise<T> {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider not found: ${providerName}`);
    }

    const breaker = this.breakers.get(providerName)!;
    const label = `${providerName}.${operation}`;

    return breaker.execute<T>(
      // Primary path: retry wrapper around the real call
      () => withRetry<T>(
        () => provider.execute<T>(operation, params),
        { maxAttempts: 3, baseDelay: 1000, backoffMultiplier: 2, label },
      ),
      // Fallback when circuit is open
      () => {
        process.stderr.write(
          `[registry] ${label} circuit open — using fallback\n`,
        );
        // Synchronous fallback for circuit breaker — return a promise-resolved value.
        // The actual fallback is async, but CircuitBreaker.execute expects sync fallback.
        // We throw here so the outer catch handles it via provider.fallback().
        throw new Error(`Circuit open for ${providerName}`);
      },
    ).catch(async (error) => {
      // If circuit breaker or retry exhaustion fails, try provider fallback
      process.stderr.write(
        `[registry] ${label} failed after retries — attempting fallback: ${error instanceof Error ? error.message : error}\n`,
      );
      try {
        return await provider.fallback<T>(operation, params);
      } catch (fallbackError) {
        process.stderr.write(
          `[registry] ${label} fallback also failed: ${fallbackError instanceof Error ? fallbackError.message : fallbackError}\n`,
        );
        throw error; // Throw original error
      }
    });
  }

  /**
   * Health check all providers
   */
  async healthCheck(): Promise<RegistryHealthCheckResult> {
    const timestamp = new Date();
    const results: { [key: string]: ProviderHealthDetail } = {};
    const failedProviders: string[] = [];
    const latencies: number[] = [];

    const healthCheckPromises = Array.from(this.providers.entries()).map(async ([name, provider]) => {
      const breaker = this.breakers.get(name);
      try {
        const result = await provider.healthCheck();
        results[name] = {
          ...result,
          circuit: breaker?.getState(),
          failureCount: breaker?.getFailureCount(),
        };
        latencies.push(result.latency_ms);

        if (!result.healthy || breaker?.getState() === 'OPEN') {
          failedProviders.push(name);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        results[name] = {
          healthy: false,
          latency_ms: 0,
          error: errorMsg,
          lastChecked: timestamp,
          circuit: breaker?.getState(),
          failureCount: breaker?.getFailureCount(),
        };
        failedProviders.push(name);
      }
    });

    await Promise.all(healthCheckPromises);

    const averageLatency_ms = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

    const registryResult: RegistryHealthCheckResult = {
      healthy: failedProviders.length === 0,
      timestamp,
      providers: results,
      failedProviders,
      averageLatency_ms,
    };

    this.lastHealthCheck = registryResult;
    return registryResult;
  }

  /**
   * Get last recorded health check (without running a new one)
   */
  getLastHealthCheck(): RegistryHealthCheckResult | null {
    return this.lastHealthCheck;
  }

  /**
   * Check if a provider is healthy (from last health check)
   */
  isProviderHealthy(providerName: string): boolean {
    if (!this.lastHealthCheck) return false;
    const providerStatus = this.lastHealthCheck.providers[providerName];
    return providerStatus?.healthy ?? false;
  }

  /**
   * Get providers sorted by health status (healthy first)
   */
  getProvidersByHealth(): ToolProvider[] {
    if (!this.lastHealthCheck) {
      return Array.from(this.providers.values());
    }

    const sorted = Array.from(this.providers.entries())
      .sort(([nameA], [nameB]) => {
        const healthA = this.lastHealthCheck?.providers[nameA]?.healthy ?? false;
        const healthB = this.lastHealthCheck?.providers[nameB]?.healthy ?? false;
        return healthB === healthA ? 0 : healthB ? 1 : -1;
      });

    return sorted.map(([, provider]) => provider);
  }

  /**
   * Get provider statistics
   */
  getStatistics(): {
    totalProviders: number;
    healthyProviders: number;
    failedProviders: string[];
    operationMetrics: { [providerName: string]: { [operation: string]: number } };
  } {
    const stats = {
      totalProviders: this.providers.size,
      healthyProviders: 0,
      failedProviders: this.lastHealthCheck?.failedProviders ?? [],
      operationMetrics: {} as { [key: string]: { [key: string]: number } },
    };

    if (this.lastHealthCheck) {
      stats.healthyProviders = this.providers.size - this.lastHealthCheck.failedProviders.length;
    }

    return stats;
  }
}

/**
 * Singleton instance of the ToolRegistry
 */
let registryInstance: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!registryInstance) {
    registryInstance = new ToolRegistry();
  }
  return registryInstance;
}

export function resetToolRegistry(): void {
  registryInstance = null;
}
