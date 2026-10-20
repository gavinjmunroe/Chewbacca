import {
  StructifyConfig,
  ExtractionRequest,
  ExtractionResult,
  StructifyError,
  QueryOptions,
  QueryFilter,
  PaginatedResponse,
} from './types';
import { generateId } from '../../utils';
import { connectorRegistry } from '../registry';
import { createLogger } from '../../utils/logger';
import { UpstreamAPIError, ValidationError } from '../../errors';
import type {
  Person,
  Company,
  Campaign,
  Touchpoint,
  Relationship,
  CreatePersonInput,
  UpdatePersonInput,
  CreateCompanyInput,
  CreateCampaignInput,
  CreateTouchpointInput,
  CreateRelationshipInput,
} from '../../types';

const logger = createLogger('StructifyClient');

/**
 * Client for interacting with Structify API
 * Supports both extraction and CRUD operations for entities
 */
export class StructifyClient {
  private apiKey: string;
  private baseUrl: string;

  /**
   * Create a new StructifyClient instance
   * @param config - Structify configuration with apiKey and baseUrl
   * @throws ValidationError if apiKey is empty
   */
  constructor(config: StructifyConfig) {
    if (!config.apiKey || config.apiKey.trim() === '') {
      throw new ValidationError('API key is required');
    }

    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
  }

  // ============================================================================
  // EXTRACTION METHODS (Original functionality)
  // ============================================================================

  /**
   * Extract structured data from a source
   */
  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const result = await this.makeRequest<ExtractionResult>('POST', '/extract', request);

    logger.info('Extraction completed', {
      recordCount: result.totalRecords,
      processingTimeMs: result.metadata.processingTimeMs,
      status: result.status,
    });

    return result;
  }

  /**
   * Extract structured data from a file
   */
  async extractFromFile(
    fileContent: Buffer,
    _fileName: string,
    mimeType: string
  ): Promise<ExtractionResult> {
    const base64Content = fileContent.toString('base64');

    return this.extract({
      source: 'file',
      content: base64Content,
      contentType: mimeType,
    });
  }

  /**
   * Extract structured data from a URL
   */
  async extractFromUrl(url: string): Promise<ExtractionResult> {
    return this.extract({
      source: 'url',
      content: url,
    });
  }

  /**
   * Extract structured data from raw text
   */
  async extractFromText(text: string): Promise<ExtractionResult> {
    return this.extract({
      source: 'text',
      content: text,
    });
  }

  /**
   * Extract structured data with a target schema hint
   */
  async extractWithSchema(
    request: ExtractionRequest,
    targetSchema: Record<string, unknown>
  ): Promise<ExtractionResult> {
    return this.extract({
      ...request,
      targetSchema,
    });
  }

  // ============================================================================
  // PERSON CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new person record
   */
  async createPerson(input: CreatePersonInput): Promise<Person> {
    const now = new Date();
    const person: Person = {
      personId: generateId('person'),
      ...input,
      internalScore: 0,
      externalScore: 0,
      compositeScore: 0,
      routingTier: 'nurture',
      currentStatus: 'new',
      touchCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    logger.info('Creating person', { personId: person.personId });
    await this.makeRequest('POST', '/entities/person', person);
    return person;
  }

  /**
   * Get a person by ID
   */
  async getPerson(personId: string): Promise<Person | null> {
    try {
      return await this.makeRequest<Person>('GET', `/entities/person/${personId}`);
    } catch (error) {
      if ((error as Error & { status?: number }).status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Find a person by LinkedIn URL
   */
  async findPersonByLinkedIn(linkedinUrl: string, clientId: string): Promise<Person | null> {
    const results = await this.listPersons({
      filters: [
        { field: 'linkedinUrl', operator: 'eq', value: linkedinUrl },
        { field: 'client_id', operator: 'eq', value: clientId },
      ],
      limit: 1,
    });

    return results.data[0] || null;
  }

  /**
   * List persons with query options
   */
  async listPersons(options?: QueryOptions): Promise<PaginatedResponse<Person>> {
    const queryString = this.buildQueryString(options);
    return this.makeRequest<PaginatedResponse<Person>>('GET', `/entities/person${queryString}`);
  }

  /**
   * Update a person record
   */
  async updatePerson(personId: string, updates: UpdatePersonInput): Promise<Person> {
    logger.info('Updating person', { personId });
    return this.makeRequest<Person>('PUT', `/entities/person/${personId}`, {
      ...updates,
      updatedAt: new Date(),
    });
  }

  /**
   * Delete a person record
   */
  async deletePerson(personId: string): Promise<void> {
    logger.info('Deleting person', { personId });
    await this.makeRequest('DELETE', `/entities/person/${personId}`);
  }

  // ============================================================================
  // COMPANY CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new company record
   */
  async createCompany(input: CreateCompanyInput): Promise<Company> {
    const now = new Date();
    const company: Company = {
      companyId: generateId('company'),
      ...input,
      createdAt: now,
      updatedAt: now,
    };

    logger.info('Creating company', { companyId: company.companyId });
    await this.makeRequest('POST', '/entities/company', company);
    return company;
  }

  /**
   * Get a company by ID
   */
  async getCompany(companyId: string): Promise<Company | null> {
    try {
      return await this.makeRequest<Company>('GET', `/entities/company/${companyId}`);
    } catch (error) {
      if ((error as Error & { status?: number }).status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Find a company by domain
   */
  async findCompanyByDomain(domain: string, clientId: string): Promise<Company | null> {
    const results = await this.listCompanies({
      filters: [
        { field: 'domain', operator: 'eq', value: domain },
        { field: 'client_id', operator: 'eq', value: clientId },
      ],
      limit: 1,
    });

    return results.data[0] || null;
  }

  /**
   * List companies with query options
   */
  async listCompanies(options?: QueryOptions): Promise<PaginatedResponse<Company>> {
    const queryString = this.buildQueryString(options);
    return this.makeRequest<PaginatedResponse<Company>>('GET', `/entities/company${queryString}`);
  }

  /**
   * Update a company record
   */
  async updateCompany(companyId: string, updates: Partial<Company>): Promise<Company> {
    logger.info('Updating company', { companyId });
    return this.makeRequest<Company>('PUT', `/entities/company/${companyId}`, {
      ...updates,
      updatedAt: new Date(),
    });
  }

  // ============================================================================
  // CAMPAIGN CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new campaign record
   */
  async createCampaign(input: CreateCampaignInput): Promise<Campaign> {
    const now = new Date();
    const campaign: Campaign = {
      campaignId: generateId('campaign'),
      ...input,
      status: 'draft',
      totalLeads: 0,
      emailsSent: 0,
      emailsOpened: 0,
      emailsReplied: 0,
      meetingsBooked: 0,
      createdAt: now,
      updatedAt: now,
    };

    logger.info('Creating campaign', { campaignId: campaign.campaignId });
    await this.makeRequest('POST', '/entities/campaign', campaign);
    return campaign;
  }

  /**
   * Get a campaign by ID
   */
  async getCampaign(campaignId: string): Promise<Campaign | null> {
    try {
      return await this.makeRequest<Campaign>('GET', `/entities/campaign/${campaignId}`);
    } catch (error) {
      if ((error as Error & { status?: number }).status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * List campaigns with query options
   */
  async listCampaigns(options?: QueryOptions): Promise<PaginatedResponse<Campaign>> {
    const queryString = this.buildQueryString(options);
    return this.makeRequest<PaginatedResponse<Campaign>>('GET', `/entities/campaign${queryString}`);
  }

  /**
   * Update a campaign record
   */
  async updateCampaign(campaignId: string, updates: Partial<Campaign>): Promise<Campaign> {
    logger.info('Updating campaign', { campaignId });
    return this.makeRequest<Campaign>('PUT', `/entities/campaign/${campaignId}`, {
      ...updates,
      updatedAt: new Date(),
    });
  }

  // ============================================================================
  // TOUCHPOINT CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new touchpoint record
   */
  async createTouchpoint(input: CreateTouchpointInput): Promise<Touchpoint> {
    const now = new Date();
    const touchpoint: Touchpoint = {
      touchpointId: generateId('touchpoint'),
      ...input,
      occurredAt: input.occurredAt || now,
      createdAt: now,
    };

    logger.info('Creating touchpoint', { touchpointId: touchpoint.touchpointId });
    await this.makeRequest('POST', '/entities/touchpoint', touchpoint);
    return touchpoint;
  }

  /**
   * List touchpoints for a person
   */
  async listTouchpointsForPerson(personId: string, options?: QueryOptions): Promise<PaginatedResponse<Touchpoint>> {
    const filters: QueryFilter[] = [
      { field: 'personId', operator: 'eq', value: personId },
      ...(options?.filters || []),
    ];
    const queryString = this.buildQueryString({ ...options, filters });
    return this.makeRequest<PaginatedResponse<Touchpoint>>('GET', `/entities/touchpoint${queryString}`);
  }

  /**
   * List touchpoints with query options
   */
  async listTouchpoints(options?: QueryOptions): Promise<PaginatedResponse<Touchpoint>> {
    const queryString = this.buildQueryString(options);
    return this.makeRequest<PaginatedResponse<Touchpoint>>('GET', `/entities/touchpoint${queryString}`);
  }

  // ============================================================================
  // RELATIONSHIP CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new relationship record
   */
  async createRelationship(input: CreateRelationshipInput): Promise<Relationship> {
    const now = new Date();
    const relationship: Relationship = {
      relationshipId: generateId('relationship'),
      ...input,
      strength: input.strength || 50,
      interactionCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    logger.info('Creating relationship', { relationshipId: relationship.relationshipId });
    await this.makeRequest('POST', '/entities/relationship', relationship);
    return relationship;
  }

  /**
   * List relationships for a person
   */
  async listRelationshipsForPerson(personId: string, options?: QueryOptions): Promise<PaginatedResponse<Relationship>> {
    // Find relationships where person is either personA or personB
    const queryString = this.buildQueryString({
      ...options,
      filters: [
        ...(options?.filters || []),
      ],
    });
    // Note: Actual implementation may need OR logic - this is a simplified version
    return this.makeRequest<PaginatedResponse<Relationship>>(
      'GET',
      `/entities/relationship${queryString}&personId=${personId}`
    );
  }

  /**
   * List relationships with query options
   */
  async listRelationships(options?: QueryOptions): Promise<PaginatedResponse<Relationship>> {
    const queryString = this.buildQueryString(options);
    return this.makeRequest<PaginatedResponse<Relationship>>('GET', `/entities/relationship${queryString}`);
  }

  /**
   * Update a relationship record
   */
  async updateRelationship(relationshipId: string, updates: Partial<Relationship>): Promise<Relationship> {
    logger.info('Updating relationship', { relationshipId });
    return this.makeRequest<Relationship>('PUT', `/entities/relationship/${relationshipId}`, {
      ...updates,
      updatedAt: new Date(),
    });
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Check if the Structify API is accessible
   */
  async healthCheck(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: {
          'api_key': this.apiKey,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Structify API returned HTTP ${response.status}`);
      }
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Structify health check timed out after 10s');
      }
      if (error instanceof Error) throw error;
      throw new Error(String(error));
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Build query string from QueryOptions
   */
  private buildQueryString(options?: QueryOptions): string {
    if (!options) return '';

    const params = new URLSearchParams();

    if (options.filters) {
      for (const filter of options.filters) {
        params.append(`filter[${filter.field}][${filter.operator}]`, String(filter.value));
      }
    }

    if (options.limit) {
      params.append('limit', String(options.limit));
    }

    if (options.offset) {
      params.append('offset', String(options.offset));
    }

    if (options.orderBy) {
      params.append('orderBy', options.orderBy);
    }

    if (options.orderDirection) {
      params.append('orderDirection', options.orderDirection);
    }

    if (options.clientId) {
      params.append('client_id', options.clientId);
    }

    const queryString = params.toString();
    return queryString ? `?${queryString}` : '';
  }

  /**
   * Make a request to the Structify API
   */
  private async makeRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await connectorRegistry.execute('structify', async () => {
        const res = await fetch(url, {
          method,
          headers: {
            'api_key': this.apiKey,
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({})) as StructifyError;
          const error = new Error(errorData.message || `HTTP ${res.status}`);
          (error as Error & { status: number }).status = res.status;
          throw error;
        }

        return res;
      });

      // Handle empty responses (e.g., DELETE)
      const text = await response.text();
      if (!text) {
        return {} as T;
      }

      return JSON.parse(text) as T;
    } catch (error) {
      logger.error('Structify API request failed', error, { endpoint });
      throw new UpstreamAPIError('structify', error);
    }
  }
}
