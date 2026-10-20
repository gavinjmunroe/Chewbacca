/**
 * @togari/bma-content/services/providers/exa-provider
 * ToolProvider implementation for Exa web search and research
 * Operations: search, findSimilar, getContents
 */

import { BaseToolProvider, HealthCheckResult } from './tool-provider';

interface ExaSearchParams {
  query: string;
  num_results?: number;
  use_autoprompt?: boolean;
  include_domains?: string[];
  exclude_domains?: string[];
}

interface ExaFindSimilarParams {
  url: string;
  num_results?: number;
}

interface ExaGetContentsParams {
  ids: string[];
}

interface ExaSearchResult {
  results: Array<{
    url: string;
    title?: string;
    score?: number;
    publishedDate?: string;
  }>;
  remaining_calls?: number;
}

export class ExaProvider extends BaseToolProvider {
  name = 'Exa';
  private apiKey: string;
  private apiBase = 'https://api.exa.ai';
  private dailyLimitResetTime: Date | null = null;
  private callsToday = 0;
  private maxCallsPerDay = 100;

  constructor(apiKey?: string) {
    super();
    this.apiKey = apiKey || process.env.EXA_API_KEY || '';
    if (!this.apiKey) {
      console.warn('ExaProvider: EXA_API_KEY not configured');
    }
  }

  async execute<T = any>(operation: string, params: Record<string, any>): Promise<T> {
    const startTime = Date.now();

    try {
      if (!this.apiKey) {
        throw new Error('EXA_API_KEY not configured');
      }

      let result: T;

      switch (operation) {
        case 'search':
          result = (await this.search(params as ExaSearchParams)) as T;
          break;
        case 'findSimilar':
          result = (await this.findSimilar(params as ExaFindSimilarParams)) as T;
          break;
        case 'getContents':
          result = (await this.getContents(params as ExaGetContentsParams)) as T;
          break;
        default:
          throw new Error(`Unknown Exa operation: ${operation}`);
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
          error: 'EXA_API_KEY not configured',
          lastChecked: new Date(),
        };
      }

      // Lightweight connectivity check — use a GET to the base URL rather than
      // a billable POST /search, which would burn through the 100/day limit
      // if health checks run on an interval.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);

      try {
        const res = await fetch(this.apiBase, {
          method: 'GET',
          headers: { 'x-api-key': this.apiKey },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const latency_ms = Date.now() - startTime;

        // Any response (even 404) means the host is reachable and our key was accepted
        // Only network errors or 401/403 indicate a problem
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
    // Return cached or empty results based on operation type
    switch (operation) {
      case 'search':
        return {
          results: [],
          remaining_calls: 0,
          fallback: true,
        } as T;
      case 'findSimilar':
        return { results: [], fallback: true } as T;
      case 'getContents':
        return { contents: [], fallback: true } as T;
      default:
        throw new Error(`No fallback for Exa.${operation}`);
    }
  }

  /**
   * Search Exa for content matching a query
   */
  private async search(params: ExaSearchParams): Promise<ExaSearchResult> {
    // Check daily limit
    this.resetDailyLimitIfNeeded();
    if (this.callsToday >= this.maxCallsPerDay) {
      throw new Error(`Exa daily limit (${this.maxCallsPerDay}) reached`);
    }

    const {
      query,
      num_results = 5,
      use_autoprompt = true,
      include_domains,
      exclude_domains,
    } = params;

    const body: Record<string, any> = {
      query,
      num_results,
      use_autoprompt,
    };

    if (include_domains?.length) body.include_domains = include_domains;
    if (exclude_domains?.length) body.exclude_domains = exclude_domains;

    const res = await fetch(`${this.apiBase}/search`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Exa search failed: ${res.status} ${await res.text()}`);
    }

    this.callsToday++;
    return await res.json();
  }

  /**
   * Find similar content by URL
   */
  private async findSimilar(params: ExaFindSimilarParams): Promise<ExaSearchResult> {
    this.resetDailyLimitIfNeeded();
    if (this.callsToday >= this.maxCallsPerDay) {
      throw new Error(`Exa daily limit (${this.maxCallsPerDay}) reached`);
    }

    const { url, num_results = 5 } = params;

    const res = await fetch(`${this.apiBase}/findSimilar`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        num_results,
      }),
    });

    if (!res.ok) {
      throw new Error(`Exa findSimilar failed: ${res.status}`);
    }

    this.callsToday++;
    return await res.json();
  }

  /**
   * Get full contents for specific result IDs
   */
  private async getContents(params: ExaGetContentsParams): Promise<Record<string, any>> {
    this.resetDailyLimitIfNeeded();
    if (this.callsToday >= this.maxCallsPerDay) {
      throw new Error(`Exa daily limit (${this.maxCallsPerDay}) reached`);
    }

    const { ids } = params;

    const res = await fetch(`${this.apiBase}/getContents`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids }),
    });

    if (!res.ok) {
      throw new Error(`Exa getContents failed: ${res.status}`);
    }

    this.callsToday++;
    return await res.json();
  }

  /**
   * Reset daily call counter at midnight UTC
   */
  private resetDailyLimitIfNeeded(): void {
    const now = new Date();
    const today = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    if (!this.dailyLimitResetTime || this.dailyLimitResetTime < today) {
      this.dailyLimitResetTime = new Date(today.getTime() + 24 * 60 * 60 * 1000); // Next midnight UTC
      this.callsToday = 0;
    }
  }

  /**
   * Get remaining calls today
   */
  getRemainingCalls(): number {
    this.resetDailyLimitIfNeeded();
    return Math.max(0, this.maxCallsPerDay - this.callsToday);
  }
}
