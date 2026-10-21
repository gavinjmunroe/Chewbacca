import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertSyncedEvent } from './calendar-accounts.js';
const event = { externalId: 'provider-event', startsAt: '2026-01-01T10:00:00Z', title: 'Fixture' };
test('partial Google write-back never rewrites attendees', async () => {
  const queries = [];
  const saved = await upsertSyncedEvent('owner', 'account', event, async (sql, args) => { queries.push([sql,args]); return { rows: [{event_id: 'event'}] }; });
  assert.equal(saved.eventId, 'event'); assert.equal(queries.length, 1);
  assert.ok(!queries.some(([sql]) => /DELETE/.test(sql)));
});
test('explicit provider refresh scopes deletions and protects reviewed memo participants', async () => {
  const queries = [];
  await upsertSyncedEvent('owner', 'account', {...event, participantContactIds: []}, async (sql, args) => { queries.push([sql,args]); return { rows: [{event_id: 'event'}] }; });
  const removal = queries.find(([sql]) => sql.includes('DELETE FROM event_participants'));
  assert.deepEqual(removal[1], ['event','owner']);
  assert.match(removal[0], /ep.owner_id = \$2/);
  assert.match(removal[0], /NOT EXISTS[\s\S]*observation_participants[\s\S]*source_conversation_id IS NOT NULL/);
});
