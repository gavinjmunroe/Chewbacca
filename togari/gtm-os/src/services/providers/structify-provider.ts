/**
 * @togari/bma-content/services/providers/structify-provider
 * ToolProvider implementation for Structify data normalization
 * Operations: structure, apply_schema
 */

import { BaseToolProvider, HealthCheckResult } from './tool-provider';

interface StructifyStructureParams {
  data: Record<string, any>;
  instructions?: string;
}

interface StructifyApplySchemaParams {
  data: Record<string, any>;
  schema: Record<string, any>;
}

export class StructifyProvider extends BaseToolProvider {
  name = 'Structify';
  private apiKey: string;
  private apiBase = 'https://api.structify.ai';

  constructor(apiKey?: string) {
    super();
    this.apiKey = apiKey || process.env.STRUCTIFY_API_KEY || '';
    if (!this.apiKey) {
      console.warn('StructifyProvider: STRUCTIFY_API_KEY not configured');
    }
  }

  async execute<T = any>(operation: string, params: Record<string, any>): Promise<T> {
    const startTime = Date.now();

    try {
      if (!this.apiKey) {
        throw new Error('STRUCTIFY_API_KEY not configured');
      }

      let result: T;

      switch (operation) {
        case 'structure':
          result = (await this.structure(params as StructifyStructureParams)) as T;
          break;
        case 'apply_schema':
          result = (await this.applySchema(params as StructifyApplySchemaParams)) as T;
          break;
        default:
          throw new Error(`Unknown Structify operation: ${operation}`);
      }

      const latency = Date.now() - startTime;
      this.recordMetric(operation, latency);
      return result;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.recordMetric(operation, latency);
      throw error;
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      if (!this.apiKey) {
        return {
          healthy: false,
          latency_ms: 0,
          error: 'STRUCTIFY_API_KEY not configured',
          lastChecked: new Date(),
        };
      }

      // Lightweight connectivity check — avoid billable POST calls.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);

      try {
        const res = await fetch(this.apiBase, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${this.apiKey}` },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const latency_ms = Date.now() - startTime;

        if (res.status === 401 || res.status === 403) {
          return {
            healthy: false,
            latency_ms,
            error: `Authentication failed: HTTP ${res.status}`,
            lastChecked: new Date(),
          };
        }

        return {
          healthy: true,
          latency_ms,
          lastChecked: new Date(),
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const latency_ms = Date.now() - startTime;
      return {
        healthy: false,
        latency_ms,
        error: error instanceof Error ? error.message : String(error),
        lastChecked: new Date(),
      };
    }
  }

  async fallback<T = any>(operation: string, params: Record<string, any>): Promise<T> {
    // Return the input data as-is (unstructured fallback)
    switch (operation) {
      case 'structure':
        return {
          data: (params as StructifyStructureParams).data,
          fallback: true,
        } as T;
      case 'apply_schema':
        return {
          data: (params as StructifyApplySchemaParams).data,
          fallback: true,
        } as T;
      default:
        throw new Error(`No fallback for Structify.${operation}`);
    }
  }

  /**
   * Structure unstructured data with optional instructions
   */
  private async structure(params: StructifyStructureParams): Promise<Record<string, any>> {
    const { data, instructions } = params;

    const body: Record<string, any> = { data };
    if (instructions) body.instructions = instructions;

    const res = await fetch(`${this.apiBase}/structure`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Structify structure failed: ${res.status}`);
    }

    return await res.json();
  }

  /**
   * Apply a specific schema to data
   */
  private async applySchema(params: StructifyApplySchemaParams): Promise<Record<string, any>> {
    const { data, schema } = params;

    const res = await fetch(`${this.apiBase}/apply-schema`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data,
        schema,
      }),
    });

    if (!res.ok) {
      throw new Error(`Structify apply_schema failed: ${res.status}`);
    }

    return await res.json();
  }
}
