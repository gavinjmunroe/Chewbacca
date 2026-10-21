import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Exercise the actual native layout callback with React's updater deliberately
// deferred until after its synthetic event has been released.
const source = readFileSync(new URL('./NetworkCanvas.tsx', import.meta.url), 'utf8');
const handlers = [...source.matchAll(/onLayout=\{\(e\) => \{([\s\S]*?)\n\s*\}\}/g)];
assert.equal(handlers.length, 1, 'Expected one block-form viewport layout callback');
const makeHandler = new Function('setSize', `return (e) => {${handlers[0][1]}};`);
type Size = { width: number; height: number };

function deferredLayout(width: number, height: number) {
  let update: ((old: Size) => Size) | undefined;
  const onLayout = makeHandler((value: typeof update) => { update = value; });
  const event: { nativeEvent: { layout: Size } | null } = { nativeEvent: { layout: { width, height } } };
  onLayout(event);
  event.nativeEvent = null;
  assert.ok(update);
  return update;
}

test('layout updater remains safe after React Native releases the layout event', () => {
  const update = deferredLayout(390, 520);
  assert.deepEqual(update({ width: 340, height: 400 }), { width: 390, height: 520 });
});

test('hidden and unchanged viewport layouts preserve the previous size reference', () => {
  const previous = { width: 390, height: 520 };
  for (const [width, height] of [[0, 0], [0, 520], [390, 0], [390, 520]])
    assert.equal(deferredLayout(width, height)(previous), previous);
});
