/**
 * @togari/core/connectors/clay/client
 * Clay API client for data enrichment
 */

import {
  ClayConfig,
  ClayEnrichmentRequest,
  ClayEnrichmentData,
  ClayApiResponse,
  ClayTableRow,
  ClayBatchResult,
  ClayWebhookPayload,
} from './types';
import { withRetry } from '../../utils';
import { createLogger } from '../../utils/logger';
import { UpstreamAPIError, ValidationError } from '../../errors';
import type { Person, LinkedInExperience, CompanyData } from '../../types';

const logger = createLogger('ClayClient');

/**
 * Client for interacting with Clay API for data enrichment
 */
export class ClayClient {
  private apiKey: string;
  private baseUrl: string;
  private defaultTableId?: string;

  constructor(config: ClayConfig) {
    if (!config.apiKey || config.apiKey.trim() === '') {
      throw new ValidationError('Clay API key is required');
    }

    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.clay.com/v1';
    this.defaultTableId = config.tableId;
  }

  /**
   * Enrich a person record via Clay
   */
  async enrichPerson(request: ClayEnrichmentRequest): Promise<ClayEnrichmentData> {
    logger.info('Enriching person via Clay', {
      hasLinkedIn: !!request.linkedinUrl,
      hasEmail: !!request.email,
      hasCompany: !!request.companyDomain,
    });

    const response = await this.makeRequest<ClayEnrichmentData>('/enrich/person', {
      method: 'POST',
      body: request,
    });

    return response;
  }

  /**
   * Enrich a company via Clay
   */
  async enrichCompany(domain: string): Promise<ClayEnrichmentData> {
    logger.info('Enriching company via Clay', { domain });

    const response = await this.makeRequest<ClayEnrichmentData>('/enrich/company', {
      method: 'POST',
      body: { domain },
    });

    return response;
  }

  /**
   * Push a person record to Clay for enrichment
   * This triggers the Clay enrichment workflow
   */
  async pushToClayForEnrichment(
    person: Partial<Person>,
    tableId?: string
  ): Promise<{ rowId: string }> {
    const targetTableId = tableId || this.defaultTableId;
    if (!targetTableId) {
      throw new ValidationError('Table ID is required for push operation');
    }

    logger.info('Pushing person to Clay for enrichment', {
      personId: person.personId,
      tableId: targetTableId,
    });

    const row: ClayTableRow = {
      id: person.personId,
      linkedinUrl: person.linkedinUrl,
      email: person.workEmail,
      fullName: person.fullName,
      companyDomain: person.companyDomain,
      currentTitle: person.currentTitle,
      currentCompany: person.currentCompany,
    };

    const response = await this.makeRequest<{ rowId: string }>(`/tables/${targetTableId}/rows`, {
      method: 'POST',
      body: row,
    });

    return response;
  }

  /**
   * Push multiple person records to Clay in batch
   */
  async batchPushToClay(
    persons: Partial<Person>[],
    tableId?: string
  ): Promise<ClayBatchResult> {
    const targetTableId = tableId || this.defaultTableId;
    if (!targetTableId) {
      throw new ValidationError('Table ID is required for batch push operation');
    }

    logger.info('Batch pushing to Clay', {
      count: persons.length,
      tableId: targetTableId,
    });

    const results: ClayBatchResult = {
      total: persons.length,
      successful: 0,
      failed: 0,
      errors: [],
    };

    // Process in parallel with controlled concurrency
    const chunkSize = 10;
    for (let i = 0; i < persons.length; i += chunkSize) {
      const chunk = persons.slice(i, i + chunkSize);
      const promises = chunk.map(async (person) => {
        try {
          await this.pushToClayForEnrichment(person, targetTableId);
          results.successful++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            rowId: person.personId || 'unknown',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

      await Promise.allSettled(promises);

      // Rate limiting delay between chunks
      if (i + chunkSize < persons.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    logger.info('Batch push completed', {
      total: results.total,
      successful: results.successful,
      failed: results.failed,
    });

    return results;
  }

  /**
   * Handle Clay enrichment webhook callback
   * Updates person record with enriched data
   */
  handleEnrichmentWebhook(payload: ClayWebhookPayload): {
    personId: string;
    updates: Partial<Person>;
  } {
    logger.info('Processing Clay enrichment webhook', {
      personId: payload.personId,
      status: payload.status,
    });

    const updates: Partial<Person> = {
      enrichmentData: {
        ...payload.enrichmentData,
        source: 'clay',
        enrichedAt: payload.timestamp,
      },
    };

    // Map LinkedIn data
    if (payload.enrichmentData.linkedinData) {
      const linkedin = payload.enrichmentData.linkedinData;

      if (linkedin.headline) {
        updates.linkedinHeadline = linkedin.headline;
      }
      if (linkedin.summary) {
        updates.linkedinSummary = linkedin.summary;
      }
      if (linkedin.experience) {
        updates.linkedinExperience = linkedin.experience.map((exp): LinkedInExperience => ({
          title: exp.title,
          company: exp.company,
          startDate: exp.startDate,
          endDate: exp.endDate,
          current: exp.current,
          description: exp.description,
        }));
      }
    }

    // Map company data
    if (payload.enrichmentData.companyData) {
      const company = payload.enrichmentData.companyData;
      const companyData: CompanyData = {};

      if (company.name) companyData.name = company.name;
      if (company.domain) companyData.domain = company.domain;
      if (company.industry) companyData.industry = company.industry;
      if (company.employeeCount) companyData.employeeCount = company.employeeCount;
      if (company.fundingStage) companyData.fundingStage = company.fundingStage;

      updates.companyData = companyData;

      if (company.technologies) {
        updates.techStack = company.technologies;
      }
    }

    // Map email verification
    if (payload.enrichmentData.emailVerification) {
      updates.emailValid = payload.enrichmentData.emailVerification.valid;
    }

    return {
      personId: payload.personId,
      updates,
    };
  }

  /**
   * Check if Clay API is accessible
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Make a request to the Clay API
   */
  private async makeRequest<T>(
    endpoint: string,
    options: {
      method: 'GET' | 'POST' | 'PUT' | 'DELETE';
      body?: unknown;
    }
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await withRetry(
        async () => {
          const res = await fetch(url, {
            method: options.method,
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: options.body ? JSON.stringify(options.body) : undefined,
          });

          if (!res.ok) {
            const errorData = await res.json().catch(() => ({})) as ClayApiResponse<never>;
            const error = new Error(errorData.error?.message || `HTTP ${res.status}`);
            (error as Error & { status: number }).status = res.status;
            throw error;
          }

          return res;
        },
        {
          maxAttempts: 3,
          baseDelayMs: 1000,
          onRetry: (error, attempt) => {
            logger.warn(`Retrying Clay API request (attempt ${attempt})`, {
              endpoint,
              error: error instanceof Error ? error.message : String(error),
            });
          },
        }
      );

      const data = await response.json() as ClayApiResponse<T>;

      if (!data.success && data.error) {
        throw new Error(data.error.message);
      }

      return data.data as T;
    } catch (error) {
      logger.error('Clay API request failed', error, { endpoint });
      throw new UpstreamAPIError('clay', error);
    }
  }
}
