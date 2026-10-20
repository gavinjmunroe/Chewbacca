import type { Person, Company, Campaign, Touchpoint, Relationship } from '@togari/core';

/**
 * Structify API Client Configuration
 */
export interface StructifyConfig {
  apiKey: string;
  datasetId: string;
  baseUrl?: string;
}

/**
 * Query filter options for Structify queries
 */
export interface QueryFilter {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';
  value: any;
}

/**
 * Query options for list operations
 */
export interface QueryOptions {
  filters?: QueryFilter[];
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
}

/**
 * Structify API Client
 * Wrapper around Structify REST API for type-safe data operations
 */
export class StructifyClient {
  private readonly apiKey: string;
  private readonly datasetId: string;
  private readonly baseUrl: string;

  constructor(config: StructifyConfig) {
    this.apiKey = config.apiKey;
    this.datasetId = config.datasetId;
    this.baseUrl = config.baseUrl || 'https://api.structify.ai';
  }

  /**
   * Execute a fetch request with authentication
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'api_key': this.apiKey,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Structify API error: ${response.status} - ${error}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Build query string from filters
   */
  private buildQueryString(options: QueryOptions = {}): string {
    const params = new URLSearchParams();

    if (options.filters) {
      options.filters.forEach((filter, index) => {
        params.append(`filter[${index}][field]`, filter.field);
        params.append(`filter[${index}][operator]`, filter.operator);
        params.append(`filter[${index}][value]`, String(filter.value));
      });
    }

    if (options.limit) {
      params.append('limit', String(options.limit));
    }

    if (options.offset) {
      params.append('offset', String(options.offset));
    }

    if (options.orderBy) {
      params.append('orderBy', options.orderBy);
      params.append('orderDirection', options.orderDirection || 'asc');
    }

    return params.toString();
  }

  // ============================================
  // PERSON OPERATIONS
  // ============================================

  async createPerson(person: Omit<Person, 'personId' | 'createdAt' | 'updatedAt'>): Promise<Person> {
    return this.request<Person>(`/datasets/${this.datasetId}/entities/people`, {
      method: 'POST',
      body: JSON.stringify(person),
    });
  }

  async getPerson(personId: string, organizationId: string): Promise<Person | null> {
    try {
      return await this.request<Person>(
        `/datasets/${this.datasetId}/entities/people/${personId}?organizationId=${organizationId}`
      );
    } catch (error) {
      if ((error as Error).message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  async findPersonByLinkedIn(linkedinUrl: string, organizationId: string): Promise<Person | null> {
    const query = this.buildQueryString({
      filters: [
        { field: 'linkedinUrl', operator: 'eq', value: linkedinUrl },
        { field: 'organizationId', operator: 'eq', value: organizationId },
      ],
      limit: 1,
    });

    const response = await this.request<{ data: Person[] }>(
      `/datasets/${this.datasetId}/entities/people?${query}`
    );

    return response.data[0] || null;
  }

  async listPeople(organizationId: string, options: QueryOptions = {}): Promise<Person[]> {
    const filters = [
      ...(options.filters || []),
      { field: 'organizationId', operator: 'eq' as const, value: organizationId },
    ];

    const query = this.buildQueryString({ ...options, filters });

    const response = await this.request<{ data: Person[] }>(
      `/datasets/${this.datasetId}/entities/people?${query}`
    );

    return response.data;
  }

  async updatePerson(personId: string, updates: Partial<Person>): Promise<Person> {
    return this.request<Person>(`/datasets/${this.datasetId}/entities/people/${personId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async deletePerson(personId: string): Promise<void> {
    await this.request(`/datasets/${this.datasetId}/entities/people/${personId}`, {
      method: 'DELETE',
    });
  }

  // ============================================
  // COMPANY OPERATIONS
  // ============================================

  async createCompany(company: Omit<Company, 'companyId' | 'createdAt' | 'updatedAt'>): Promise<Company> {
    return this.request<Company>(`/datasets/${this.datasetId}/entities/companies`, {
      method: 'POST',
      body: JSON.stringify(company),
    });
  }

  async getCompany(companyId: string, organizationId: string): Promise<Company | null> {
    try {
      return await this.request<Company>(
        `/datasets/${this.datasetId}/entities/companies/${companyId}?organizationId=${organizationId}`
      );
    } catch (error) {
      if ((error as Error).message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  async findCompanyByDomain(domain: string, organizationId: string): Promise<Company | null> {
    const query = this.buildQueryString({
      filters: [
        { field: 'domain', operator: 'eq', value: domain },
        { field: 'organizationId', operator: 'eq', value: organizationId },
      ],
      limit: 1,
    });

    const response = await this.request<{ data: Company[] }>(
      `/datasets/${this.datasetId}/entities/companies?${query}`
    );

    return response.data[0] || null;
  }

  async listCompanies(organizationId: string, options: QueryOptions = {}): Promise<Company[]> {
    const filters = [
      ...(options.filters || []),
      { field: 'organizationId', operator: 'eq' as const, value: organizationId },
    ];

    const query = this.buildQueryString({ ...options, filters });

    const response = await this.request<{ data: Company[] }>(
      `/datasets/${this.datasetId}/entities/companies?${query}`
    );

    return response.data;
  }

  async updateCompany(companyId: string, updates: Partial<Company>): Promise<Company> {
    return this.request<Company>(`/datasets/${this.datasetId}/entities/companies/${companyId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  // ============================================
  // CAMPAIGN OPERATIONS
  // ============================================

  async createCampaign(campaign: Omit<Campaign, 'campaignId' | 'createdAt' | 'updatedAt'>): Promise<Campaign> {
    return this.request<Campaign>(`/datasets/${this.datasetId}/entities/campaigns`, {
      method: 'POST',
      body: JSON.stringify(campaign),
    });
  }

  async getCampaign(campaignId: string, organizationId: string): Promise<Campaign | null> {
    try {
      return await this.request<Campaign>(
        `/datasets/${this.datasetId}/entities/campaigns/${campaignId}?organizationId=${organizationId}`
      );
    } catch (error) {
      if ((error as Error).message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  async listCampaigns(organizationId: string, options: QueryOptions = {}): Promise<Campaign[]> {
    const filters = [
      ...(options.filters || []),
      { field: 'organizationId', operator: 'eq' as const, value: organizationId },
    ];

    const query = this.buildQueryString({ ...options, filters });

    const response = await this.request<{ data: Campaign[] }>(
      `/datasets/${this.datasetId}/entities/campaigns?${query}`
    );

    return response.data;
  }

  async updateCampaign(campaignId: string, updates: Partial<Campaign>): Promise<Campaign> {
    return this.request<Campaign>(`/datasets/${this.datasetId}/entities/campaigns/${campaignId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  // ============================================
  // TOUCHPOINT OPERATIONS
  // ============================================

  async createTouchpoint(touchpoint: Omit<Touchpoint, 'touchpointId' | 'createdAt'>): Promise<Touchpoint> {
    return this.request<Touchpoint>(`/datasets/${this.datasetId}/entities/touchpoints`, {
      method: 'POST',
      body: JSON.stringify(touchpoint),
    });
  }

  async listTouchpoints(organizationId: string, options: QueryOptions = {}): Promise<Touchpoint[]> {
    const filters = [
      ...(options.filters || []),
      { field: 'organizationId', operator: 'eq' as const, value: organizationId },
    ];

    const query = this.buildQueryString({ ...options, filters });

    const response = await this.request<{ data: Touchpoint[] }>(
      `/datasets/${this.datasetId}/entities/touchpoints?${query}`
    );

    return response.data;
  }

  async listTouchpointsByPerson(personId: string, organizationId: string): Promise<Touchpoint[]> {
    return this.listTouchpoints(organizationId, {
      filters: [{ field: 'personId', operator: 'eq', value: personId }],
      orderBy: 'occurredAt',
      orderDirection: 'desc',
    });
  }

  // ============================================
  // RELATIONSHIP OPERATIONS
  // ============================================

  async createRelationship(relationship: Omit<Relationship, 'relationshipId' | 'createdAt' | 'updatedAt'>): Promise<Relationship> {
    return this.request<Relationship>(`/datasets/${this.datasetId}/entities/relationships`, {
      method: 'POST',
      body: JSON.stringify(relationship),
    });
  }

  async listRelationships(organizationId: string, options: QueryOptions = {}): Promise<Relationship[]> {
    const filters = [
      ...(options.filters || []),
      { field: 'organizationId', operator: 'eq' as const, value: organizationId },
    ];

    const query = this.buildQueryString({ ...options, filters });

    const response = await this.request<{ data: Relationship[] }>(
      `/datasets/${this.datasetId}/entities/relationships?${query}`
    );

    return response.data;
  }
}
