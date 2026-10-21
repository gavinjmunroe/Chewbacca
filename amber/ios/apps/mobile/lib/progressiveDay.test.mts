import test from 'node:test';
import assert from 'node:assert/strict';
import { progressiveDay } from './progressiveDay.ts';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
test('a slow feed never prevents calendar events from appearing', async () => {
  const feed = deferred<string[]>();
  const seen: { events: string[]; friends: string[] }[] = [];
  const task = progressiveDay({
    initial: { events: [], friends: [] } as { events: string[]; friends: string[] },
    sources: { events: async () => ['meeting'], friends: () => feed.promise },
    active: () => true,
    publish: (d) => seen.push(d),
    failed: () => assert.fail(),
  });
  await Promise.resolve();
  assert.deepEqual(seen, [{ events: ['meeting'], friends: [] }]);
  feed.resolve(['walk']);
  const result = await task;
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { events: ['meeting'], friends: ['walk'] });
});
test('failed refresh keeps cached events while new notes appear', async () => {
  const failures: string[] = [];
  const result = await progressiveDay({
    initial: { events: ['saved meeting'], notes: ['old note'] },
    sources: {
      events: async () => {
        throw Error('offline');
      },
      notes: async () => ['new note'],
    },
    active: () => true,
    publish: () => {},
    failed: (k) => failures.push(k),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.data, { events: ['saved meeting'], notes: ['new note'] });
  assert.deepEqual(failures, ['events']);
});
test('leaving a date prevents a late request from publishing into the next date', async () => {
  const events = deferred<string[]>();
  let active = true;
  let updates = 0;
  const task = progressiveDay({
    initial: { events: [] as string[] },
    sources: { events: () => events.promise },
    active: () => active,
    publish: () => updates++,
    failed: () => updates++,
    settled: () => updates++,
  });
  active = false;
  events.resolve(['wrong day']);
  await task;
  assert.equal(updates, 0);
});
