import Exa from 'exa-js';
import type {
  ExaSearchOptions,
  ExaSearchResponse,
  ExaSearchResult,
  ExaContentsOptions,
  ExaContentsResult,
  CompanyEnrichmentResult,
  ContactEnrichmentResult,
} from './types';
import { withRetry } from '../../utils/retry';
import { createLogger } from '../../utils/logger';
import { UpstreamAPIError } from '../../errors/types';
import { AnthropicClient } from '../anthropic';

const logger = createLogger('ExaClient');

/**
 * Client for interacting with Exa API for search and enrichment
 */
export class ExaClient {
  private client: Exa;
  private anthropic?: AnthropicClient;

  /**
   * Create a new ExaClient instance
   * @param apiKey - Exa API key
   * @param anthropic - Optional Anthropic client for AI-powered extraction
   */
  constructor(apiKey: string, anthropic?: AnthropicClient) {
    this.client = new Exa(apiKey);
    this.anthropic = anthropic;
  }

  /**
   * Search for content using Exa's neural or keyword search
   * @param query - Search query
   * @param options - Search options
   * @returns Search response with results
   */
  async search(query: string, options?: ExaSearchOptions): Promise<ExaSearchResponse> {
    try {
      const response = await withRetry(
        async () => {
          return await this.client.searchAndContents(query, {
            type: options?.type ?? 'neural',
            useAutoprompt: options?.useAutoprompt ?? true,
            numResults: options?.numResults ?? 10,
            text: options?.includeText !== false ? true : undefined,
            includeDomains: options?.includeDomains,
            excludeDomains: options?.excludeDomains,
            startPublishedDate: options?.startPublishedDate,
            endPublishedDate: options?.endPublishedDate,
          });
        },
        {
          maxAttempts: 3,
          baseDelayMs: 1000,
          onRetry: (error, attempt) => {
            logger.warn(`Retrying Exa search (attempt ${attempt})`, {
              query,
              error: error instanceof Error ? error.message : String(error),
            });
          },
        }
      );

      logger.info('Exa search completed', {
        query,
        resultCount: response.results.length,
      });

      return {
        results: response.results.map((result) => ({
          url: result.url,
          title: result.title ?? '',
          text: result.text,
          publishedDate: result.publishedDate,
          author: result.author,
          score: result.score ?? 0,
        })),
        autopromptString: response.autopromptString,
      };
    } catch (error) {
      logger.error('Exa search failed', error, { query });
      throw new UpstreamAPIError('exa', error);
    }
  }

  /**
   * Find pages similar to a given URL
   * @param url - URL to find similar pages for
   * @param options - Search options
   * @returns Search response with similar results
   */
  async findSimilar(url: string, options?: ExaSearchOptions): Promise<ExaSearchResponse> {
    try {
      const response = await withRetry(
        async () => {
          return await this.client.findSimilarAndContents(url, {
            numResults: options?.numResults ?? 10,
            text: options?.includeText !== false ? true : undefined,
            includeDomains: options?.includeDomains,
            excludeDomains: options?.excludeDomains,
            startPublishedDate: options?.startPublishedDate,
            endPublishedDate: options?.endPublishedDate,
          });
        },
        {
          maxAttempts: 3,
          baseDelayMs: 1000,
          onRetry: (error, attempt) => {
            logger.warn(`Retrying Exa findSimilar (attempt ${attempt})`, {
              url,
              error: error instanceof Error ? error.message : String(error),
            });
          },
        }
      );

      logger.info('Exa findSimilar completed', {
        url,
        resultCount: response.results.length,
      });

      return {
        results: response.results.map((result) => ({
          url: result.url,
          title: result.title ?? '',
          text: result.text,
          publishedDate: result.publishedDate,
          author: result.author,
          score: result.score ?? 0,
        })),
      };
    } catch (error) {
      logger.error('Exa findSimilar failed', error, { url });
      throw new UpstreamAPIError('exa', error);
    }
  }

  /**
   * Get content from specific URLs
   * @param urls - URLs to get content from
   * @param options - Content options
   * @returns Array of content results
   */
  async getContents(urls: string[], options?: ExaContentsOptions): Promise<ExaContentsResult[]> {
    try {
      const response = await withRetry(
        async () => {
          return await this.client.getContents(urls, {
            text: options?.text !== false ? true : undefined,
            highlights: options?.highlights === true ? true : (typeof options?.highlights === 'object' ? options.highlights : undefined),
            summary: options?.summary === true ? true : (typeof options?.summary === 'object' ? options.summary : undefined),
          });
        },
        {
          maxAttempts: 3,
          baseDelayMs: 1000,
          onRetry: (error, attempt) => {
            logger.warn(`Retrying Exa getContents (attempt ${attempt})`, {
              urlCount: urls.length,
              error: error instanceof Error ? error.message : String(error),
            });
          },
        }
      );

      logger.info('Exa getContents completed', {
        urlCount: urls.length,
        resultCount: response.results.length,
      });

      return response.results.map((result) => ({
        url: result.url,
        title: result.title ?? '',
        text: result.text,
        highlights: (result as Record<string, unknown>).highlights as string[] | undefined,
        summary: (result as Record<string, unknown>).summary as string | undefined,
      }));
    } catch (error) {
      logger.error('Exa getContents failed', error, { urlCount: urls.length });
      throw new UpstreamAPIError('exa', error);
    }
  }

  /**
   * Enrich company information from a domain
   * @param domain - Company domain to enrich
   * @returns Company enrichment result
   */
  async enrichCompany(domain: string): Promise<CompanyEnrichmentResult> {
    const searchResponse = await this.search(`${domain} company about`, {
      numResults: 5,
      includeText: true,
    });

    const sources = searchResponse.results.map((r) => r.url);

    if (this.anthropic) {
      const extracted = await this.extractCompanyFromSearchResults(
        searchResponse.results,
        domain
      );

      return {
        domain,
        ...extracted,
        sources,
        confidence: extracted.name ? 0.8 : 0.3,
      };
    }

    // Best effort extraction without AI
    const bestResult = searchResponse.results[0];
    return {
      domain,
      name: this.extractCompanyNameFromTitle(bestResult?.title, domain),
      description: bestResult?.text?.slice(0, 500),
      sources,
      confidence: 0.3,
    };
  }

  /**
   * Enrich contact information from an identifier
   * @param identifier - Email, LinkedIn URL, or "Name at Company"
   * @returns Contact enrichment result
   */
  async enrichContact(identifier: string): Promise<ContactEnrichmentResult> {
    const searchResponse = await this.search(identifier, {
      numResults: 5,
      includeText: true,
    });

    const sources = searchResponse.results.map((r) => r.url);

    if (this.anthropic) {
      const extracted = await this.extractContactFromSearchResults(
        searchResponse.results,
        identifier
      );

      return {
        ...extracted,
        sources,
        confidence: extracted.fullName ? 0.7 : 0.2,
      };
    }

    // Best effort extraction without AI
    return {
      sources,
      confidence: 0.2,
    };
  }

  /**
   * Extract company information from search results using Claude
   * @param results - Search results to extract from
   * @param domain - Company domain
   * @returns Extracted company information
   */
  private async extractCompanyFromSearchResults(
    results: ExaSearchResult[],
    domain: string
  ): Promise<Partial<CompanyEnrichmentResult>> {
    if (!this.anthropic || results.length === 0) {
      return {};
    }

    const combinedText = results
      .map((r) => `Source: ${r.url}\nTitle: ${r.title}\n${r.text || ''}`)
      .join('\n\n---\n\n')
      .slice(0, 8000);

    try {
      const response = await this.anthropic.complete({
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
        system: `You are a data extraction assistant. Extract structured company information from the provided search results. Respond only with valid JSON.`,
        messages: [
          {
            role: 'user',
            content: `Extract company information for domain "${domain}" from these search results:

${combinedText}

Respond with JSON containing these fields (use null for unknown):
{
  "name": "company name",
  "description": "brief description",
  "industry": "industry category",
  "employeeCount": "employee range like '50-100' or '1000+'",
  "location": { "city": "", "state": "", "country": "" },
  "socialProfiles": { "linkedin": "", "twitter": "" },
  "technologies": ["tech1", "tech2"],
  "funding": "funding info",
  "foundedYear": 2020
}`,
          },
        ],
      });

      const parsed = JSON.parse(response.content);
      return {
        name: parsed.name || undefined,
        description: parsed.description || undefined,
        industry: parsed.industry || undefined,
        employeeCount: parsed.employeeCount || undefined,
        location: parsed.location?.city ? parsed.location : undefined,
        socialProfiles: parsed.socialProfiles?.linkedin ? parsed.socialProfiles : undefined,
        technologies: parsed.technologies?.length ? parsed.technologies : undefined,
        funding: parsed.funding || undefined,
        foundedYear: parsed.foundedYear || undefined,
      };
    } catch (error) {
      logger.warn('Failed to extract company data with Claude', {
        domain,
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }

  /**
   * Extract contact information from search results using Claude
   * @param results - Search results to extract from
   * @param identifier - Original search identifier
   * @returns Extracted contact information
   */
  private async extractContactFromSearchResults(
    results: ExaSearchResult[],
    identifier: string
  ): Promise<Partial<ContactEnrichmentResult>> {
    if (!this.anthropic || results.length === 0) {
      return {};
    }

    const combinedText = results
      .map((r) => `Source: ${r.url}\nTitle: ${r.title}\n${r.text || ''}`)
      .join('\n\n---\n\n')
      .slice(0, 8000);

    try {
      const response = await this.anthropic.complete({
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
        system: `You are a data extraction assistant. Extract structured contact information from the provided search results. Respond only with valid JSON.`,
        messages: [
          {
            role: 'user',
            content: `Extract contact information for "${identifier}" from these search results:

${combinedText}

Respond with JSON containing these fields (use null for unknown):
{
  "email": "email address",
  "fullName": "full name",
  "title": "job title",
  "company": "company name",
  "linkedinUrl": "linkedin profile url",
  "location": { "city": "", "state": "", "country": "" }
}`,
          },
        ],
      });

      const parsed = JSON.parse(response.content);
      return {
        email: parsed.email || undefined,
        fullName: parsed.fullName || undefined,
        title: parsed.title || undefined,
        company: parsed.company || undefined,
        linkedinUrl: parsed.linkedinUrl || undefined,
        location: parsed.location?.city ? parsed.location : undefined,
      };
    } catch (error) {
      logger.warn('Failed to extract contact data with Claude', {
        identifier,
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }

  /**
   * Extract company name from page title
   * @param title - Page title
   * @param domain - Domain as fallback
   * @returns Extracted company name
   */
  private extractCompanyNameFromTitle(title?: string, domain?: string): string | undefined {
    if (!title) {
      return domain?.replace(/\.(com|io|co|org|net)$/, '');
    }
    // Remove common suffixes like " | About", " - Home", etc.
    return title.split(/\s*[|\-–—]\s*/)[0].trim() || undefined;
  }
}
