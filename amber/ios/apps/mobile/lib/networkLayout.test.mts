import test from 'node:test';
import assert from 'node:assert/strict';
import { arrangeCircle, relevance, visibleCircleNodes, warmCircleSearchIndex } from './networkLayout.ts';
const people = [
  { id: 'maya', name: 'Maya', context: 'hiking outdoors' },
  { id: 'alex', name: 'Alex', context: 'product design' },
  { id: 'sam', name: 'Sam', context: 'new role Monday' },
];
test('search and saved notes change which people are brought close', () => {
  assert.equal(
    arrangeCircle(people, 'Who can help me with product design?', 360, 400)[0].id,
    'alex',
  );
  assert.equal(arrangeCircle(people, 'hiking buddy', 360, 400)[0].id, 'maya');
  const updated = people.map((p) =>
    p.id === 'sam' ? { ...p, context: 'product design new role' } : p,
  );
  assert.ok(relevance(updated[2], 'design') > 0);
});
test('missing context does not fabricate a match and empty intent keeps original order', () => {
  assert.equal(relevance(people[0], 'oncologist'), 0);
  assert.deepEqual(
    arrangeCircle(people, '', 360, 400).map((p) => p.id),
    people.map((p) => p.id),
  );
});
test('all contacts join layout and a match beyond the former 60-person cap comes first', () => {
  const list = Array.from({ length: 100 }, (_, i) => ({
    id: String(i),
    name: `Person ${i}`,
    context: i === 99 ? 'architect' : '',
  }));
  const layout = arrangeCircle(list, 'architect', 360, 400);
  assert.equal(layout.length, 100);
  assert.equal(layout[0].id, '99');
  assert.ok(layout.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
});

test('compact onboarding keeps every example person inside the visible graph', () => {
  const layout = arrangeCircle(people, 'design', 300, 260, true);
  assert.ok(layout.every((p) => Math.abs(p.x) <= 108 && Math.abs(p.y) <= 82));
});

test('large networks remain reachable while only nearby people are rendered', () => {
  const people = Array.from({ length: 2500 }, (_, i) => ({ id: String(i), name: `Person ${i}` }));
  const size = { width: 380, height: 480 };
  const nodes = arrangeCircle(people, '', size.width, size.height);
  assert.equal(nodes.length, 2500);
  const initial = visibleCircleNodes(nodes, size, { x: 0, y: 0, zoom: 1 });
  assert.ok(initial.length < 150);
  const far = nodes[2499];
  assert.ok(!initial.some((n) => n.id === far.id));
  const moved = visibleCircleNodes(nodes, size, { x: -far.x, y: -far.y, zoom: 1 });
  assert.ok(moved.some((n) => n.id === far.id));
  assert.ok(moved.length < 150);
  const overview = visibleCircleNodes(nodes, size, { x: 0, y: 0, zoom: 0.6 });
  assert.ok(overview.length > initial.length);
  assert.ok(overview.length < 350);
});
test('outer rings grow their capacity instead of stranding six people on huge circles', () => {
  const nodes = arrangeCircle(
    Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: `Person ${i}` })),
    '',
    380,
    480,
  );
  const radii = new Map<number, number>();
  nodes.forEach((n) => {
    const r = Math.round(Math.hypot(n.x, n.y));
    radii.set(r, (radii.get(r) || 0) + 1);
  });
  const counts = [...radii.values()];
  assert.ok(counts[1] > counts[0]);
  assert.ok(counts[2] > counts[1]);
});

test('indexed searches immediately reflect edits and removal of imported fields', () => {
  const person = { id: 'maya', name: 'Maya', subtitle: 'Designer', context: 'hiking outdoors' };
  assert.equal(relevance(person, 'design hiking'), 1);
  person.context = 'violin lessons';
  person.subtitle = '';
  person.name = 'José';
  assert.equal(relevance(person, 'design hiking maya'), 0);
  assert.equal(relevance(person, 'jose violin'), 1);
});

test('contacts sharing an id never share searchable private context', () => {
  const firstAccount = { id: '1', name: 'Alex', context: 'hiking' };
  const secondAccount = { id: '1', name: 'Sam', context: 'violin' };
  assert.equal(relevance(firstAccount, 'hiking'), 1);
  assert.equal(relevance(secondAccount, 'hiking'), 0);
  assert.equal(relevance(secondAccount, 'violin'), 1);
});

test('successive queries preserve matching, ties and original contact data', () => {
  const contacts = [
    { id: 'a', name: 'Alex', context: 'design hiking', score: 81 },
    { id: 'b', name: 'José', context: 'design', score: 93 },
    { id: 'c', name: 'Sam', context: 'violin', score: 72 },
  ];
  const original = structuredClone(contacts);
  for (const query of ['design', 'violin', 'hiking design', 'jose', '', 'design']) {
    const layout = arrangeCircle(contacts, query, 390, 520);
    const scores = layout.map((n) => n.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
    assert.deepEqual(contacts, original);
    if (query === 'design') assert.deepEqual(layout.map((p) => p.id), ['a', 'b', 'c']);
    if (query === 'jose') assert.equal(layout[0].id, 'b');
  }
});

function queuedIndexWork() {
  const pending = new Set<(deadline: { timeRemaining: () => number }) => void>();
  return {
    pending,
    schedule(work: (deadline: { timeRemaining: () => number }) => void) {
      pending.add(work);
      return () => { pending.delete(work); };
    },
    tick(budget = 10) {
      const work = pending.values().next().value;
      assert.ok(work);
      pending.delete(work);
      work({ timeRemaining: () => budget });
    },
  };
}
test('index warming yields between bounded chunks instead of delaying the caller', () => {
  const queue = queuedIndexWork();
  const read = new Set<number>();
  const contacts = Array.from({ length: 100 }, (_, i) => ({
    id: String(i), name: `Person ${i}`,
    get context() { read.add(i); return 'design'; },
  }));
  warmCircleSearchIndex(contacts, queue.schedule);
  assert.equal(read.size, 0);
  queue.tick();
  assert.ok(read.size > 0 && read.size <= 32);
  assert.equal(queue.pending.size, 1);
  while (queue.pending.size) queue.tick();
  assert.equal(read.size, 100);
  assert.equal(relevance(contacts[99], 'design'), 1);
});
test('index warming respects idle budget and cancellation after a partial batch', () => {
  const queue = queuedIndexWork();
  const read = new Set<number>();
  const contacts = Array.from({ length: 100 }, (_, i) => ({
    id: String(i), name: `Person ${i}`,
    get context() { read.add(i); return 'hiking'; },
  }));
  const cancel = warmCircleSearchIndex(contacts, queue.schedule);
  queue.tick(0);
  assert.equal(read.size, 1);
  const stale = queue.pending.values().next().value;
  cancel();
  assert.equal(queue.pending.size, 0);
  stale?.({ timeRemaining: () => 10 });
  assert.equal(read.size, 1);
});
test('cancelling a replaced people list before its first slice reads no old contacts', () => {
  const queue = queuedIndexWork();
  let reads = 0;
  const cancel = warmCircleSearchIndex([
    { id: 'old', name: 'Old account', get context() { reads += 1; return 'private'; } },
  ], queue.schedule);
  cancel();
  assert.equal(queue.pending.size, 0);
  assert.equal(reads, 0);
  warmCircleSearchIndex([{ id: 'new', name: 'New account' }], queue.schedule);
  queue.tick();
  assert.equal(reads, 0);
  assert.equal(queue.pending.size, 0);
});
