import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerJournalList } from './journal-list.js';
import { listJournalRecordings } from '../db/journal-list.js';
const owner = '22222222-2222-4222-8222-222222222222';
async function request(url, overrides = {}) {
  const app = Fastify(); registerJournalList(app, {
    requireAuth: async req => { req.privyUser = { userId: 'did:privy:test', phone: '+12025550123' }; },
    resolveOwner: async () => owner,
    list: async (actual, options) => { assert.equal(actual, owner); return { conversations: [], next: null, options }; }, ...overrides,
  });
  try { return await app.inject({ method: 'GET', url }); } finally { await app.close(); }
}
test('recording list is owner scoped and validates half-open date/cursor pairs', async () => {
  assert.equal((await request('/v1/me/journal')).statusCode, 200);
  assert.equal((await request('/v1/me/journal?from=2026-10-03T00:00:00Z&to=2026-10-04T00:00:00Z')).statusCode, 200);
  for (const q of ['from=2026-10-03T00:00:00Z', 'before=2026-10-03T00:00:00Z', 'from=bad&to=bad', 'from=2026-10-04T00:00:00Z&to=2026-10-03T00:00:00Z', 'before=2026-10-03T00:00:00Z&beforeId=invalid'])
    assert.equal((await request('/v1/me/journal?' + q)).statusCode, 400);
});
test('no authenticated or resolved owner means no database query', async () => {
  const list = () => assert.fail('must not list');
  assert.equal((await request('/v1/me/journal', { requireAuth: async () => {}, list })).statusCode, 401);
  assert.equal((await request('/v1/me/journal', { resolveOwner: async () => null, list })).statusCode, 401);
});
test('one bounded query yields a stable recording timestamp and keyset continuation', async () => {
  let calls = 0;
  const result = await listJournalRecordings(owner, { from: '2026-10-03T00:00:00Z', to: '2026-10-04T00:00:00Z' }, async (sql, args) => {
    calls++; assert.equal(args[0], owner); assert.equal(args[5], 41);
    assert.match(sql, /c.owner_id = \$1/); assert.match(sql, /m.created_at >= \$2/); assert.match(sql, /m.created_at < \$3/);
    assert.match(sql, /deleted_at IS NULL/); assert.match(sql, /ORDER BY created_at, id LIMIT 1/);
    return { rows: Array.from({ length: 41 }, (_, i) => ({ conversation_id: String(i), content: 'Walk together', recorded_at: '2026-10-03T08:00:00Z' })) };
  });
  assert.equal(calls, 1); assert.equal(result.conversations.length, 40);
  assert.deepEqual(result.next, { before: '2026-10-03T08:00:00.000Z', beforeId: '39' });
});
test('empty and final pages terminate; database errors are not empty success', async () => {
  assert.equal((await listJournalRecordings(owner, {}, async () => ({ rows: [] }))).next, null);
  assert.equal((await request('/v1/me/journal', { list: async () => { throw Error('offline'); } })).statusCode, 500);
});
