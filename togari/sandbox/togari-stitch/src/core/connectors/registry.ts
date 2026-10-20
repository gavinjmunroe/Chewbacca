/**
 * @togari/core/connectors/registry
 * Central registry for all connector resilience policies.
 * Provides execute() to run operations through the appropriate policy,
 * and status reporting for health checks.
 */

import {
  buildConnectorPolicy,
  ConnectorPolicy,
  ConnectorPolicyConfig,
  ConnectorStatus,
  CONNECTOR_CONFIGS,
  BrokenCircuitError,
  BulkheadRejectedError,
  TaskCancelledError,
} from './resilience';
import { CircuitState } from 'cockatiel';
import { UpstreamAPIError } from '../errors/types';
import { createLogger } from '../utils/logger';

const logger = createLogger('ConnectorRegistry');

// ============================================================================
// CONNECTOR REGISTRY
// ============================================================================

class ConnectorRegistry {
  private policies = new Map<string, ConnectorPolicy>();
  private lastErrors = new Map<string, { message: string; at: Date }>();

  /**
   * Register a connector with its resilience policy.
   * Typically called once at startup for each connector.
   */
  register(name: string, config?: ConnectorPolicyConfig): void {
    const finalConfig = config ?? CONNECTOR_CONFIGS[name];
    if (!finalConfig) {
      throw new Error(`No policy config found for connector: ${name}`);
    }

    const policy = buildConnectorPolicy(finalConfig);
    this.policies.set(name, policy);
    logger.info(`Registered resilience policy for connector: ${name}`, {
      timeout: finalConfig.timeoutMs,
      retries: finalConfig.retryAttempts,
      bulkhead: `${finalConfig.bulkheadConcurrency}/${finalConfig.bulkheadQueue}`,
    });
  }

  /**
   * Execute an operation through the connector's resilience policy.
   * Applies timeout, retry, circuit breaker, and bulkhead in that order.
   *
   * @param name - Connector name (must be registered)
   * @param fn - The async operation to execute
   * @returns The result of fn()
   * @throws UpstreamAPIError with clear message on resilience failures
   */
  async execute<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const policy = this.policies.get(name);
    if (!policy) {
      // No policy registered — run without resilience (graceful degradation)
      logger.warn(`No resilience policy for connector "${name}" — executing without protection`);
      return fn();
    }

    try {
      return await policy.composed.execute(async () => fn());
    } catch (error) {
      // Track last error for status reporting
      this.lastErrors.set(name, {
        message: error instanceof Error ? error.message : String(error),
        at: new Date(),
      });

      // Provide clear error messages for resilience-specific failures
      if (error instanceof BrokenCircuitError) {
        throw new UpstreamAPIError(
          name,
          new Error(`Circuit breaker is open for ${name} — service appears unhealthy. Requests will resume automatically.`)
        );
      }
      if (error instanceof BulkheadRejectedError) {
        throw new UpstreamAPIError(
          name,
          new Error(`Too many concurrent requests to ${name} — bulkhead capacity exceeded. Try again shortly.`)
        );
      }
      if (error instanceof TaskCancelledError) {
        throw new UpstreamAPIError(
          name,
          new Error(`Request to ${name} timed out after all retries.`)
        );
      }

      // Re-throw other errors as-is
      throw error;
    }
  }

  /**
   * Get the current status of a connector's resilience policy.
   */
  getStatus(name: string): ConnectorStatus {
    const policy = this.policies.get(name);
    const lastError = this.lastErrors.get(name);

    if (!policy) {
      return {
        name,
        healthy: false,
        circuitState: 'closed',
        bulkheadAvailable: 0,
        bulkheadQueued: 0,
        lastError: 'Not registered',
      };
    }

    // CircuitState is a numeric enum: 0=Closed, 1=Open, 2=HalfOpen, 3=Isolated
    const stateNum = policy.breaker.state;
    const circuitState: 'closed' | 'open' | 'half-open' =
      stateNum === CircuitState.Open ? 'open' :
      stateNum === CircuitState.HalfOpen ? 'half-open' : 'closed';
    const healthy = stateNum !== CircuitState.Open;

    return {
      name,
      healthy,
      circuitState,
      bulkheadAvailable: policy.bulkhead.executionSlots,
      bulkheadQueued: policy.bulkhead.queueSlots,
      ...(lastError
        ? { lastError: lastError.message, lastErrorAt: lastError.at.toISOString() }
        : {}),
    };
  }

  /**
   * Get status of all registered connectors.
   */
  getAllStatuses(): ConnectorStatus[] {
    return Array.from(this.policies.keys()).map((name) => this.getStatus(name));
  }

  /**
   * Check if a specific connector's circuit breaker is healthy (not open).
   */
  isHealthy(name: string): boolean {
    return this.getStatus(name).healthy;
  }

  /**
   * Check if a connector is registered.
   */
  has(name: string): boolean {
    return this.policies.has(name);
  }
}

// Export singleton
export const connectorRegistry = new ConnectorRegistry();
