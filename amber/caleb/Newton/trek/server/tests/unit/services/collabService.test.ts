/**
 * Unit tests for collabService — COLLAB-SVC-001 to COLLAB-SVC-030.
 * Covers votePoll edge cases, listMessages pagination, deleteMessage ownership,
 * updateNote partial fields, fetchLinkPreview, avatarUrl, createMessage reply validation.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

// ── DB setup ─────────────────────────────────────────────────────────────────

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
    canAccessTrip: (tripId: any, userId: number) =>
      db.prepare(`
        SELECT t.id FROM trips t
        LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ?
        WHERE t.id = ? AND (t.user_id = ? OR m.user_id IS NOT NULL)
      `).get(userId, tripId, userId),
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

// Stub checkSsrf so fetchLinkPreview tests can control SSRF behaviour
const { mockCheckSsrf, mockCreatePinnedDispatcher } = vi.hoisted(() => ({
  mockCheckSsrf: vi.fn(async () => ({ allowed: true, resolvedIp: '93.184.216.34' })),
  mockCreatePinnedDispatcher: vi.fn(() => ({})),
}));
vi.mock('../../../src/utils/ssrfGuard', () => ({
  checkSsrf: mockCheckSsrf,
  createPinnedDispatcher: mockCreatePinnedDispatcher,
}));

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { resetTestDb } from '../../helpers/test-db';
import { createUser, createTrip } from '../../helpers/factories';
import {
  avatarUrl,
  votePoll,
  listMessages,
  createMessage,
  deleteMessage,
  updateNote,
  createNote,
  createPoll,
  closePoll,
  fetchLinkPreview,
} from '../../../src/services/collabService';

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  mockCheckSsrf.mockResolvedValue({ allowed: true, resolvedIp: '93.184.216.34' });
});

afterAll(() => {
  testDb.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
  mockCheckSsrf.mockReset();
  mockCheckSsrf.mockResolvedValue({ allowed: true, resolvedIp: '93.184.216.34' });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function setup() {
  const { user: user1 } = createUser(testDb);
  const { user: user2 } = createUser(testDb);
  const trip = createTrip(testDb, user1.id);
  return { user1, user2, trip };
}

// ── avatarUrl ─────────────────────────────────────────────────────────────────

describe('avatarUrl', () => {
  it('COLLAB-SVC-001: returns null when avatar is null', () => {
    expect(avatarUrl({ avatar: null })).toBeNull();
  });

  it('COLLAB-SVC-002: returns upload path when avatar is set', () => {
    expect(avatarUrl({ avatar: 'abc.jpg' })).toBe('/uploads/avatars/abc.jpg');
  });

  it('COLLAB-SVC-003: returns null when avatar is empty string', () => {
    expect(avatarUrl({ avatar: '' })).toBeNull();
  });
});

// ── votePoll ──────────────────────────────────────────────────────────────────

describe('votePoll', () => {
  it('COLLAB-SVC-004: returns error "closed" when poll is closed', () => {
    const { user1, trip } = setup();
    const poll = createPoll(trip.id, user1.id, { question: 'Q?', options: ['A', 'B'] });
    closePoll(trip.id, poll!.id);

    const result = votePoll(trip.id, poll!.id, user1.id, 0);
    expect(result.error).toBe('closed');
  });

  it('COLLAB-SVC-005: returns error "invalid_index" for negative index', () => {
    const { user1, trip } = setup();
    const poll = createPoll(trip.id, user1.id, { question: 'Q?', options: ['A', 'B'] });

    const result = votePoll(trip.id, poll!.id, user1.id, -1);
    expect(result.error).toBe('invalid_index');
  });

  it('COLLAB-SVC-006: returns error "invalid_index" for out-of-range index', () => {
    const { user1, trip } = setup();
    const poll = createPoll(trip.id, user1.id, { question: 'Q?', options: ['A', 'B'] });

    const result = votePoll(trip.id, poll!.id, user1.id, 5);
    expect(result.error).toBe('invalid_index');
  });

  it('COLLAB-SVC-007: returns error "not_found" for nonexistent poll', () => {
    const { user1, trip } = setup();
    const result = votePoll(trip.id, 9999, user1.id, 0);
    expect(result.error).toBe('not_found');
  });

  it('COLLAB-SVC-008: successfully votes and returns poll with voters', () => {
    const { user1, trip } = setup();
    const poll = createPoll(trip.id, user1.id, { question: 'Q?', options: ['Yes', 'No'] });

    const result = votePoll(trip.id, poll!.id, user1.id, 0);
    expect(result.error).toBeUndefined();
    expect(result.poll).toBeDefined();
    expect(result.poll!.options[0].voters).toHaveLength(1);
  });

  it('COLLAB-SVC-009: toggles vote off when voted again on same option', () => {
    const { user1, trip } = setup();
    const poll = createPoll(trip.id, user1.id, { question: 'Q?', options: ['Yes', 'No'] });

    votePoll(trip.id, poll!.id, user1.id, 0);
    const result = votePoll(trip.id, poll!.id, user1.id, 0);
    expect(result.poll!.options[0].voters).toHaveLength(0);
  });
});

// ── listMessages with before cursor ──────────────────────────────────────────

describe('listMessages', () => {
  it('COLLAB-SVC-010: returns all messages when no before cursor', () => {
    const { user1, trip } = setup();
    createMessage(trip.id, user1.id, 'Hello');
    createMessage(trip.id, user1.id, 'World');

    const msgs = listMessages(trip.id);
    expect(msgs).toHaveLength(2);
  });

  it('COLLAB-SVC-011: paginates using before cursor (returns messages with id < before)', () => {
    const { user1, trip } = setup();
    const r1 = createMessage(trip.id, user1.id, 'First');
    const r2 = createMessage(trip.id, user1.id, 'Second');
    const r3 = createMessage(trip.id, user1.id, 'Third');

    const id3 = r3.message!.id;
    const msgs = listMessages(trip.id, id3);
    expect(msgs.length).toBe(2);
    const texts = msgs.map(m => m.text);
    expect(texts).toContain('First');
    expect(texts).toContain('Second');
    expect(texts).not.toContain('Third');
  });

  it('COLLAB-SVC-012: returns messages in ascending order (reversed after DESC query)', () => {
    const { user1, trip } = setup();
    createMessage(trip.id, user1.id, 'A');
    createMessage(trip.id, user1.id, 'B');
    createMessage(trip.id, user1.id, 'C');

    const msgs = listMessages(trip.id);
    expect(msgs[0].text).toBe('A');
    expect(msgs[2].text).toBe('C');
  });

  it('COLLAB-SVC-013: includes reactions grouped by emoji', () => {
    const { user1, trip } = setup();
    const r = createMessage(trip.id, user1.id, 'React me');
    const msgId = r.message!.id;
    testDb.prepare('INSERT INTO collab_message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(msgId, user1.id, '👍');

    const msgs = listMessages(trip.id);
    expect(msgs[0].reactions).toBeDefined();
    expect(msgs[0].reactions).toHaveLength(1);
    expect(msgs[0].reactions[0].emoji).toBe('👍');
  });
});

// ── createMessage with invalid replyTo ───────────────────────────────────────

describe('createMessage', () => {
  it('COLLAB-SVC-014: returns error when replyTo message does not exist', () => {
    const { user1, trip } = setup();
    const result = createMessage(trip.id, user1.id, 'Reply to nothing', 9999);
    expect(result.error).toBe('reply_not_found');
  });

  it('COLLAB-SVC-015: creates message with valid replyTo', () => {
    const { user1, trip } = setup();
    const r1 = createMessage(trip.id, user1.id, 'Original');
    const r2 = createMessage(trip.id, user1.id, 'Reply', r1.message!.id);
    expect(r2.error).toBeUndefined();
    expect(r2.message!.reply_to).toBe(r1.message!.id);
  });
});

// ── deleteMessage ownership check ─────────────────────────────────────────────

describe('deleteMessage', () => {
  it('COLLAB-SVC-016: returns error "not_owner" when user does not own message', () => {
    const { user1, user2, trip } = setup();
    const r = createMessage(trip.id, user1.id, 'My message');

    const result = deleteMessage(trip.id, r.message!.id, user2.id);
    expect(result.error).toBe('not_owner');
  });

  it('COLLAB-SVC-017: returns error "not_found" for nonexistent message', () => {
    const { user1, trip } = setup();
    const result = deleteMessage(trip.id, 9999, user1.id);
    expect(result.error).toBe('not_found');
  });

  it('COLLAB-SVC-018: marks message as deleted when owner deletes it', () => {
    const { user1, trip } = setup();
    const r = createMessage(trip.id, user1.id, 'Delete me');

    const result = deleteMessage(trip.id, r.message!.id, user1.id);
    expect(result.error).toBeUndefined();

    const row = testDb.prepare('SELECT deleted FROM collab_messages WHERE id = ?').get(r.message!.id) as any;
    expect(row.deleted).toBe(1);
  });
});

// ── updateNote partial fields ─────────────────────────────────────────────────

describe('updateNote', () => {
  it('COLLAB-SVC-019: updates only title when other fields are undefined', () => {
    const { user1, trip } = setup();
    const note = createNote(trip.id, user1.id, { title: 'Original', content: 'Some content', website: 'https://example.com' });

    updateNote(trip.id, note.id, { title: 'Updated' });

    const updated = testDb.prepare('SELECT * FROM collab_notes WHERE id = ?').get(note.id) as any;
    expect(updated.title).toBe('Updated');
    expect(updated.content).toBe('Some content'); // unchanged
    expect(updated.website).toBe('https://example.com'); // unchanged
  });

  it('COLLAB-SVC-020: clears content when content is explicitly set to empty string', () => {
    const { user1, trip } = setup();
    const note = createNote(trip.id, user1.id, { title: 'T', content: 'Old content' });

    updateNote(trip.id, note.id, { content: '' });

    const updated = testDb.prepare('SELECT * FROM collab_notes WHERE id = ?').get(note.id) as any;
    expect(updated.content).toBe('');
  });

  it('COLLAB-SVC-021: updates website when website is defined', () => {
    const { user1, trip } = setup();
    const note = createNote(trip.id, user1.id, { title: 'T' });

    updateNote(trip.id, note.id, { website: 'https://new.example.com' });

    const updated = testDb.prepare('SELECT * FROM collab_notes WHERE id = ?').get(note.id) as any;
    expect(updated.website).toBe('https://new.example.com');
  });

  it('COLLAB-SVC-022: clears website when website is explicitly set to empty string', () => {
    const { user1, trip } = setup();
    const note = createNote(trip.id, user1.id, { title: 'T', website: 'https://old.com' });

    updateNote(trip.id, note.id, { website: '' });

    const updated = testDb.prepare('SELECT * FROM collab_notes WHERE id = ?').get(note.id) as any;
    expect(updated.website).toBe('');
  });

  it('COLLAB-SVC-023: returns null when note does not exist', () => {
    const { trip } = setup();
    const result = updateNote(trip.id, 9999, { title: 'Ghost' });
    expect(result).toBeNull();
  });

  it('COLLAB-SVC-024: updates pinned flag', () => {
    const { user1, trip } = setup();
    const note = createNote(trip.id, user1.id, { title: 'T', pinned: false });

    updateNote(trip.id, note.id, { pinned: true });

    const updated = testDb.prepare('SELECT * FROM collab_notes WHERE id = ?').get(note.id) as any;
    expect(updated.pinned).toBe(1);
  });
});

// ── fetchLinkPreview ──────────────────────────────────────────────────────────

describe('fetchLinkPreview', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('COLLAB-SVC-025: returns OG title and description from HTML', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `
        <html>
          <head>
            <meta property="og:title" content="Test Title" />
            <meta property="og:description" content="Test Description" />
            <meta property="og:image" content="https://example.com/image.jpg" />
            <meta property="og:site_name" content="Example" />
          </head>
        </html>
      `,
    }));

    const result = await fetchLinkPreview('https://example.com/page');
    expect(result.title).toBe('Test Title');
    expect(result.description).toBe('Test Description');
    expect(result.image).toBe('https://example.com/image.jpg');
    expect(result.url).toBe('https://example.com/page');
  });

  it('COLLAB-SVC-026: falls back to <title> tag when no og:title', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `<html><head><title>Page Title</title></head></html>`,
    }));

    const result = await fetchLinkPreview('https://example.com/');
    expect(result.title).toBe('Page Title');
  });

  it('COLLAB-SVC-027: returns fallback when fetch response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      text: async () => '',
    }));

    const result = await fetchLinkPreview('https://example.com/bad');
    expect(result.title).toBeNull();
    expect(result.description).toBeNull();
    expect(result.url).toBe('https://example.com/bad');
  });

  it('COLLAB-SVC-028: returns fallback when SSRF check blocks the URL', async () => {
    mockCheckSsrf.mockResolvedValue({ allowed: false, error: 'SSRF blocked' });

    const result = await fetchLinkPreview('https://169.254.169.254/');
    expect(result.title).toBeNull();
  });

  it('COLLAB-SVC-029: returns fallback when fetch throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const result = await fetchLinkPreview('https://example.com/net-error');
    expect(result.title).toBeNull();
    expect(result.url).toBe('https://example.com/net-error');
  });

  it('COLLAB-SVC-030: falls back to meta description tag when no og:description', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `
        <html><head>
          <meta name="description" content="Meta description here" />
        </head></html>
      `,
    }));

    const result = await fetchLinkPreview('https://example.com/meta');
    expect(result.description).toBe('Meta description here');
  });
});
