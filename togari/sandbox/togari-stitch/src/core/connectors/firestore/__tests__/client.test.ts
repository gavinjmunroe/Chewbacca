import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FirestoreClient } from '../client';

// ============================================================================
// MOCK LEAF OBJECTS
//
// Firestore path for entities:
//   db.collection('tenants').doc(tenantId).collection('persons').doc(personId)
//
//  mockDb
//    .collection('tenants') → mockTenantCollection
//      .doc(tenantId)       → mockTenantDocRef
//        .collection(...)   → mockQuery  (acts as both subcollection + query)
//          .doc(entityId)   → mockDocRef (entity document ref)
//  mockDb
//    .doc('_health/status') → mockHealthDocRef
// ============================================================================

const mockDocRef = {
  set: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
};

const mockCountSnapshot = { data: vi.fn() };
const mockCountQuery = { get: vi.fn() };

// mockQuery doubles as both the entity subcollection reference AND a query ref.
// This means every .where() / .get() call is tracked on the same mock object,
// regardless of whether it came from the subcollection or a chained query.
const mockQuery = {
  doc: vi.fn(),     // subcollection.doc(entityId) → mockDocRef
  where: vi.fn(),   // → mockQuery (self-chaining)
  orderBy: vi.fn(), // → mockQuery
  offset: vi.fn(),  // → mockQuery
  limit: vi.fn(),   // → mockQuery
  count: vi.fn(),   // → mockCountQuery
  get: vi.fn(),
};

// Tenant document ref: db.collection('tenants').doc(tenantId)
const mockTenantDocRef = {
  collection: vi.fn(), // .collection('persons') → mockQuery
};

// Tenants root collection: db.collection('tenants')
const mockTenantCollection = {
  doc: vi.fn(), // .doc(tenantId) → mockTenantDocRef
};

// The _health sentinel doc ref (separate from entity doc refs)
const mockHealthDocRef = {
  get: vi.fn(),
  set: vi.fn(),
};

const mockDb = {
  collection: vi.fn(), // 'tenants' → mockTenantCollection
  doc: vi.fn(),        // '_health/status' → mockHealthDocRef
};

// ============================================================================
// VI.MOCK — hoisted above imports by Vitest
// ============================================================================

vi.mock('@google-cloud/firestore', () => {
  const FirestoreCtor = vi.fn();
  const Timestamp = {
    fromDate: (d: Date) => ({ toDate: () => d, _isTimestamp: true }),
    now: () => ({ toDate: () => new Date(), _isTimestamp: true }),
  };
  const FieldValue = {
    serverTimestamp: () => ({ _isFieldValue: true }),
  };
  return { Firestore: FirestoreCtor, Timestamp, FieldValue };
});

vi.mock('../../registry', () => ({
  connectorRegistry: {
    execute: vi.fn((_name: string, fn: () => unknown) => fn()),
  },
}));

// ============================================================================
// HELPERS
// ============================================================================

import { Firestore as _MockedFirestore } from '@google-cloud/firestore';
const FirestoreCtor = _MockedFirestore as unknown as ReturnType<typeof vi.fn>;

const TENANT_ID = 'tenant-abc';
const PROJECT_ID = 'test-project';

function makeClient() {
  return new FirestoreClient({ projectId: PROJECT_ID });
}

function makeDocSnapshot(data: Record<string, unknown>, exists = true) {
  return { exists, data: () => data };
}

function makeQuerySnapshot(docs: Record<string, unknown>[]) {
  return { docs: docs.map((data) => ({ data: () => data })) };
}

/** Re-apply all mock return values. Called in beforeEach after vi.clearAllMocks(). */
function restoreAllMocks() {
  // Firestore constructor → mockDb.
  // Must use a regular function (not arrow) because client.ts calls `new Firestore(...)`.
  // A constructor that explicitly returns an object causes `new` to evaluate to that object.
  FirestoreCtor.mockImplementation(function () { return mockDb; });

  // db.collection('tenants') → mockTenantCollection
  // db.doc('_health/status') → mockHealthDocRef
  mockDb.collection.mockReturnValue(mockTenantCollection);
  mockDb.doc.mockReturnValue(mockHealthDocRef);

  // tenantCollection.doc(tenantId) → mockTenantDocRef
  mockTenantCollection.doc.mockReturnValue(mockTenantDocRef);

  // tenantDocRef.collection('persons') → mockQuery (the entity subcollection)
  mockTenantDocRef.collection.mockReturnValue(mockQuery);

  // subcollection.doc(entityId) → mockDocRef
  mockQuery.doc.mockReturnValue(mockDocRef);

  // Entity doc CRUD defaults
  mockDocRef.set.mockResolvedValue(undefined);
  mockDocRef.update.mockResolvedValue(undefined);
  mockDocRef.delete.mockResolvedValue(undefined);
  // mockDocRef.get intentionally not set here — individual tests configure it

  // Chainable query methods (all return mockQuery for self-chaining)
  mockQuery.where.mockReturnValue(mockQuery);
  mockQuery.orderBy.mockReturnValue(mockQuery);
  mockQuery.offset.mockReturnValue(mockQuery);
  mockQuery.limit.mockReturnValue(mockQuery);
  mockQuery.count.mockReturnValue(mockCountQuery);

  // Count query defaults
  mockCountQuery.get.mockResolvedValue(mockCountSnapshot);
  mockCountSnapshot.data.mockReturnValue({ count: 0 });

  // Health doc ref
  mockHealthDocRef.get.mockResolvedValue(makeDocSnapshot({ status: 'ok' }));
  mockHealthDocRef.set.mockResolvedValue(undefined);
}

// ============================================================================
// TESTS
// ============================================================================

describe('FirestoreClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // CONSTRUCTOR
  // --------------------------------------------------------------------------

  it('initializes Firestore with projectId', () => {
    makeClient();
    expect(FirestoreCtor).toHaveBeenCalledWith({ projectId: PROJECT_ID });
  });

  it('passes databaseId when provided', () => {
    new FirestoreClient({ projectId: PROJECT_ID, databaseId: 'my-db' });
    expect(FirestoreCtor).toHaveBeenCalledWith({ projectId: PROJECT_ID, databaseId: 'my-db' });
  });

  // --------------------------------------------------------------------------
  // PERSON CRUD
  // --------------------------------------------------------------------------

  describe('createPerson', () => {
    it('writes to tenant subcollection path', async () => {
      const client = makeClient();
      const input = {
        linkedinUrl: 'https://linkedin.com/in/jane',
        fullName: 'Jane Doe',
        vertical: 'healthcare' as const,
        sourceType: 'manual_entry' as const,
        sourceChannel: 'direct' as const,
        client_id: TENANT_ID,
      };

      const person = await client.createPerson(input);

      // Verify path: db.collection('tenants').doc(tenantId).collection('persons').doc(id)
      expect(mockDb.collection).toHaveBeenCalledWith('tenants');
      expect(mockTenantCollection.doc).toHaveBeenCalledWith(TENANT_ID);
      expect(mockDocRef.set).toHaveBeenCalledOnce();

      // Returned person shape
      expect(person.personId).toMatch(/^person_/);
      expect(person.fullName).toBe('Jane Doe');
      expect(person.client_id).toBe(TENANT_ID);
      expect(person.internalScore).toBe(0);
      expect(person.compositeScore).toBe(0);
      expect(person.currentStatus).toBe('new');
      expect(person.routingTier).toBe('nurture');
      expect(person.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('getPerson', () => {
    it('returns Person when document exists', async () => {
      const client = makeClient();
      const now = new Date();
      mockDocRef.get.mockResolvedValueOnce(
        makeDocSnapshot({
          personId: 'person_123',
          fullName: 'John Smith',
          client_id: TENANT_ID,
          createdAt: { toDate: () => now, _isTimestamp: true },
          updatedAt: { toDate: () => now, _isTimestamp: true },
        })
      );

      const person = await client.getPerson('person_123', TENANT_ID);

      expect(person).not.toBeNull();
      expect(person!.personId).toBe('person_123');
      expect(person!.fullName).toBe('John Smith');
      expect(person!.createdAt).toBeInstanceOf(Date);
    });

    it('returns null when document does not exist', async () => {
      const client = makeClient();
      mockDocRef.get.mockResolvedValueOnce(makeDocSnapshot({}, false));

      const person = await client.getPerson('nonexistent', TENANT_ID);
      expect(person).toBeNull();
    });

    it('reads from tenant-scoped path (isolation)', async () => {
      const client = makeClient();
      mockDocRef.get.mockResolvedValueOnce(makeDocSnapshot({}, false));

      await client.getPerson('person_123', TENANT_ID);

      expect(mockDb.collection).toHaveBeenCalledWith('tenants');
      expect(mockTenantCollection.doc).toHaveBeenCalledWith(TENANT_ID);
    });
  });

  describe('listPersons', () => {
    it('throws if clientId is not provided', async () => {
      const client = makeClient();
      await expect(client.listPersons({ filters: [] })).rejects.toThrow('clientId is required');
    });

    it('strips client_id filters (path-based isolation)', async () => {
      const client = makeClient();
      mockQuery.get.mockResolvedValueOnce(makeQuerySnapshot([]));

      await client.listPersons({
        filters: [{ field: 'client_id', operator: 'eq', value: TENANT_ID }],
        clientId: TENANT_ID,
      });

      // where() should NOT have been called with 'client_id'
      const whereCalls = mockQuery.where.mock.calls;
      const clientIdCall = whereCalls.find((args) => args[0] === 'client_id');
      expect(clientIdCall).toBeUndefined();
    });

    it('returns paginated response', async () => {
      const client = makeClient();
      mockCountSnapshot.data.mockReturnValue({ count: 2 });
      mockQuery.get.mockResolvedValueOnce(
        makeQuerySnapshot([
          { personId: 'p1', fullName: 'Alice' },
          { personId: 'p2', fullName: 'Bob' },
        ])
      );

      const result = await client.listPersons({ limit: 10, offset: 0, clientId: TENANT_ID });

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it('applies contains filter in-memory (case-insensitive)', async () => {
      const client = makeClient();
      mockCountSnapshot.data.mockReturnValue({ count: 2 });
      mockQuery.get.mockResolvedValueOnce(
        makeQuerySnapshot([
          { personId: 'p1', fullName: 'Alice Health' },
          { personId: 'p2', fullName: 'Bob Smith' },
        ])
      );

      const result = await client.listPersons({
        filters: [{ field: 'fullName', operator: 'contains', value: 'health' }],
        clientId: TENANT_ID,
      });

      expect(result.data).toHaveLength(1);
      expect((result.data[0] as any).fullName).toBe('Alice Health');
    });
  });

  describe('updatePerson', () => {
    it('calls ref.update() with updatedAt injected', async () => {
      const client = makeClient();
      const now = new Date();
      mockDocRef.get.mockResolvedValueOnce(
        makeDocSnapshot({
          personId: 'p1',
          fullName: 'Old Name',
          updatedAt: { toDate: () => now, _isTimestamp: true },
        })
      );

      await client.updatePerson('p1', { fullName: 'New Name' } as any, TENANT_ID);

      expect(mockDocRef.update).toHaveBeenCalledOnce();
      const updateArg = mockDocRef.update.mock.calls[0][0];
      expect(updateArg.fullName).toBe('New Name');
      expect(updateArg.updatedAt).toBeDefined(); // converted to Timestamp
    });
  });

  describe('deletePerson', () => {
    it('deletes from tenant-scoped path', async () => {
      const client = makeClient();
      await client.deletePerson('p1', TENANT_ID);

      expect(mockDocRef.delete).toHaveBeenCalledOnce();
      expect(mockTenantCollection.doc).toHaveBeenCalledWith(TENANT_ID);
    });
  });

  // --------------------------------------------------------------------------
  // COMPANY CRUD
  // --------------------------------------------------------------------------

  describe('createCompany', () => {
    it('creates company with generated ID and timestamps', async () => {
      const client = makeClient();
      const company = await client.createCompany({
        domain: 'acmehealth.com',
        name: 'Acme Health',
        vertical: 'healthcare',
        client_id: TENANT_ID,
      });

      expect(company.companyId).toMatch(/^company_/);
      expect(company.domain).toBe('acmehealth.com');
      expect(company.client_id).toBe(TENANT_ID);
      expect(mockDocRef.set).toHaveBeenCalledOnce();
    });
  });

  describe('listCompanies', () => {
    it('throws if clientId is not provided', async () => {
      const client = makeClient();
      await expect(client.listCompanies({})).rejects.toThrow('clientId is required');
    });
  });

  // --------------------------------------------------------------------------
  // CAMPAIGN CRUD
  // --------------------------------------------------------------------------

  describe('createCampaign', () => {
    it('creates campaign with defaults', async () => {
      const client = makeClient();
      const campaign = await client.createCampaign({
        name: 'Q1 Outreach',
        campaignType: 'outbound_email',
        vertical: 'healthcare',
        client_id: TENANT_ID,
      });

      expect(campaign.campaignId).toMatch(/^campaign_/);
      expect(campaign.status).toBe('draft');
      expect(campaign.totalLeads).toBe(0);
      expect(campaign.emailsSent).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // TOUCHPOINT CRUD
  // --------------------------------------------------------------------------

  describe('createTouchpoint', () => {
    it('creates touchpoint with occurredAt defaulting to now', async () => {
      const client = makeClient();
      const touchpoint = await client.createTouchpoint({
        personId: 'p1',
        touchpointType: 'email_sent',
        channel: 'email',
        direction: 'outbound',
        client_id: TENANT_ID,
      });

      expect(touchpoint.touchpointId).toMatch(/^touchpoint_/);
      expect(touchpoint.occurredAt).toBeInstanceOf(Date);
    });
  });

  describe('listTouchpointsForPerson', () => {
    it('adds personId eq filter', async () => {
      const client = makeClient();
      mockQuery.get.mockResolvedValueOnce(makeQuerySnapshot([]));

      await client.listTouchpointsForPerson('p1', { clientId: TENANT_ID });

      const whereCalls = mockQuery.where.mock.calls;
      const personFilter = whereCalls.find((args) => args[0] === 'personId');
      expect(personFilter).toBeDefined();
      expect(personFilter![2]).toBe('p1');
    });
  });

  // --------------------------------------------------------------------------
  // RELATIONSHIP CRUD
  // --------------------------------------------------------------------------

  describe('createRelationship', () => {
    it('creates relationship with default strength=50', async () => {
      const client = makeClient();
      const rel = await client.createRelationship({
        personAId: 'p1',
        personBId: 'p2',
        relationshipType: 'colleague',
        client_id: TENANT_ID,
      });

      expect(rel.relationshipId).toMatch(/^relationship_/);
      expect(rel.strength).toBe(50);
      expect(rel.interactionCount).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // DATE ROUND-TRIP
  // --------------------------------------------------------------------------

  describe('date serialization', () => {
    it('converts Timestamp to Date on read from Firestore', async () => {
      const client = makeClient();
      const testDate = new Date('2026-01-15T10:00:00Z');
      mockDocRef.get.mockResolvedValueOnce(
        makeDocSnapshot({
          personId: 'p1',
          fullName: 'Test',
          client_id: TENANT_ID,
          createdAt: { toDate: () => testDate, _isTimestamp: true },
          updatedAt: { toDate: () => testDate, _isTimestamp: true },
        })
      );

      const person = await client.getPerson('p1', TENANT_ID);
      expect(person!.createdAt).toBeInstanceOf(Date);
      expect(person!.createdAt.getTime()).toBe(testDate.getTime());
    });
  });

  // --------------------------------------------------------------------------
  // HEALTH CHECK
  // --------------------------------------------------------------------------

  describe('healthCheck', () => {
    it('returns true when sentinel document is readable', async () => {
      const client = makeClient();
      // mockHealthDocRef.get is already set to return { status: 'ok' } in restoreAllMocks
      const healthy = await client.healthCheck();
      expect(healthy).toBe(true);
    });

    it('creates sentinel document if it does not exist', async () => {
      const client = makeClient();
      mockHealthDocRef.get.mockResolvedValueOnce(makeDocSnapshot({}, false));

      await client.healthCheck();
      expect(mockHealthDocRef.set).toHaveBeenCalledOnce();
    });

    it('throws on timeout', async () => {
      const client = makeClient();
      mockHealthDocRef.get.mockImplementationOnce(() => new Promise(() => {}));

      await expect(client.healthCheck()).rejects.toThrow(/timed out/);
    }, 10_000);
  });

  // --------------------------------------------------------------------------
  // FILTER OPERATORS
  // --------------------------------------------------------------------------

  describe('filter translation', () => {
    it.each([
      ['eq', '=='],
      ['ne', '!='],
      ['gt', '>'],
      ['gte', '>='],
      ['lt', '<'],
      ['lte', '<='],
      ['in', 'in'],
    ])('translates %s operator → Firestore %s', async (op, fsOp) => {
      const client = makeClient();
      mockQuery.get.mockResolvedValueOnce(makeQuerySnapshot([]));

      await client.listPersons({
        filters: [{ field: 'compositeScore', operator: op as any, value: 50 }],
        clientId: TENANT_ID,
      });

      const whereCalls = mockQuery.where.mock.calls;
      const scoreFilter = whereCalls.find((args) => args[0] === 'compositeScore');
      expect(scoreFilter).toBeDefined();
      expect(scoreFilter![1]).toBe(fsOp);
    });
  });
});
