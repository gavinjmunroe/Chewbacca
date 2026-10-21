import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldUseRedesignedRoute } from './redesignRoute.ts';
test('release opens Sagar; development preview remains explicitly selectable', () => {
  assert.equal(shouldUseRedesignedRoute(true, '1', {}), true);
  assert.equal(shouldUseRedesignedRoute(false, '1', {}), true);
  assert.equal(shouldUseRedesignedRoute(true, undefined, {}), false);
  assert.equal(shouldUseRedesignedRoute(false, undefined, {}), true);
});
test('notifications and established tab destinations retain their handlers during migration', () => {
  for (const params of [
    { reminder: 'r' },
    { dm: 'd' },
    { tab: 'today' },
    { tab: 'messages' },
    { legacy: '1' },
  ])
    for (const dev of [true, false]) assert.equal(shouldUseRedesignedRoute(dev, '1', params), false);
});
