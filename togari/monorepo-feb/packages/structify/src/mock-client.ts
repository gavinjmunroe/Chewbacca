import type { Person, Company, Campaign, Touchpoint, Relationship } from '@togari/core';
import { createLogger } from '@togari/core';
import type { QueryOptions } from './client';

const logger = createLogger('MockStructifyClient');

/**
 * Mock Structify Client for Development
 * Use this while waiting for Structify access
 */
export class MockStructifyClient {
  private people: Map<string, Person> = new Map();
  private companies: Map<string, Company> = new Map();
  private campaigns: Map<string, Campaign> = new Map();
  private touchpoints: Touchpoint[] = [];

  // ============================================
  // PERSON OPERATIONS
  // ============================================

  async createPerson(person: Omit<Person, 'personId' | 'createdAt' | 'updatedAt'>): Promise<Person> {
    const newPerson: Person = {
      ...person,
      personId: `per_${this.generateId()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Person;

    this.people.set(newPerson.personId, newPerson);
    logger.info('Created person', { personId: newPerson.personId, fullName: newPerson.fullName });
    return newPerson;
  }

  async getPerson(personId: string, organizationId: string): Promise<Person | null> {
    const person = this.people.get(personId);
    if (!person || person.organizationId !== organizationId) return null;
    return person;
  }

  async findPersonByLinkedIn(linkedinUrl: string, organizationId: string): Promise<Person | null> {
    for (const person of this.people.values()) {
      if (person.linkedinUrl === linkedinUrl && person.organizationId === organizationId) {
        return person;
      }
    }
    return null;
  }

  async listPeople(organizationId: string, options: QueryOptions = {}): Promise<Person[]> {
    let results = Array.from(this.people.values()).filter(
      (p) => p.organizationId === organizationId
    );

    // Apply filters with type-safe field access
    if (options.filters) {
      options.filters.forEach((filter) => {
        results = results.filter((person) => {
          const value = person[filter.field as keyof Person];
          switch (filter.operator) {
            case 'eq':
              return value === filter.value;
            case 'ne':
              return value !== filter.value;
            case 'contains':
              return String(value).includes(String(filter.value));
            default:
              return true;
          }
        });
      });
    }

    // Apply sorting with type-safe field access
    if (options.orderBy) {
      results.sort((a, b) => {
        const aVal = a[options.orderBy as keyof Person];
        const bVal = b[options.orderBy as keyof Person];
        const direction = options.orderDirection === 'desc' ? -1 : 1;
        if (aVal === undefined || bVal === undefined) return 0;
        return aVal > bVal ? direction : -direction;
      });
    }

    // Apply pagination
    const start = options.offset || 0;
    const end = options.limit ? start + options.limit : results.length;

    return results.slice(start, end);
  }

  async updatePerson(personId: string, updates: Partial<Person>): Promise<Person> {
    const person = this.people.get(personId);
    if (!person) throw new Error(`Person ${personId} not found`);

    const updatedPerson = {
      ...person,
      ...updates,
      updatedAt: new Date(),
    };

    this.people.set(personId, updatedPerson);
    logger.info('Updated person', { personId, fullName: updatedPerson.fullName });
    return updatedPerson;
  }

  async deletePerson(personId: string): Promise<void> {
    this.people.delete(personId);
    logger.info('Deleted person', { personId });
  }

  // ============================================
  // COMPANY OPERATIONS
  // ============================================

  async createCompany(company: Omit<Company, 'companyId' | 'createdAt' | 'updatedAt'>): Promise<Company> {
    const newCompany: Company = {
      ...company,
      companyId: `com_${this.generateId()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Company;

    this.companies.set(newCompany.companyId, newCompany);
    logger.info('Created company', { companyId: newCompany.companyId, name: newCompany.name });
    return newCompany;
  }

  async getCompany(companyId: string, organizationId: string): Promise<Company | null> {
    const company = this.companies.get(companyId);
    if (!company || company.organizationId !== organizationId) return null;
    return company;
  }

  async findCompanyByDomain(domain: string, organizationId: string): Promise<Company | null> {
    for (const company of this.companies.values()) {
      if (company.domain === domain && company.organizationId === organizationId) {
        return company;
      }
    }
    return null;
  }

  async listCompanies(organizationId: string, options: QueryOptions = {}): Promise<Company[]> {
    let results = Array.from(this.companies.values()).filter(
      (c) => c.organizationId === organizationId
    );

    // Apply filters
    if (options.filters) {
      options.filters.forEach((filter) => {
        results = results.filter((company) => {
          const value = company[filter.field as keyof Company];
          return filter.operator === 'eq' ? value === filter.value : true;
        });
      });
    }

    const start = options.offset || 0;
    const end = options.limit ? start + options.limit : results.length;

    return results.slice(start, end);
  }

  async updateCompany(companyId: string, updates: Partial<Company>): Promise<Company> {
    const company = this.companies.get(companyId);
    if (!company) throw new Error(`Company ${companyId} not found`);

    const updatedCompany = {
      ...company,
      ...updates,
      updatedAt: new Date(),
    };

    this.companies.set(companyId, updatedCompany);
    return updatedCompany;
  }

  // ============================================
  // CAMPAIGN OPERATIONS
  // ============================================

  async createCampaign(campaign: Omit<Campaign, 'campaignId' | 'createdAt' | 'updatedAt'>): Promise<Campaign> {
    const newCampaign: Campaign = {
      ...campaign,
      campaignId: `cam_${this.generateId()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Campaign;

    this.campaigns.set(newCampaign.campaignId, newCampaign);
    logger.info('Created campaign', { campaignId: newCampaign.campaignId, name: newCampaign.name });
    return newCampaign;
  }

  async getCampaign(campaignId: string, organizationId: string): Promise<Campaign | null> {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign || campaign.organizationId !== organizationId) return null;
    return campaign;
  }

  async listCampaigns(organizationId: string, options: QueryOptions = {}): Promise<Campaign[]> {
    let results = Array.from(this.campaigns.values()).filter(
      (c) => c.organizationId === organizationId
    );

    const start = options.offset || 0;
    const end = options.limit ? start + options.limit : results.length;

    return results.slice(start, end);
  }

  async updateCampaign(campaignId: string, updates: Partial<Campaign>): Promise<Campaign> {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    const updatedCampaign = {
      ...campaign,
      ...updates,
      updatedAt: new Date(),
    };

    this.campaigns.set(campaignId, updatedCampaign);
    return updatedCampaign;
  }

  // ============================================
  // TOUCHPOINT OPERATIONS
  // ============================================

  async createTouchpoint(touchpoint: Omit<Touchpoint, 'touchpointId' | 'createdAt'>): Promise<Touchpoint> {
    const newTouchpoint: Touchpoint = {
      ...touchpoint,
      touchpointId: `tch_${this.generateId()}`,
      createdAt: new Date(),
    } as Touchpoint;

    this.touchpoints.push(newTouchpoint);
    return newTouchpoint;
  }

  async listTouchpoints(organizationId: string, options: QueryOptions = {}): Promise<Touchpoint[]> {
    return this.touchpoints.filter((t) => t.organizationId === organizationId);
  }

  async listTouchpointsByPerson(personId: string, organizationId: string): Promise<Touchpoint[]> {
    return this.touchpoints
      .filter((t) => t.personId === personId && t.organizationId === organizationId)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  }

  // ============================================
  // RELATIONSHIP OPERATIONS
  // ============================================

  async createRelationship(
    relationship: Omit<Relationship, 'relationshipId' | 'createdAt' | 'updatedAt'>
  ): Promise<Relationship> {
    return {
      ...relationship,
      relationshipId: `rel_${this.generateId()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Relationship;
  }

  async listRelationships(organizationId: string): Promise<Relationship[]> {
    return [];
  }

  // ============================================
  // UTILITIES
  // ============================================

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  // Debug: View all data
  public debug() {
    logger.debug('Mock Structify Data', {
      people: this.people.size,
      companies: this.companies.size,
      campaigns: this.campaigns.size,
      touchpoints: this.touchpoints.length,
    });
  }
}
