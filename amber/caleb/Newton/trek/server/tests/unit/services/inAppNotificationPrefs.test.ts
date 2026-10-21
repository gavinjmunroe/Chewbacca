/**
 * Unit tests for in-app notification preference filtering in createNotification().
 * Covers INOTIF-001 to INOTIF-004.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
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
  JWT_SECRET: 'test-jwt-secret-for-trek-testing-only',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));

// Mock WebSocket broadcast — must use vi.hoisted() so broadcastMock is available
// when the vi.mock factory is evaluated (factories are hoisted before const declarations)
const { broadcastMock } = vi.hoisted(() => ({ broadcastMock: vi.fn() }));
vi.mock('../../../src/websocket', () => ({ broadcastToUser: broadcastMock }));

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { resetTestDb } from '../../helpers/test-db';
import { createUser, createAdmin, disableNotificationPref } from '../../helpers/factories';
import { createNotification, createNotificationForRecipient, respondToBoolean } from '../../../src/services/inAppNotifications';

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  broadcastMock.mockClear();
});

afterAll(() => {
  testDb.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// createNotification — preference filtering
// ─────────────────────────────────────────────────────────────────────────────

describe('createNotification — preference filtering', () => {
  it('INOTIF-001 — notification without event_type is delivered to all recipients (backward compat)', () => {
    const { user: admin } = createAdmin(testDb);
    const { user: recipient } = createUser(testDb);
    // The admin scope targets all admins — create a second admin as the sender
    const { user: sender } = createAdmin(testDb);

    // Send to a specific user (user scope) without event_type
    const ids = createNotification({
      type: 'simple',
      scope: 'user',
      target: recipient.id,
      sender_id: sender.id,
      title_key: 'notifications.test.title',
      text_key: 'notifications.test.text',
      // no event_type
    });

    expect(ids.length).toBe(1);
    const row = testDb.prepare('SELECT * FROM notifications WHERE recipient_id = ?').get(recipient.id);
    expect(row).toBeDefined();
    // Also verify the admin who disabled all prefs still gets messages without event_type
    disableNotificationPref(testDb, admin.id, 'trip_invite', 'inapp');
    // admin still gets this since no event_type check
    const adminIds = createNotification({
      type: 'simple',
      scope: 'user',
      target: admin.id,
      sender_id: sender.id,
      title_key: 'notifications.test.title',
      text_key: 'notifications.test.text',
    });
    expect(adminIds.length).toBe(1);
  });

  it('INOTIF-002 — notification with event_type skips recipients who have disabled that event on inapp', () => {
    const { user: sender } = createAdmin(testDb);
    const { user: recipient1 } = createUser(testDb);
    const { user: recipient2 } = createUser(testDb);

    // recipient2 has disabled inapp for trip_invite
    disableNotificationPref(testDb, recipient2.id, 'trip_invite', 'inapp');

    // Use a trip to target both members
    const tripId = (testDb.prepare('INSERT INTO trips (title, user_id) VALUES (?, ?)').run('Test Trip', sender.id)).lastInsertRowid as number;
    testDb.prepare('INSERT INTO trip_members (trip_id, user_id) VALUES (?, ?)').run(tripId, recipient1.id);
    testDb.prepare('INSERT INTO trip_members (trip_id, user_id) VALUES (?, ?)').run(tripId, recipient2.id);

    const ids = createNotification({
      type: 'simple',
      scope: 'trip',
      target: tripId,
      sender_id: sender.id,
      event_type: 'trip_invite',
      title_key: 'notifications.test.title',
      text_key: 'notifications.test.text',
    });

    // sender excluded, recipient1 included, recipient2 skipped (disabled pref)
    expect(ids.length).toBe(1);
    const r1 = testDb.prepare('SELECT id FROM notifications WHERE recipient_id = ?').get(recipient1.id);
    const r2 = testDb.prepare('SELECT id FROM notifications WHERE recipient_id = ?').get(recipient2.id);
    expect(r1).toBeDefined();
    expect(r2).toBeUndefined();
  });

  it('INOTIF-003 — notification with event_type delivers to recipients with no stored preferences', () => {
    const { user: sender } = createAdmin(testDb);
    const { user: recipient } = createUser(testDb);

    // No preferences stored for recipient — should default to enabled
    const ids = createNotification({
      type: 'simple',
      scope: 'user',
      target: recipient.id,
      sender_id: sender.id,
      event_type: 'trip_invite',
      title_key: 'notifications.test.title',
      text_key: 'notifications.test.text',
    });

    expect(ids.length).toBe(1);
    const row = testDb.prepare('SELECT id FROM notifications WHERE recipient_id = ?').get(recipient.id);
    expect(row).toBeDefined();
  });

  it('INOTIF-003b — createNotificationForRecipient inserts a single notification and broadcasts via WS', () => {
    const { user: sender } = createAdmin(testDb);
    const { user: recipient } = createUser(testDb);

    const id = createNotificationForRecipient(
      {
        type: 'navigate',
        scope: 'user',
        target: recipient.id,
        sender_id: sender.id,
        event_type: 'trip_invite',
        title_key: 'notif.trip_invite.title',
        text_key: 'notif.trip_invite.text',
        navigate_text_key: 'notif.action.view_trip',
        navigate_target: '/trips/99',
      },
      recipient.id,
      { username: 'admin', avatar: null }
    );

    expect(id).toBeTypeOf('number');
    const row = testDb.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as { recipient_id: number; navigate_target: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.recipient_id).toBe(recipient.id);
    expect(row!.navigate_target).toBe('/trips/99');
    expect(broadcastMock).toHaveBeenCalledTimes(1);
    expect(broadcastMock.mock.calls[0][0]).toBe(recipient.id);
  });

  it('INOTIF-004 — admin-scope version_available only reaches admins with enabled pref', () => {
    const { user: admin1 } = createAdmin(testDb);
    const { user: admin2 } = createAdmin(testDb);

    // admin2 disables version_available inapp notifications
    disableNotificationPref(testDb, admin2.id, 'version_available', 'inapp');

    const ids = createNotification({
      type: 'navigate',
      scope: 'admin',
      target: 0,
      sender_id: null,
      event_type: 'version_available',
      title_key: 'notifications.versionAvailable.title',
      text_key: 'notifications.versionAvailable.text',
      navigate_text_key: 'notifications.versionAvailable.button',
      navigate_target: '/admin',
    });

    // Only admin1 should receive it
    expect(ids.length).toBe(1);
    const admin1Row = testDb.prepare('SELECT id FROM notifications WHERE recipient_id = ?').get(admin1.id);
    const admin2Row = testDb.prepare('SELECT id FROM notifications WHERE recipient_id = ?').get(admin2.id);
    expect(admin1Row).toBeDefined();
    expect(admin2Row).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// respondToBoolean
// ─────────────────────────────────────────────────────────────────────────────

function insertBooleanNotification(recipientId: number, senderId: number | null = null): number {
  const result = testDb.prepare(`
    INSERT INTO notifications (
      type, scope, target, sender_id, recipient_id,
      title_key, title_params, text_key, text_params,
      positive_text_key, negative_text_key, positive_callback, negative_callback
    ) VALUES ('boolean', 'user', ?, ?, ?, 'notif.test.title', '{}', 'notif.test.text', '{}',
      'notif.action.accept', 'notif.action.decline',
      '{"action":"test_approve","payload":{}}', '{"action":"test_deny","payload":{}}'
    )
  `).run(recipientId, senderId, recipientId);
  return result.lastInsertRowid as number;
}

function insertSimpleNotification(recipientId: number): number {
  const result = testDb.prepare(`
    INSERT INTO notifications (
      type, scope, target, sender_id, recipient_id,
      title_key, title_params, text_key, text_params
    ) VALUES ('simple', 'user', ?, NULL, ?, 'notif.test.title', '{}', 'notif.test.text', '{}')
  `).run(recipientId, recipientId);
  return result.lastInsertRowid as number;
}

describe('respondToBoolean', () => {
  it('INOTIF-005 — positive response sets response=positive, marks read, broadcasts update', async () => {
    const { user } = createUser(testDb);
    const id = insertBooleanNotification(user.id);

    const result = await respondToBoolean(id, user.id, 'positive');

    expect(result.success).toBe(true);
    expect(result.notification).toBeDefined();
    const row = testDb.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as any;
    expect(row.response).toBe('positive');
    expect(row.is_read).toBe(1);
    expect(broadcastMock).toHaveBeenCalledWith(user.id, expect.objectContaining({ type: 'notification:updated' }));
  });

  it('INOTIF-006 — negative response sets response=negative', async () => {
    const { user } = createUser(testDb);
    const id = insertBooleanNotification(user.id);

    const result = await respondToBoolean(id, user.id, 'negative');

    expect(result.success).toBe(true);
    const row = testDb.prepare('SELECT response FROM notifications WHERE id = ?').get(id) as any;
    expect(row.response).toBe('negative');
  });

  it('INOTIF-007 — double-response prevention returns error on second call', async () => {
    const { user } = createUser(testDb);
    const id = insertBooleanNotification(user.id);

    await respondToBoolean(id, user.id, 'positive');
    const result = await respondToBoolean(id, user.id, 'negative');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already responded/i);
  });

  it('INOTIF-008 — response on a simple notification returns error', async () => {
    const { user } = createUser(testDb);
    const id = insertSimpleNotification(user.id);

    const result = await respondToBoolean(id, user.id, 'positive');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not a boolean/i);
  });

  it('INOTIF-009 — response on a non-existent notification returns error', async () => {
    const { user } = createUser(testDb);
    const result = await respondToBoolean(99999, user.id, 'positive');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('INOTIF-010 — response on notification belonging to another user returns error', async () => {
    const { user: owner } = createUser(testDb);
    const { user: other } = createUser(testDb);
    const id = insertBooleanNotification(owner.id);

    const result = await respondToBoolean(id, other.id, 'positive');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });
});
