/**
 * Admin integration tests.
 * Covers ADMIN-001 to ADMIN-022.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';

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

vi.mock('../../src/db/database', () => dbMock);
vi.mock('../../src/config', () => ({
  JWT_SECRET: 'test-jwt-secret-for-trek-testing-only',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));

import { createApp } from '../../src/app';
import { createTables } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrations';
import { resetTestDb } from '../helpers/test-db';
import { createUser, createAdmin, createInviteToken } from '../helpers/factories';
import { authCookie } from '../helpers/auth';
import { loginAttempts, mfaAttempts } from '../../src/routes/auth';

const app: Application = createApp();

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  loginAttempts.clear();
  mfaAttempts.clear();
});

afterAll(() => {
  testDb.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Access control
// ─────────────────────────────────────────────────────────────────────────────

describe('Admin access control', () => {
  it('ADMIN-022 — non-admin cannot access admin routes', async () => {
    const { user } = createUser(testDb);

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', authCookie(user.id));
    expect(res.status).toBe(403);
  });

  it('ADMIN-022 — unauthenticated request returns 401', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// User management
// ─────────────────────────────────────────────────────────────────────────────

describe('Admin user management', () => {
  it('ADMIN-001 — GET /admin/users lists all users', async () => {
    const { user: admin } = createAdmin(testDb);
    createUser(testDb);
    createUser(testDb);

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(3);
  });

  it('ADMIN-002 — POST /admin/users creates a user', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .post('/api/admin/users')
      .set('Cookie', authCookie(admin.id))
      .send({ username: 'newuser', email: 'newuser@example.com', password: 'Secure1234!', role: 'user' });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('newuser@example.com');
  });

  it('ADMIN-003 — POST /admin/users with duplicate email returns 409', async () => {
    const { user: admin } = createAdmin(testDb);
    const { user: existing } = createUser(testDb);

    const res = await request(app)
      .post('/api/admin/users')
      .set('Cookie', authCookie(admin.id))
      .send({ username: 'duplicate', email: existing.email, password: 'Secure1234!' });
    expect(res.status).toBe(409);
  });

  it('ADMIN-004 — PUT /admin/users/:id updates user', async () => {
    const { user: admin } = createAdmin(testDb);
    const { user } = createUser(testDb);

    const res = await request(app)
      .put(`/api/admin/users/${user.id}`)
      .set('Cookie', authCookie(admin.id))
      .send({ username: 'updated_username' });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('updated_username');
  });

  it('ADMIN-005 — DELETE /admin/users/:id removes user', async () => {
    const { user: admin } = createAdmin(testDb);
    const { user } = createUser(testDb);

    const res = await request(app)
      .delete(`/api/admin/users/${user.id}`)
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify the row is actually gone from the DB
    const deleted = testDb.prepare('SELECT id FROM users WHERE id = ?').get(user.id);
    expect(deleted).toBeUndefined();
  });

  it('ADMIN-006 — admin cannot delete their own account', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .delete(`/api/admin/users/${admin.id}`)
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// System stats
// ─────────────────────────────────────────────────────────────────────────────

describe('System stats', () => {
  it('ADMIN-007 — GET /admin/stats returns system statistics', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalUsers');
    expect(res.body).toHaveProperty('totalTrips');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Permissions
// ─────────────────────────────────────────────────────────────────────────────

describe('Permissions management', () => {
  it('ADMIN-008 — GET /admin/permissions returns permission config', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .get('/api/admin/permissions')
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('permissions');
    expect(Array.isArray(res.body.permissions)).toBe(true);
  });

  it('ADMIN-008 — PUT /admin/permissions updates permissions and change persists', async () => {
    const { user: admin } = createAdmin(testDb);

    // Change trip_create from its default ('everybody') to 'admin'
    const res = await request(app)
      .put('/api/admin/permissions')
      .set('Cookie', authCookie(admin.id))
      .send({ permissions: { trip_create: 'admin' } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Re-fetch and verify the change persisted
    const getRes = await request(app)
      .get('/api/admin/permissions')
      .set('Cookie', authCookie(admin.id));
    expect(getRes.status).toBe(200);
    const tripCreatePerm = getRes.body.permissions.find((p: any) => p.key === 'trip_create');
    expect(tripCreatePerm).toBeDefined();
    expect(tripCreatePerm.level).toBe('admin');
  });

  it('ADMIN-008 — PUT /admin/permissions without object returns 400', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .put('/api/admin/permissions')
      .set('Cookie', authCookie(admin.id))
      .send({ permissions: null });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Audit log
// ─────────────────────────────────────────────────────────────────────────────

describe('Audit log', () => {
  it('ADMIN-009 — GET /admin/audit-log returns log entries', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .get('/api/admin/audit-log')
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Addon management
// ─────────────────────────────────────────────────────────────────────────────

describe('Addon management', () => {
  it('ADMIN-011 — PUT /admin/addons/:id disables an addon', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .put('/api/admin/addons/atlas')
      .set('Cookie', authCookie(admin.id))
      .send({ enabled: false });
    expect(res.status).toBe(200);
  });

  it('ADMIN-012 — PUT /admin/addons/:id re-enables an addon', async () => {
    const { user: admin } = createAdmin(testDb);

    await request(app)
      .put('/api/admin/addons/atlas')
      .set('Cookie', authCookie(admin.id))
      .send({ enabled: false });

    const res = await request(app)
      .put('/api/admin/addons/atlas')
      .set('Cookie', authCookie(admin.id))
      .send({ enabled: true });
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Invite tokens
// ─────────────────────────────────────────────────────────────────────────────

describe('Invite token management', () => {
  it('ADMIN-013 — POST /admin/invites creates an invite token', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .post('/api/admin/invites')
      .set('Cookie', authCookie(admin.id))
      .send({ max_uses: 5 });
    expect(res.status).toBe(201);
    expect(res.body.invite.token).toBeDefined();
  });

  it('ADMIN-014 — DELETE /admin/invites/:id removes invite', async () => {
    const { user: admin } = createAdmin(testDb);
    const invite = createInviteToken(testDb, { created_by: admin.id });

    const res = await request(app)
      .delete(`/api/admin/invites/${invite.id}`)
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Packing templates
// ─────────────────────────────────────────────────────────────────────────────

describe('Packing templates', () => {
  it('ADMIN-015 — POST /admin/packing-templates creates a template', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .post('/api/admin/packing-templates')
      .set('Cookie', authCookie(admin.id))
      .send({ name: 'Beach Trip', description: 'Beach essentials' });
    expect(res.status).toBe(201);
    expect(res.body.template.name).toBe('Beach Trip');
  });

  it('ADMIN-016 — DELETE /admin/packing-templates/:id removes template', async () => {
    const { user: admin } = createAdmin(testDb);
    const create = await request(app)
      .post('/api/admin/packing-templates')
      .set('Cookie', authCookie(admin.id))
      .send({ name: 'Temp Template' });
    const templateId = create.body.template.id;

    const res = await request(app)
      .delete(`/api/admin/packing-templates/${templateId}`)
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bag tracking
// ─────────────────────────────────────────────────────────────────────────────

describe('Bag tracking', () => {
  it('ADMIN-017 — PUT /admin/bag-tracking toggles bag tracking', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .put('/api/admin/bag-tracking')
      .set('Cookie', authCookie(admin.id))
      .send({ enabled: true });
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// JWT rotation
// ─────────────────────────────────────────────────────────────────────────────

describe('JWT rotation', () => {
  it('ADMIN-018 — POST /admin/rotate-jwt-secret rotates the JWT secret', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .post('/api/admin/rotate-jwt-secret')
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Packing template CRUD (full)
// ─────────────────────────────────────────────────────────────────────────────

describe('Packing template CRUD (full)', () => {
  async function makeTemplate(admin: any) {
    const res = await request(app)
      .post('/api/admin/packing-templates')
      .set('Cookie', authCookie(admin.id))
      .send({ name: 'Test Template' });
    return res.body.template;
  }

  it('ADMIN-019 — GET /admin/packing-templates/:id returns template', async () => {
    const { user: admin } = createAdmin(testDb);
    const template = await makeTemplate(admin);

    const res = await request(app)
      .get(`/api/admin/packing-templates/${template.id}`)
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
    expect(res.body.template.id).toBe(template.id);
    expect(res.body.template.name).toBe('Test Template');
  });

  it('ADMIN-019b — GET /admin/packing-templates/:id returns 404 for missing', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .get('/api/admin/packing-templates/99999')
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(404);
  });

  it('ADMIN-020 — PUT /admin/packing-templates/:id updates name', async () => {
    const { user: admin } = createAdmin(testDb);
    const template = await makeTemplate(admin);

    const res = await request(app)
      .put(`/api/admin/packing-templates/${template.id}`)
      .set('Cookie', authCookie(admin.id))
      .send({ name: 'Updated Name' });
    expect(res.status).toBe(200);
    expect(res.body.template.name).toBe('Updated Name');
  });

  it('ADMIN-021 — POST /admin/packing-templates/:id/categories adds a category', async () => {
    const { user: admin } = createAdmin(testDb);
    const template = await makeTemplate(admin);

    const res = await request(app)
      .post(`/api/admin/packing-templates/${template.id}/categories`)
      .set('Cookie', authCookie(admin.id))
      .send({ name: 'Clothing' });
    expect(res.status).toBe(201);
    expect(res.body.category.name).toBe('Clothing');
  });

  it('ADMIN-021b — PUT /admin/packing-templates/:templateId/categories/:catId updates category', async () => {
    const { user: admin } = createAdmin(testDb);
    const template = await makeTemplate(admin);
    const catRes = await request(app)
      .post(`/api/admin/packing-templates/${template.id}/categories`)
      .set('Cookie', authCookie(admin.id))
      .send({ name: 'Clothing' });
    const catId = catRes.body.category.id;

    const res = await request(app)
      .put(`/api/admin/packing-templates/${template.id}/categories/${catId}`)
      .set('Cookie', authCookie(admin.id))
      .send({ name: 'Apparel' });
    expect(res.status).toBe(200);
    expect(res.body.category.name).toBe('Apparel');
  });

  it('ADMIN-021c — DELETE /admin/packing-templates/:templateId/categories/:catId removes category', async () => {
    const { user: admin } = createAdmin(testDb);
    const template = await makeTemplate(admin);
    const catRes = await request(app)
      .post(`/api/admin/packing-templates/${template.id}/categories`)
      .set('Cookie', authCookie(admin.id))
      .send({ name: 'Toiletries' });
    const catId = catRes.body.category.id;

    const res = await request(app)
      .delete(`/api/admin/packing-templates/${template.id}/categories/${catId}`)
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('ADMIN-021d — POST .../categories/:catId/items adds an item to category', async () => {
    const { user: admin } = createAdmin(testDb);
    const template = await makeTemplate(admin);
    const catRes = await request(app)
      .post(`/api/admin/packing-templates/${template.id}/categories`)
      .set('Cookie', authCookie(admin.id))
      .send({ name: 'Clothing' });
    const catId = catRes.body.category.id;

    const res = await request(app)
      .post(`/api/admin/packing-templates/${template.id}/categories/${catId}/items`)
      .set('Cookie', authCookie(admin.id))
      .send({ name: 'T-Shirt' });
    expect(res.status).toBe(201);
    expect(res.body.item.name).toBe('T-Shirt');
  });

  it('ADMIN-021e — PUT /admin/packing-templates/:templateId/items/:itemId updates item', async () => {
    const { user: admin } = createAdmin(testDb);
    const template = await makeTemplate(admin);
    const catRes = await request(app)
      .post(`/api/admin/packing-templates/${template.id}/categories`)
      .set('Cookie', authCookie(admin.id))
      .send({ name: 'Clothing' });
    const catId = catRes.body.category.id;
    const itemRes = await request(app)
      .post(`/api/admin/packing-templates/${template.id}/categories/${catId}/items`)
      .set('Cookie', authCookie(admin.id))
      .send({ name: 'T-Shirt' });
    const itemId = itemRes.body.item.id;

    const res = await request(app)
      .put(`/api/admin/packing-templates/${template.id}/items/${itemId}`)
      .set('Cookie', authCookie(admin.id))
      .send({ name: 'Polo Shirt' });
    expect(res.status).toBe(200);
    expect(res.body.item.name).toBe('Polo Shirt');
  });

  it('ADMIN-021f — DELETE /admin/packing-templates/:templateId/items/:itemId removes item', async () => {
    const { user: admin } = createAdmin(testDb);
    const template = await makeTemplate(admin);
    const catRes = await request(app)
      .post(`/api/admin/packing-templates/${template.id}/categories`)
      .set('Cookie', authCookie(admin.id))
      .send({ name: 'Clothing' });
    const catId = catRes.body.category.id;
    const itemRes = await request(app)
      .post(`/api/admin/packing-templates/${template.id}/categories/${catId}/items`)
      .set('Cookie', authCookie(admin.id))
      .send({ name: 'T-Shirt' });
    const itemId = itemRes.body.item.id;

    const res = await request(app)
      .delete(`/api/admin/packing-templates/${template.id}/items/${itemId}`)
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MCP token management
// ─────────────────────────────────────────────────────────────────────────────

describe('MCP token management', () => {
  it('ADMIN-023 — GET /admin/mcp-tokens returns list', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .get('/api/admin/mcp-tokens')
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tokens)).toBe(true);
  });

  it('ADMIN-024 — DELETE /admin/mcp-tokens/:id returns 404 for missing token', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .delete('/api/admin/mcp-tokens/99999')
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OAuth sessions
// ─────────────────────────────────────────────────────────────────────────────

describe('OAuth sessions', () => {
  it('ADMIN-025 — GET /admin/oauth-sessions returns list', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .get('/api/admin/oauth-sessions')
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.sessions)).toBe(true);
  });

  it('ADMIN-026 — DELETE /admin/oauth-sessions/:id returns 404 for missing session', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .delete('/api/admin/oauth-sessions/99999')
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OIDC settings
// ─────────────────────────────────────────────────────────────────────────────

describe('OIDC settings', () => {
  it('ADMIN-027 — GET /admin/oidc returns OIDC configuration', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .get('/api/admin/oidc')
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
  });

  it('ADMIN-028 — PUT /admin/oidc updates OIDC settings', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .put('/api/admin/oidc')
      .set('Cookie', authCookie(admin.id))
      .send({ issuer: 'https://accounts.example.com', client_id: 'my-client', oidc_only: false });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Demo baseline
// ─────────────────────────────────────────────────────────────────────────────

describe('Demo baseline', () => {
  it('ADMIN-029 — POST /admin/save-demo-baseline returns 404 when DEMO_MODE is not set', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .post('/api/admin/save-demo-baseline')
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GitHub releases / version check
// ─────────────────────────────────────────────────────────────────────────────

describe('GitHub releases and version check', () => {
  it('ADMIN-030 — GET /admin/github-releases returns array (even if GitHub unreachable)', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .get('/api/admin/github-releases?per_page=5&page=1')
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('ADMIN-031 — GET /admin/version-check returns version info', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .get('/api/admin/version-check')
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('current');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional list routes
// ─────────────────────────────────────────────────────────────────────────────

describe('Admin list routes', () => {
  it('ADMIN-032 — GET /admin/invites lists invites', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .get('/api/admin/invites')
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.invites)).toBe(true);
  });

  it('ADMIN-033 — GET /admin/bag-tracking returns bag tracking setting', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .get('/api/admin/bag-tracking')
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
  });

  it('ADMIN-034 — GET /admin/packing-templates lists templates', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .get('/api/admin/packing-templates')
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.templates)).toBe(true);
  });

  it('ADMIN-035 — GET /admin/addons lists addons', async () => {
    const { user: admin } = createAdmin(testDb);

    const res = await request(app)
      .get('/api/admin/addons')
      .set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.addons)).toBe(true);
  });
});
