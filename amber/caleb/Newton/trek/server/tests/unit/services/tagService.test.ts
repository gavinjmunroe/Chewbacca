/**
 * Unit tests for tagService — TAG-SVC-001 through TAG-SVC-015.
 * Uses a real in-memory SQLite DB so SQL logic is exercised faithfully.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

// ── DB setup ──────────────────────────────────────────────────────────────────

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
    getPlaceWithTags: () => null,
    canAccessTrip: () => null,
    isOwner: () => false,
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test-secret',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { resetTestDb } from '../../helpers/test-db';
import { createUser } from '../../helpers/factories';
import { listTags, createTag, getTagByIdAndUser, updateTag, deleteTag } from '../../../src/services/tagService';

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

// ── listTags ──────────────────────────────────────────────────────────────────

describe('listTags', () => {
  it('TAG-SVC-001 — returns empty array when user has no tags', () => {
    const { user } = createUser(testDb);
    expect(listTags(user.id)).toEqual([]);
  });

  it('TAG-SVC-002 — returns only tags belonging to the user', () => {
    const { user: a } = createUser(testDb);
    const { user: b } = createUser(testDb);
    createTag(a.id, 'A-Tag');
    createTag(b.id, 'B-Tag');
    const tags = listTags(a.id) as any[];
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe('A-Tag');
  });

  it('TAG-SVC-003 — results are ordered by name ascending', () => {
    const { user } = createUser(testDb);
    createTag(user.id, 'Zebra');
    createTag(user.id, 'Apple');
    createTag(user.id, 'Mango');
    const names = (listTags(user.id) as any[]).map((t: any) => t.name);
    expect(names).toEqual(['Apple', 'Mango', 'Zebra']);
  });
});

// ── createTag ─────────────────────────────────────────────────────────────────

describe('createTag', () => {
  it('TAG-SVC-004 — creates a tag with provided name and color', () => {
    const { user } = createUser(testDb);
    const tag = createTag(user.id, 'Beach', '#ff0000') as any;
    expect(tag.name).toBe('Beach');
    expect(tag.color).toBe('#ff0000');
    expect(tag.user_id).toBe(user.id);
  });

  it('TAG-SVC-005 — defaults to #10b981 when no color provided', () => {
    const { user } = createUser(testDb);
    const tag = createTag(user.id, 'Default') as any;
    expect(tag.color).toBe('#10b981');
  });

  it('TAG-SVC-006 — returns the inserted row with an id', () => {
    const { user } = createUser(testDb);
    const tag = createTag(user.id, 'WithId') as any;
    expect(typeof tag.id).toBe('number');
    expect(tag.id).toBeGreaterThan(0);
  });
});

// ── getTagByIdAndUser ─────────────────────────────────────────────────────────

describe('getTagByIdAndUser', () => {
  it('TAG-SVC-007 — returns the tag when id and user_id match', () => {
    const { user } = createUser(testDb);
    const created = createTag(user.id, 'Find Me') as any;
    const found = getTagByIdAndUser(created.id, user.id) as any;
    expect(found).toBeDefined();
    expect(found.name).toBe('Find Me');
  });

  it('TAG-SVC-008 — returns undefined when tag belongs to different user', () => {
    const { user: a } = createUser(testDb);
    const { user: b } = createUser(testDb);
    const tag = createTag(a.id, 'Private') as any;
    expect(getTagByIdAndUser(tag.id, b.id)).toBeUndefined();
  });

  it('TAG-SVC-009 — returns undefined for non-existent tag id', () => {
    const { user } = createUser(testDb);
    expect(getTagByIdAndUser(99999, user.id)).toBeUndefined();
  });
});

// ── updateTag ─────────────────────────────────────────────────────────────────

describe('updateTag', () => {
  it('TAG-SVC-010 — updates both name and color', () => {
    const { user } = createUser(testDb);
    const tag = createTag(user.id, 'Old', '#aaaaaa') as any;
    const updated = updateTag(tag.id, 'New', '#bbbbbb') as any;
    expect(updated.name).toBe('New');
    expect(updated.color).toBe('#bbbbbb');
  });

  it('TAG-SVC-011 — COALESCE: omitting name preserves existing name', () => {
    const { user } = createUser(testDb);
    const tag = createTag(user.id, 'KeepMe', '#aaaaaa') as any;
    const updated = updateTag(tag.id, undefined, '#cccccc') as any;
    expect(updated.name).toBe('KeepMe');
    expect(updated.color).toBe('#cccccc');
  });

  it('TAG-SVC-012 — COALESCE: omitting color preserves existing color', () => {
    const { user } = createUser(testDb);
    const tag = createTag(user.id, 'ColorKeep', '#dddddd') as any;
    const updated = updateTag(tag.id, 'NewName', undefined) as any;
    expect(updated.name).toBe('NewName');
    expect(updated.color).toBe('#dddddd');
  });
});

// ── deleteTag ─────────────────────────────────────────────────────────────────

describe('deleteTag', () => {
  it('TAG-SVC-013 — deletes the tag from the database', () => {
    const { user } = createUser(testDb);
    const tag = createTag(user.id, 'ToDelete') as any;
    deleteTag(tag.id);
    expect(getTagByIdAndUser(tag.id, user.id)).toBeUndefined();
  });

  it('TAG-SVC-014 — deleting a non-existent tag does not throw', () => {
    expect(() => deleteTag(99999)).not.toThrow();
  });

  it('TAG-SVC-015 — deleting one tag does not affect other tags', () => {
    const { user } = createUser(testDb);
    const t1 = createTag(user.id, 'Keep') as any;
    const t2 = createTag(user.id, 'Remove') as any;
    deleteTag(t2.id);
    const remaining = listTags(user.id) as any[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(t1.id);
  });
});
