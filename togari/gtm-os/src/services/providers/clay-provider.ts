/**
 * @togari/bma-content/services/providers/clay-provider
 * ToolProvider implementation for Clay company and contact enrichment
 * Operations: enrich_company, enrich_contact, find_companies
 */

import { BaseToolProvider, HealthCheckResult } from './tool-provider';

interface ClayEnrichCompanyParams {
  domain: string;
}

interface ClayEnrichContactParams {
  email: string;
  name?: string;
}

interface ClayFindCompaniesParams {
  query: string;
  limit?: number;
}

export class ClayProvider extends BaseToolProvider {
  name = 'Clay';
  private apiKey: string;
  private apiBase = 'https://api.clay.com/v1';
  private minuteLimitResetTime: Date | null = null;
  private callsThisMinute = 0;
  private maxCallsPerMinute = 10;

  constructor(apiKey?: string) {
    super();
    this.apiKey = apiKey || process.env.CLAY_API_KEY || '';
    if (!this.apiKey) {
      console.warn('ClayProvider: CLAY_API_KEY not configured');
    }
  }

  async execute<T = any>(operation: string, params: Record<string, any>): Promise<T> {
    const startTime = Date.now();

    try {
      if (!this.apiKey) {
        throw new Error('CLAY_API_KEY not configured');
      }

      // Throttle: max 10 calls per minute
      await this.waitForSlot();

      let result: T;

      switch (operation) {
        case 'enrich_company':
          result = (await this.enrichCompany(params as ClayEnrichCompanyParams)) as T;
          break;
        case 'enrich_contact':
          result = (await this.enrichContact(params as ClayEnrichContactParams)) as T;
          break;
        case 'find_companies':
          result = (await this.findCompanies(params as ClayFindCompaniesParams)) as T;
          break;
        default:
          throw new Error(`Unknown Clay operation: ${operation}`);
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
          error: 'CLAY_API_KEY not configured',
          lastChecked: new Date(),
        };
      }

      // Lightweight connectivity check — avoid billable enrichment calls.
      // A GET to the base URL validates host reachability and auth.
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
    // Return empty or cached enrichment results
    switch (operation) {
      case 'enrich_company':
        return {
          company: null,
          fallback: true,
        } as T;
      case 'enrich_contact':
        return {
          contact: null,
          fallback: true,
        } as T;
      case 'find_companies':
        return { companies: [], fallback: true } as T;
      default:
        throw new Error(`No fallback for Clay.${operation}`);
    }
  }

  /**
   * Enrich company data by domain
   */
  private async enrichCompany(params: ClayEnrichCompanyParams): Promise<Record<string, any>> {
    const { domain } = params;

    const res = await fetch(`${this.apiBase}/enrichment/company`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain }),
    });

    if (!res.ok) {
      if (res.status === 404) {
        return { company: null, error: 'Not found' };
      }
      throw new Error(`Clay enrich_company failed: ${res.status}`);
    }

    return await res.json();
  }

  /**
   * Enrich contact data by email and optional name
   */
  private async enrichContact(params: ClayEnrichContactParams): Promise<Record<string, any>> {
    const { email, name } = params;

    const body: Record<string, any> = { email };
    if (name) body.name = name;

    const res = await fetch(`${this.apiBase}/enrichment/contact`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status === 404) {
        return { contact: null, error: 'Not found' };
      }
      throw new Error(`Clay enrich_contact failed: ${res.status}`);
    }

    return await res.json();
  }

  /**
   * Find companies matching a query
   */
  private async findCompanies(params: ClayFindCompaniesParams): Promise<Record<string, any>> {
    const { query, limit = 10 } = params;

    const res = await fetch(`${this.apiBase}/search/companies`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        limit,
      }),
    });

    if (!res.ok) {
      throw new Error(`Clay find_companies failed: ${res.status}`);
    }

    return await res.json();
  }

  /**
   * Wait for available slot (throttle to 10 calls per minute)
   */
  private async waitForSlot(): Promise<void> {
    const now = new Date();

    // Reset counter if a minute has passed
    if (!this.minuteLimitResetTime || this.minuteLimitResetTime < now) {
      this.minuteLimitResetTime = new Date(now.getTime() + 60_000);
      this.callsThisMinute = 0;
    }

    if (this.callsThisMinute >= this.maxCallsPerMinute) {
      const waitMs = this.minuteLimitResetTime.getTime() - now.getTime() + 50;
      if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
      this.callsThisMinute = 0;
    }

    this.callsThisMinute++;
  }

  /**
   * Get remaining calls this minute
   */
  getRemainingCalls(): number {
    return Math.max(0, this.maxCallsPerMinute - this.callsThisMinute);
  }
}
