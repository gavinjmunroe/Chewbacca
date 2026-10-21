import test from 'node:test';
import assert from 'node:assert/strict';
import { communityNodes } from './communityGraph.ts';
import { orderByPeopleRank } from './communityFilters.ts';
test('graph adapter excludes owner, organizations and malformed weights', () => {
  assert.deepEqual(communityNodes({ nodes: [
    { id: 'owner', kind: 'owner', strength: 1 }, { id: 'group', kind: 'group', strength: 1 },
    { id: 'a', kind: 'contact', strength: 0.8 }, { id: 'b', kind: 'contact', strength: '1' },
    { id: 'c', kind: 'contact', strength: 10 }, null,
  ] }).map(n => n.id), ['a']);
});
test('PeopleRank remains primary; real interaction strength orders unranked contacts', () => {
  const people = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  assert.deepEqual(orderByPeopleRank(people, [{ contactId: 'c', score: 0, computedAt: '2026-09-29' }], new Map([['a', 0.1], ['b', 0.9]])).map(p => p.id), ['c', 'b', 'a']);
});
