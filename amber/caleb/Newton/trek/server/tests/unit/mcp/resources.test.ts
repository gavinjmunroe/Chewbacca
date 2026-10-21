/**
 * Unit tests for MCP resources (resources.ts).
 * Tests all 14 resources via InMemoryTransport + Client.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  const mock = {
    db,
    closeDb: () => {},
    reinitialize: () => {},
    getPlaceWithTags: (placeId: number) => {
      const place: any = db.prepare(`SELECT p.*, c.name as category_name, c.color as category_color, c.icon as category_icon FROM places p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?`).get(placeId);
      if (!place) return null;
      const tags = db.prepare(`SELECT t.* FROM tags t JOIN place_tags pt ON t.id = pt.tag_id WHERE pt.place_id = ?`).all(placeId);
      return { ...place, category: place.category_id ? { id: place.category_id, name: place.category_name, color: place.category_color, icon: place.category_icon } : null, tags };
    },
    canAccessTrip: (tripId: any, userId: number) =>
      db.prepare(`SELECT t.id, t.user_id FROM trips t LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ? WHERE t.id = ? AND (t.user_id = ? OR m.user_id IS NOT NULL)`).get(userId, tripId, userId),
    isOwner: (tripId: any, userId: number) =>
      !!db.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId),
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test-jwt-secret-for-trek-testing-only',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));
vi.mock('../../../src/websocket', () => ({ broadcast: vi.fn() }));

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { resetTestDb } from '../../helpers/test-db';
import { createUser, createTrip, createDay, createPlace, addTripMember, createBudgetItem, createPackingItem, createReservation, createDayNote, createCollabNote, createBucketListItem, createVisitedCountry, createDayAssignment, createDayAccommodation } from '../../helpers/factories';
import { createMcpHarness, parseResourceResult, type McpHarness } from '../../helpers/mcp-harness';

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
});

afterAll(() => {
  testDb.close();
});

async function withHarness(userId: number, fn: (harness: McpHarness) => Promise<void>) {
  const harness = await createMcpHarness({ userId, withTools: false, withResources: true });
  try {
    await fn(harness);
  } finally {
    await harness.cleanup();
  }
}

describe('Resource: trek://trips', () => {
  it('returns all trips the user owns or is a member of', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    createTrip(testDb, user.id, { title: 'My Trip' });
    const sharedTrip = createTrip(testDb, other.id, { title: 'Shared Trip' });
    addTripMember(testDb, sharedTrip.id, user.id);
    // Trip from another user (not accessible)
    createTrip(testDb, other.id, { title: 'Other Trip' });

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: 'trek://trips' });
      const trips = parseResourceResult(result) as any[];
      expect(trips).toHaveLength(2);
      const titles = trips.map((t) => t.title);
      expect(titles).toContain('My Trip');
      expect(titles).toContain('Shared Trip');
      expect(titles).not.toContain('Other Trip');
    });
  });

  it('excludes archived trips', async () => {
    const { user } = createUser(testDb);
    createTrip(testDb, user.id, { title: 'Active Trip' });
    const archived = createTrip(testDb, user.id, { title: 'Archived Trip' });
    testDb.prepare('UPDATE trips SET is_archived = 1 WHERE id = ?').run(archived.id);

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: 'trek://trips' });
      const trips = parseResourceResult(result) as any[];
      expect(trips).toHaveLength(1);
      expect(trips[0].title).toBe('Active Trip');
    });
  });

  it('returns empty array when user has no trips', async () => {
    const { user } = createUser(testDb);
    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: 'trek://trips' });
      const trips = parseResourceResult(result) as any[];
      expect(trips).toEqual([]);
    });
  });
});

describe('Resource: trek://trips/{tripId}', () => {
  it('returns trip data for an accessible trip', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Paris Trip' });

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: `trek://trips/${trip.id}` });
      const data = parseResourceResult(result) as any;
      expect(data.title).toBe('Paris Trip');
      expect(data.id).toBe(trip.id);
    });
  });

  it('returns access denied for inaccessible trip', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    const otherTrip = createTrip(testDb, other.id, { title: 'Private' });

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: `trek://trips/${otherTrip.id}` });
      const data = parseResourceResult(result) as any;
      expect(data.error).toBeTruthy();
    });
  });

  it('returns access denied for non-existent ID', async () => {
    const { user } = createUser(testDb);
    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: 'trek://trips/99999' });
      const data = parseResourceResult(result) as any;
      expect(data.error).toBeTruthy();
    });
  });
});

describe('Resource: trek://trips/{tripId}/days', () => {
  it('returns days with assignments in order', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const day1 = createDay(testDb, trip.id, { day_number: 1 });
    const day2 = createDay(testDb, trip.id, { day_number: 2 });
    const place = createPlace(testDb, trip.id);
    createDayAssignment(testDb, day1.id, place.id);

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: `trek://trips/${trip.id}/days` });
      const days = parseResourceResult(result) as any[];
      expect(days).toHaveLength(2);
      expect(days[0].day_number).toBe(1);
      expect(days[0].assignments).toHaveLength(1);
      expect(days[1].day_number).toBe(2);
      expect(days[1].assignments).toHaveLength(0);
    });
  });

  it('returns access denied for unauthorized trip', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    const trip = createTrip(testDb, other.id);

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: `trek://trips/${trip.id}/days` });
      const data = parseResourceResult(result) as any;
      expect(data.error).toBeTruthy();
    });
  });
});

describe('Resource: trek://trips/{tripId}/places', () => {
  it('returns all places for a trip', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    createPlace(testDb, trip.id, { name: 'Eiffel Tower' });
    createPlace(testDb, trip.id, { name: 'Louvre' });

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: `trek://trips/${trip.id}/places` });
      const places = parseResourceResult(result) as any[];
      expect(places).toHaveLength(2);
      const names = places.map((p) => p.name);
      expect(names).toContain('Eiffel Tower');
      expect(names).toContain('Louvre');
    });
  });

  it('returns access denied for unauthorized trip', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    const trip = createTrip(testDb, other.id);

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: `trek://trips/${trip.id}/places` });
      const data = parseResourceResult(result) as any;
      expect(data.error).toBeTruthy();
    });
  });
});

describe('Resource: trek://trips/{tripId}/budget', () => {
  it('returns budget items for a trip', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    createBudgetItem(testDb, trip.id, { name: 'Hotel', category: 'Accommodation', total_price: 200 });

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: `trek://trips/${trip.id}/budget` });
      const items = parseResourceResult(result) as any[];
      expect(items).toHaveLength(1);
      expect(items[0].name).toBe('Hotel');
    });
  });

  it('returns access denied for unauthorized trip', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    const trip = createTrip(testDb, other.id);

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: `trek://trips/${trip.id}/budget` });
      const data = parseResourceResult(result) as any;
      expect(data.error).toBeTruthy();
    });
  });
});

describe('Resource: trek://trips/{tripId}/packing', () => {
  it('returns packing items for a trip', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    createPackingItem(testDb, trip.id, { name: 'Passport' });

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: `trek://trips/${trip.id}/packing` });
      const items = parseResourceResult(result) as any[];
      expect(items).toHaveLength(1);
      expect(items[0].name).toBe('Passport');
    });
  });

  it('returns access denied for unauthorized trip', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    const trip = createTrip(testDb, other.id);

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: `trek://trips/${trip.id}/packing` });
      const data = parseResourceResult(result) as any;
      expect(data.error).toBeTruthy();
    });
  });
});

describe('Resource: trek://trips/{tripId}/reservations', () => {
  it('returns reservations for a trip', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    createReservation(testDb, trip.id, { title: 'Flight to Paris', type: 'flight' });

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: `trek://trips/${trip.id}/reservations` });
      const items = parseResourceResult(result) as any[];
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('Flight to Paris');
    });
  });

  it('returns access denied for unauthorized trip', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    const trip = createTrip(testDb, other.id);

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: `trek://trips/${trip.id}/reservations` });
      const data = parseResourceResult(result) as any;
      expect(data.error).toBeTruthy();
    });
  });
});

describe('Resource: trek://trips/{tripId}/days/{dayId}/notes', () => {
  it('returns notes for a specific day', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const day = createDay(testDb, trip.id);
    createDayNote(testDb, day.id, trip.id, { text: 'Check in at noon' });

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: `trek://trips/${trip.id}/days/${day.id}/notes` });
      const notes = parseResourceResult(result) as any[];
      expect(notes).toHaveLength(1);
      expect(notes[0].text).toBe('Check in at noon');
    });
  });

  it('returns access denied for unauthorized trip', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    const trip = createTrip(testDb, other.id);
    const day = createDay(testDb, trip.id);

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: `trek://trips/${trip.id}/days/${day.id}/notes` });
      const data = parseResourceResult(result) as any;
      expect(data.error).toBeTruthy();
    });
  });

  it('returns access denied for invalid dayId', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: `trek://trips/${trip.id}/days/abc/notes` });
      const data = parseResourceResult(result) as any;
      expect(data.error).toBeTruthy();
    });
  });
});

describe('Resource: trek://trips/{tripId}/accommodations', () => {
  it('returns accommodations for a trip', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const day1 = createDay(testDb, trip.id, { day_number: 1 });
    const day2 = createDay(testDb, trip.id, { day_number: 2 });
    const place = createPlace(testDb, trip.id, { name: 'Grand Hotel' });
    createDayAccommodation(testDb, trip.id, place.id, day1.id, day2.id);

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: `trek://trips/${trip.id}/accommodations` });
      const items = parseResourceResult(result) as any[];
      expect(items).toHaveLength(1);
      expect(items[0].place_name).toBe('Grand Hotel');
    });
  });

  it('returns access denied for unauthorized trip', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    const trip = createTrip(testDb, other.id);

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: `trek://trips/${trip.id}/accommodations` });
      const data = parseResourceResult(result) as any;
      expect(data.error).toBeTruthy();
    });
  });
});

describe('Resource: trek://trips/{tripId}/members', () => {
  it('returns owner and collaborators', async () => {
    const { user } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    addTripMember(testDb, trip.id, member.id);

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: `trek://trips/${trip.id}/members` });
      const data = parseResourceResult(result) as any;
      expect(data.owner).toBeTruthy();
      expect(data.owner.id).toBe(user.id);
      expect(data.members).toHaveLength(1);
      expect(data.members[0].id).toBe(member.id);
    });
  });

  it('returns access denied for unauthorized trip', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    const trip = createTrip(testDb, other.id);

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: `trek://trips/${trip.id}/members` });
      const data = parseResourceResult(result) as any;
      expect(data.error).toBeTruthy();
    });
  });
});

describe('Resource: trek://trips/{tripId}/collab-notes', () => {
  it('returns collab notes with username', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    createCollabNote(testDb, trip.id, user.id, { title: 'Ideas' });

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: `trek://trips/${trip.id}/collab-notes` });
      const notes = parseResourceResult(result) as any[];
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe('Ideas');
      expect(notes[0].username).toBeTruthy();
    });
  });

  it('returns access denied for unauthorized trip', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    const trip = createTrip(testDb, other.id);

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: `trek://trips/${trip.id}/collab-notes` });
      const data = parseResourceResult(result) as any;
      expect(data.error).toBeTruthy();
    });
  });
});

describe('Resource: trek://categories', () => {
  it('returns all categories', async () => {
    const { user } = createUser(testDb);

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: 'trek://categories' });
      const categories = parseResourceResult(result) as any[];
      expect(categories.length).toBeGreaterThan(0);
      expect(categories[0]).toHaveProperty('id');
      expect(categories[0]).toHaveProperty('name');
      expect(categories[0]).toHaveProperty('color');
      expect(categories[0]).toHaveProperty('icon');
    });
  });
});

describe('Resource: trek://bucket-list', () => {
  it('returns only the current user\'s bucket list items', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    createBucketListItem(testDb, user.id, { name: 'Tokyo' });
    createBucketListItem(testDb, other.id, { name: 'Rome' });

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: 'trek://bucket-list' });
      const items = parseResourceResult(result) as any[];
      expect(items).toHaveLength(1);
      expect(items[0].name).toBe('Tokyo');
    });
  });

  it('returns empty array for user with no items', async () => {
    const { user } = createUser(testDb);

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: 'trek://bucket-list' });
      const items = parseResourceResult(result) as any[];
      expect(items).toEqual([]);
    });
  });
});

describe('Resource: trek://visited-countries', () => {
  it('returns only the current user\'s visited countries', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    createVisitedCountry(testDb, user.id, 'FR');
    createVisitedCountry(testDb, user.id, 'JP');
    createVisitedCountry(testDb, other.id, 'DE');

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: 'trek://visited-countries' });
      const countries = parseResourceResult(result) as any[];
      expect(countries).toHaveLength(2);
      const codes = countries.map((c) => c.country_code);
      expect(codes).toContain('FR');
      expect(codes).toContain('JP');
      expect(codes).not.toContain('DE');
    });
  });

  it('returns empty array for user with no visited countries', async () => {
    const { user } = createUser(testDb);

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: 'trek://visited-countries' });
      const countries = parseResourceResult(result) as any[];
      expect(countries).toEqual([]);
    });
  });
});
