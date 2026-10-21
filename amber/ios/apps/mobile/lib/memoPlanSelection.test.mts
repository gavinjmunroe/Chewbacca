import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMemoPlan } from './memoPlanSelection.ts';
import { blankMemoAction } from './memoActions.ts';
const a = {
  id: 'a',
  version: 'one',
  title: 'Coffee',
  description: 'Original A',
  place: 'Cafe',
  startsAt: '2026-10-05T10:00:00Z',
  endsAt: '2026-10-05T11:00:00Z',
  provider: 'google',
};
const b = {
  ...a,
  id: 'b',
  description: 'Original B',
  place: 'Park',
  startsAt: '2026-10-06T10:00:00Z',
  endsAt: '2026-10-06T11:00:00Z',
};
test('switching plan candidates does not carry the first plan’s date, place or description', () => {
  const draft = blankMemoAction('Coffee with Maya', 'calendar');
  const first = selectMemoPlan(draft, a),
    second = selectMemoPlan(draft, b);
  assert.equal(first.place, 'Cafe');
  assert.equal(second.place, 'Park');
  assert.equal(second.startsAt?.toISOString(), '2026-10-06T10:00:00.000Z');
  assert.equal(second.text, 'Original B\n\nMemo: Coffee with Maya');
});
test('explicit memo time and place override candidate context; missing end stays unconfirmed', () => {
  const draft = {
    ...blankMemoAction('Move coffee', 'calendar'),
    needsTiming: false,
    place: 'Library',
  };
  assert.equal(selectMemoPlan(draft, a).startsAt, draft.startsAt);
  assert.equal(selectMemoPlan(draft, a).place, 'Library');
  assert.equal(
    selectMemoPlan(blankMemoAction('Coffee', 'calendar'), { ...a, endsAt: null }).needsTiming,
    true,
  );
});
