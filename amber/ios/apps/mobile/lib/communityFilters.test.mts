import test from 'node:test';
import assert from 'node:assert/strict';
import { membershipsFromCircles, sameCity, orderByPeopleRank } from './communityFilters.ts';
test('only user-saved exact circle categories contribute members, never title/occupation guesses', () => {
  const circles = [
    { id: 'a', name: 'My family', kindTag: 'Family' },
    { id: 'b', name: 'Work' },
    { id: 'c', name: 'Dating prospects' },
    { id: 'd', name: 'Family', origin: 'inbound' },
  ] as any;
  const rows = [
    { circleId: 'a', contactId: 'one' },
    { circleId: 'b', contactId: 'two' },
    { circleId: 'c', contactId: 'three' },
    { circleId: 'd', contactId: 'four' },
  ] as any;
  assert.deepEqual(membershipsFromCircles(circles, rows), { Family: ['one'], Work: ['two'] });
});
test('general graph sorts the entire supplied network by confirmed scores, unknown values last', () => {
  const people = Array.from({ length: 200 }, (_, i) => ({ id: String(i), name: `Person ${i}` }));
  const result = orderByPeopleRank(people, [
    { contactId: '199', score: 0.9, computedAt: 'today' },
    { contactId: '1', score: 0.3, computedAt: 'today' },
    { contactId: '0', score: 1, computedAt: null },
  ]);
  assert.equal(result.length, 200);
  assert.equal(result[0].id, '199');
  assert.equal(result[1].id, '1');
});
test('nearby matches known city names, not arbitrary substrings or missing locations', () => {
  assert.equal(sameCity('Montréal, QC', 'Montreal'), true);
  assert.equal(sameCity(undefined, undefined), false);
  assert.equal(sameCity('York', 'New York'), false);
});
