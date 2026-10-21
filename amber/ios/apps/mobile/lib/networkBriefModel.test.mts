import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBrief, rankUpdates } from './networkBriefModel.ts';
const records = [{ id: 'known', name: 'Alex', detail: 'Coffee at 10' }];
test('AI cannot invent cards or duplicate known ones', () => {
  const answer = parseBrief(
    JSON.stringify({
      summary: 'Coffee.',
      ids: ['fake', 'known', 'known', 12],
      followUps: ['When?', false],
    }),
    records,
  );
  assert.deepEqual(answer.ids, ['known']);
  assert.deepEqual(answer.followUps, ['When?']);
});
test('malformed or missing model data becomes a recoverable error', () => {
  for (const raw of ['not JSON', '{}', 'null', '{"summary":2,"ids":[]}'])
    assert.throws(() => parseBrief(raw, records));
});
test('empty matches stay empty rather than substituting unrelated events', () => {
  assert.deepEqual(parseBrief('{"summary":"No matches","ids":[]}', records).ids, []);
});
test('ranking combines strength and dated recency without mutating records', () => {
  const now = Date.parse('2026-09-20T12:00:00Z');
  const input = [
    { id: 'old', name: 'Old', detail: '', createdAt: '2020-01-01', strength: 0.1 },
    { id: 'recent', name: 'Recent', detail: '', createdAt: '2026-09-20T11:00:00Z', strength: 0.5 },
    { id: 'strong', name: 'Strong', detail: '', strength: 1 },
  ];
  assert.deepEqual(
    rankUpdates(input, now).map((r) => r.id),
    ['recent', 'strong', 'old'],
  );
  assert.equal(input[0].id, 'old');
});
