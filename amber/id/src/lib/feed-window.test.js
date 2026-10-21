import test from 'node:test';
import assert from 'node:assert/strict';
import { feedWindow } from './feed-window.js';
test('optional feed windows preserve timezone instants and reject partial or inverted input', () => {
  assert.deepEqual(feedWindow({}), {});
  assert.deepEqual(feedWindow({from:'2026-03-08T00:00:00-08:00',to:'2026-03-09T00:00:00-07:00'}), {from:'2026-03-08T08:00:00.000Z',to:'2026-03-09T07:00:00.000Z'});
  for (const input of [{from:'bad'}, {from:'2026-01-01',to:'2025-12-31'}, {from:'2026-01-01',to:'2026-05-01'}]) assert.equal(feedWindow(input),null);
});
