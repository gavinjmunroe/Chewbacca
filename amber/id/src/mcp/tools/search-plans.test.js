import test from 'node:test';
import assert from 'node:assert/strict';
import { searchOwnerPlans, handler } from './search-plans.js';

test('plan query is scoped, escapes wildcards, excludes unscheduled/deleted/hypothetical plans', async () => {
  await searchOwnerPlans('alice', { query: '50%_', limit: 100 }, async (sql, values) => {
    assert.match(sql, /owner_id=\$1/);
    assert.match(sql, /deleted_at IS NULL/);
    assert.match(sql, /scheduled_at IS NOT NULL/);
    assert.match(sql, /modality IN \('planned','actual'\)/);
    assert.equal(values[0], 'alice');
    assert.equal(values[1], '%50\\%\\_%');
    assert.equal(values[4], 50);
    return { rows: [] };
  });
});

test('missing owner, invalid windows and data failures never claim a successful empty calendar', async () => {
  assert.equal((await handler({})).isError, true);
  const deps = { owner: async () => ({ ok: true, ownerId: 'alice' }), search: async () => { throw Error('offline'); } };
  assert.equal((await handler({ from: '2026-10-10T00:00:00Z', to: '2026-10-01T00:00:00Z' }, deps)).isError, true);
  assert.equal((await handler({}, deps)).isError, true);
});

test('successful plans use the resolved owner and disclose device-only limitation', async () => {
  const result = await handler({ query: 'coffee' }, {
    owner: async () => ({ ok: true, ownerId: 'alice' }),
    search: async owner => { assert.equal(owner, 'alice'); return [{ id: 'event1', title: 'Coffee' }]; },
  });
  assert.equal(result.structuredContent.count, 1);
  assert.equal(result.structuredContent.includesDeviceOnlyEvents, false);
});
