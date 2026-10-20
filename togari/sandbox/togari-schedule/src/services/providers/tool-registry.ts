/**
 * @togari/bma-content/services/providers/tool-registry
 * Central registry for all ToolProvider instances
 * Tracks provider health, routes operations, manages fallbacks
 *
 * Uses @togari/admin's buildConnectorPolicy for retry + circuit breaker + bulkhead.
 */

import { ToolProvider, HealthCheckResult } from './tool-provider';
import { ExaProvider } from './exa-provider';
import { ClayProvider } from './clay-provider';
import { StructifyProvider } from './structify-provider';
import { GmailProvider } from './gmail-provider';
import { CalendarProvider } from './calendar-provider';
import { buildConnectorPolicy, type ConnectorPolicy } from '@togari/admin';

export interface ProviderHealthDetail extends HealthCheckResult {
  circuit?: 'closed' | 'open' | 'half-open';
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
  private policies: Map<string, ConnectorPolicy> = new Map();
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
   * Register a provider (and create a resilience policy for it)
   */
  registerProvider(provider: ToolProvider): void {
    this.providers.set(provider.name, provider);
    this.policies.set(provider.name, buildConnectorPolicy({
      name: provider.name,
      timeoutMs: 30_000,
      retryAttempts: 3,
      retryBaseMs: 1000,
      cbThresholdPct: 0.5,
      cbHalfOpenAfterMs: 300_000,
      bulkheadConcurrency: 10,
      bulkheadQueue: 5,
    }));
  }

  /**
   * Get a provider by name
   */
  getProvider(name: string): ToolProvider | undefined {
    return this.providers.get(name);
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
   * Execution pipeline (via @togari/admin ConnectorPolicy):
   *   bulkhead -> circuit breaker -> retry -> timeout -> provider.execute()
   */
  async execute<T = any>(providerName: string, operation: string, params: Record<string, any>): Promise<T> {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider not found: ${providerName}`);
    }

    const policy = this.policies.get(providerName)!;
    const label = `${providerName}.${operation}`;

    try {
      return await policy.composed.execute(() => provider.execute<T>(operation, params));
    } catch (error) {
      // If policy exhaustion fails, try provider fallback
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
    }
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
      const policy = this.policies.get(name);
      try {
        const result = await provider.healthCheck();
        results[name] = {
          ...result,
          circuit: policy?.breaker?.state as ProviderHealthDetail['circuit'],
        };
        latencies.push(result.latency_ms);

        if (!result.healthy || policy?.breaker?.state === 'open') {
          failedProviders.push(name);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        results[name] = {
          healthy: false,
          latency_ms: 0,
          error: errorMsg,
          lastChecked: timestamp,
          circuit: policy?.breaker?.state as ProviderHealthDetail['circuit'],
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
