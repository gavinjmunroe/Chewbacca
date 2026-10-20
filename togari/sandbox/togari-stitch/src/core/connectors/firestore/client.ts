import { Firestore, Timestamp, FieldValue, Query, CollectionReference } from '@google-cloud/firestore';
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
import { generateId } from '../../utils';
import { connectorRegistry } from '../registry';
import { createLogger } from '../../utils/logger';
import type { FirestoreConfig, QueryOptions, QueryFilter, PaginatedResponse } from './types';

const logger = createLogger('FirestoreClient');

// ============================================================================
// FIRESTORE CLIENT
// ============================================================================

/**
 * Cloud Firestore client for CRUD operations on all healthcare entities.
 *
 * Data model: subcollection-per-tenant pattern
 *   /tenants/{tenantId}/persons/{personId}
 *   /tenants/{tenantId}/companies/{companyId}
 *   /tenants/{tenantId}/campaigns/{campaignId}
 *   /tenants/{tenantId}/touchpoints/{touchpointId}
 *   /tenants/{tenantId}/relationships/{relationshipId}
 *
 * Tenant isolation is path-based (not field-based). Admin SDK calls bypass
 * Firestore Security Rules — the application layer enforces tenant scoping
 * by always routing through tenantCollection().
 */
export class FirestoreClient {
  private db: Firestore;

  constructor(config: FirestoreConfig) {
    this.db = new Firestore({
      projectId: config.projectId,
      ...(config.databaseId ? { databaseId: config.databaseId } : {}),
    });
  }

  // ============================================================================
  // TENANT-SCOPED PATH HELPER
  // ============================================================================

  private tenantCollection(tenantId: string, collection: string): CollectionReference {
    return this.db.collection('tenants').doc(tenantId).collection(collection);
  }

  // ============================================================================
  // SERIALIZATION HELPERS
  // ============================================================================

  /**
   * Convert a plain object's Date fields to Firestore Timestamps for storage.
   */
  private toFirestoreData(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value instanceof Date) {
        result[key] = Timestamp.fromDate(value);
      } else if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Convert a Firestore document's Timestamp fields back to JS Dates.
   */
  private fromFirestoreData(data: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== null && typeof value === 'object' && typeof (value as any).toDate === 'function') {
        result[key] = (value as any).toDate();
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  // ============================================================================
  // QUERY BUILDER
  // ============================================================================

  /**
   * Apply QueryFilters to a Firestore Query.
   * - Skips client_id filters (isolation is path-based)
   * - 'contains' operator is handled via in-memory filter after fetch
   */
  private applyFilters(
    query: Query,
    filters: QueryFilter[]
  ): { query: Query; inMemoryFilters: QueryFilter[] } {
    const inMemoryFilters: QueryFilter[] = [];

    for (const filter of filters) {
      // Skip client_id — tenant isolation is path-based, no field filter needed
      if (filter.field === 'client_id') continue;

      switch (filter.operator) {
        case 'eq':
          query = query.where(filter.field, '==', filter.value);
          break;
        case 'ne':
          query = query.where(filter.field, '!=', filter.value);
          break;
        case 'gt':
          query = query.where(filter.field, '>', filter.value);
          break;
        case 'gte':
          query = query.where(filter.field, '>=', filter.value);
          break;
        case 'lt':
          query = query.where(filter.field, '<', filter.value);
          break;
        case 'lte':
          query = query.where(filter.field, '<=', filter.value);
          break;
        case 'in':
          query = query.where(filter.field, 'in', filter.value);
          break;
        case 'contains':
          // No native Firestore substring match — apply after fetch
          inMemoryFilters.push(filter);
          break;
      }
    }

    return { query, inMemoryFilters };
  }

  /**
   * Apply in-memory 'contains' filters (case-insensitive substring match).
   */
  private applyInMemoryFilters<T extends Record<string, unknown>>(
    items: T[],
    filters: QueryFilter[]
  ): T[] {
    return items.filter((item) =>
      filters.every((f) => {
        const fieldValue = item[f.field];
        if (typeof fieldValue !== 'string') return false;
        return fieldValue.toLowerCase().includes(String(f.value).toLowerCase());
      })
    );
  }

  /**
   * Execute a list query with pagination, ordering, and filtering.
   * Returns a PaginatedResponse matching the QueryOptions contract.
   */
  private async executeListQuery<T extends Record<string, unknown>>(
    collection: CollectionReference,
    options?: QueryOptions
  ): Promise<PaginatedResponse<T>> {
    return connectorRegistry.execute('firestore', async () => {
      const limit = options?.limit ?? 25;
      const offset = options?.offset ?? 0;
      const filters = options?.filters ?? [];

      let query: Query = collection;

      const { query: filteredQuery, inMemoryFilters } = this.applyFilters(query, filters);
      query = filteredQuery;

      if (options?.orderBy) {
        query = query.orderBy(options.orderBy, options.orderDirection ?? 'asc');
      }

      // Get total count (before pagination)
      const countSnapshot = await query.count().get();
      const total = countSnapshot.data().count;

      // Apply pagination
      query = query.offset(offset).limit(limit);

      const snapshot = await query.get();
      let items = snapshot.docs.map((doc) =>
        this.fromFirestoreData(doc.data() as Record<string, unknown>) as T
      );

      // Apply in-memory contains filters
      if (inMemoryFilters.length > 0) {
        items = this.applyInMemoryFilters(items, inMemoryFilters);
      }

      return {
        data: items,
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
      };
    });
  }

  // ============================================================================
  // PERSON CRUD
  // ============================================================================

  async createPerson(input: CreatePersonInput): Promise<Person> {
    return connectorRegistry.execute('firestore', async () => {
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

      const col = this.tenantCollection(input.client_id, 'persons');
      await col.doc(person.personId).set(this.toFirestoreData(person as unknown as Record<string, unknown>));
      logger.info('Created person', { personId: person.personId });
      return person;
    });
  }

  async getPerson(personId: string, tenantId: string): Promise<Person | null> {
    return connectorRegistry.execute('firestore', async () => {
      const doc = await this.tenantCollection(tenantId, 'persons').doc(personId).get();
      if (!doc.exists) return null;
      return this.fromFirestoreData(doc.data() as Record<string, unknown>) as unknown as Person;
    });
  }

  async findPersonByLinkedIn(linkedinUrl: string, tenantId: string): Promise<Person | null> {
    const results = await this.listPersons({ filters: [{ field: 'linkedinUrl', operator: 'eq', value: linkedinUrl }], limit: 1, clientId: tenantId });
    return results.data[0] ?? null;
  }

  async listPersons(options?: QueryOptions): Promise<PaginatedResponse<Person>> {
    const tenantId = options?.clientId;
    if (!tenantId) throw new Error('clientId is required for listPersons');
    const col = this.tenantCollection(tenantId, 'persons');
    return this.executeListQuery<Person & Record<string, unknown>>(col, options);
  }

  async updatePerson(personId: string, updates: UpdatePersonInput, tenantId: string): Promise<Person> {
    return connectorRegistry.execute('firestore', async () => {
      const ref = this.tenantCollection(tenantId, 'persons').doc(personId);
      const updateData = this.toFirestoreData({ ...updates, updatedAt: new Date() } as Record<string, unknown>);
      await ref.update(updateData);
      const doc = await ref.get();
      return this.fromFirestoreData(doc.data() as Record<string, unknown>) as unknown as Person;
    });
  }

  async deletePerson(personId: string, tenantId: string): Promise<void> {
    return connectorRegistry.execute('firestore', async () => {
      await this.tenantCollection(tenantId, 'persons').doc(personId).delete();
      logger.info('Deleted person', { personId });
    });
  }

  // ============================================================================
  // COMPANY CRUD
  // ============================================================================

  async createCompany(input: CreateCompanyInput): Promise<Company> {
    return connectorRegistry.execute('firestore', async () => {
      const now = new Date();
      const company: Company = {
        companyId: generateId('company'),
        ...input,
        createdAt: now,
        updatedAt: now,
      };

      const col = this.tenantCollection(input.client_id, 'companies');
      await col.doc(company.companyId).set(this.toFirestoreData(company as unknown as Record<string, unknown>));
      logger.info('Created company', { companyId: company.companyId });
      return company;
    });
  }

  async getCompany(companyId: string, tenantId: string): Promise<Company | null> {
    return connectorRegistry.execute('firestore', async () => {
      const doc = await this.tenantCollection(tenantId, 'companies').doc(companyId).get();
      if (!doc.exists) return null;
      return this.fromFirestoreData(doc.data() as Record<string, unknown>) as unknown as Company;
    });
  }

  async findCompanyByDomain(domain: string, tenantId: string): Promise<Company | null> {
    const results = await this.listCompanies({ filters: [{ field: 'domain', operator: 'eq', value: domain }], limit: 1, clientId: tenantId });
    return results.data[0] ?? null;
  }

  async listCompanies(options?: QueryOptions): Promise<PaginatedResponse<Company>> {
    const tenantId = options?.clientId;
    if (!tenantId) throw new Error('clientId is required for listCompanies');
    const col = this.tenantCollection(tenantId, 'companies');
    return this.executeListQuery<Company & Record<string, unknown>>(col, options);
  }

  async updateCompany(companyId: string, updates: Partial<Company>, tenantId: string): Promise<Company> {
    return connectorRegistry.execute('firestore', async () => {
      const ref = this.tenantCollection(tenantId, 'companies').doc(companyId);
      const updateData = this.toFirestoreData({ ...updates, updatedAt: new Date() } as Record<string, unknown>);
      await ref.update(updateData);
      const doc = await ref.get();
      return this.fromFirestoreData(doc.data() as Record<string, unknown>) as unknown as Company;
    });
  }

  // ============================================================================
  // CAMPAIGN CRUD
  // ============================================================================

  async createCampaign(input: CreateCampaignInput): Promise<Campaign> {
    return connectorRegistry.execute('firestore', async () => {
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

      const col = this.tenantCollection(input.client_id, 'campaigns');
      await col.doc(campaign.campaignId).set(this.toFirestoreData(campaign as unknown as Record<string, unknown>));
      logger.info('Created campaign', { campaignId: campaign.campaignId });
      return campaign;
    });
  }

  async getCampaign(campaignId: string, tenantId: string): Promise<Campaign | null> {
    return connectorRegistry.execute('firestore', async () => {
      const doc = await this.tenantCollection(tenantId, 'campaigns').doc(campaignId).get();
      if (!doc.exists) return null;
      return this.fromFirestoreData(doc.data() as Record<string, unknown>) as unknown as Campaign;
    });
  }

  async listCampaigns(options?: QueryOptions): Promise<PaginatedResponse<Campaign>> {
    const tenantId = options?.clientId;
    if (!tenantId) throw new Error('clientId is required for listCampaigns');
    const col = this.tenantCollection(tenantId, 'campaigns');
    return this.executeListQuery<Campaign & Record<string, unknown>>(col, options);
  }

  async updateCampaign(campaignId: string, updates: Partial<Campaign>, tenantId: string): Promise<Campaign> {
    return connectorRegistry.execute('firestore', async () => {
      const ref = this.tenantCollection(tenantId, 'campaigns').doc(campaignId);
      const updateData = this.toFirestoreData({ ...updates, updatedAt: new Date() } as Record<string, unknown>);
      await ref.update(updateData);
      const doc = await ref.get();
      return this.fromFirestoreData(doc.data() as Record<string, unknown>) as unknown as Campaign;
    });
  }

  // ============================================================================
  // TOUCHPOINT CRUD
  // ============================================================================

  async createTouchpoint(input: CreateTouchpointInput): Promise<Touchpoint> {
    return connectorRegistry.execute('firestore', async () => {
      const now = new Date();
      const touchpoint: Touchpoint = {
        touchpointId: generateId('touchpoint'),
        ...input,
        occurredAt: input.occurredAt ?? now,
        createdAt: now,
      };

      const col = this.tenantCollection(input.client_id, 'touchpoints');
      await col.doc(touchpoint.touchpointId).set(this.toFirestoreData(touchpoint as unknown as Record<string, unknown>));
      logger.info('Created touchpoint', { touchpointId: touchpoint.touchpointId });
      return touchpoint;
    });
  }

  async listTouchpoints(options?: QueryOptions): Promise<PaginatedResponse<Touchpoint>> {
    const tenantId = options?.clientId;
    if (!tenantId) throw new Error('clientId is required for listTouchpoints');
    const col = this.tenantCollection(tenantId, 'touchpoints');
    return this.executeListQuery<Touchpoint & Record<string, unknown>>(col, options);
  }

  async listTouchpointsForPerson(personId: string, options?: QueryOptions): Promise<PaginatedResponse<Touchpoint>> {
    return this.listTouchpoints({
      ...options,
      filters: [
        { field: 'personId', operator: 'eq', value: personId },
        ...(options?.filters ?? []),
      ],
    });
  }

  // ============================================================================
  // RELATIONSHIP CRUD
  // ============================================================================

  async createRelationship(input: CreateRelationshipInput): Promise<Relationship> {
    return connectorRegistry.execute('firestore', async () => {
      const now = new Date();
      const relationship: Relationship = {
        relationshipId: generateId('relationship'),
        ...input,
        strength: input.strength ?? 50,
        interactionCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      const col = this.tenantCollection(input.client_id, 'relationships');
      await col.doc(relationship.relationshipId).set(this.toFirestoreData(relationship as unknown as Record<string, unknown>));
      logger.info('Created relationship', { relationshipId: relationship.relationshipId });
      return relationship;
    });
  }

  async listRelationships(options?: QueryOptions): Promise<PaginatedResponse<Relationship>> {
    const tenantId = options?.clientId;
    if (!tenantId) throw new Error('clientId is required for listRelationships');
    const col = this.tenantCollection(tenantId, 'relationships');
    return this.executeListQuery<Relationship & Record<string, unknown>>(col, options);
  }

  async listRelationshipsForPerson(personId: string, options?: QueryOptions): Promise<PaginatedResponse<Relationship>> {
    return this.listRelationships({
      ...options,
      filters: [
        { field: 'personAId', operator: 'eq', value: personId },
        ...(options?.filters ?? []),
      ],
    });
  }

  async updateRelationship(relationshipId: string, updates: Partial<Relationship>, tenantId: string): Promise<Relationship> {
    return connectorRegistry.execute('firestore', async () => {
      const ref = this.tenantCollection(tenantId, 'relationships').doc(relationshipId);
      const updateData = this.toFirestoreData({ ...updates, updatedAt: new Date() } as Record<string, unknown>);
      await ref.update(updateData);
      const doc = await ref.get();
      return this.fromFirestoreData(doc.data() as Record<string, unknown>) as unknown as Relationship;
    });
  }

  // ============================================================================
  // HEALTH CHECK
  // ============================================================================

  /**
   * Verify Firestore connectivity by reading a sentinel document.
   * Creates the sentinel if it doesn't exist.
   */
  async healthCheck(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const ref = this.db.doc('_health/status');
      const doc = await Promise.race([
        ref.get(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Firestore health check timed out after 5s')), 5000)
        ),
      ]);

      if (!doc.exists) {
        // Create sentinel document on first check
        await ref.set({ status: 'ok', lastChecked: FieldValue.serverTimestamp() });
      }

      return true;
    } finally {
      clearTimeout(timeout);
    }
  }
}
