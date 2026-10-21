import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProgressively } from './progressiveNetwork.ts';

test('contacts appear while ranking is pending, then metadata can update separately', async () => {
  let finish!: () => void;
  const metadata: string[] = [];
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const contacts = await loadProgressively(async () => ['c1'], [async () => {
    await pending; metadata.push('ranked');
  }]);
  assert.deepEqual(contacts, ['c1']);
  assert.deepEqual(metadata, []);
  finish(); await pending; await Promise.resolve();
  assert.deepEqual(metadata, ['ranked']);
});
test('failed optional metadata never fails the address book', async () => {
  assert.deepEqual(await loadProgressively(async () => ['c1'], [async () => { throw Error('ranking offline'); }]), ['c1']);
  await new Promise(resolve => setTimeout(resolve, 0));
});
test('primary contact failures are still reported', async () => {
  await assert.rejects(loadProgressively(async () => { throw Error('contacts offline'); }, []), /contacts offline/);
});
