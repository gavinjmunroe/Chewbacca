import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotonSpaceCache } from './photon-space-cache.js';

test('reuses DM routing and coalesces simultaneous initialization', async () => {
  const cache = createPhotonSpaceCache();
  let calls = 0;
  const create = async () => { calls++; return { id: 'chat-1' }; };
  const [a, b] = await Promise.all([cache.get('sender:recipient', create), cache.get('sender:recipient', create)]);
  assert.equal(a, b);
  assert.equal(await cache.get('sender:recipient', create), a);
  assert.equal(calls, 1);
  await cache.get('sender:other', create);
  assert.equal(calls, 2);
  cache.clear();
  await cache.get('sender:recipient', create);
  assert.equal(calls, 3);
});

test('failed creation is retryable and cache size is bounded', async () => {
  const cache = createPhotonSpaceCache({ maxSize: 1 });
  await assert.rejects(cache.get('one', async () => { throw new Error('unavailable'); }));
  assert.equal(await cache.get('one', async () => 'recovered'), 'recovered');
  await cache.get('two', async () => 'two');
  assert.equal(await cache.get('one', async () => 'new'), 'new');
});
