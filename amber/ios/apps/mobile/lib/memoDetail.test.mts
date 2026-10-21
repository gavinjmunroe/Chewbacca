import test from 'node:test';
import assert from 'node:assert/strict';
import { focusedMemoSorting, memoTranscript } from './memoDetail.ts';
const entry = { id: 'memo', text: 'Met Taylor and Analise at GSB', createdAt: '', destination: '' };
const sorting = {
  text: entry.text,
  objects: {
    people: [
      { name: 'Taylor', contactId: 't', detail: 'GSB', places: [] },
      { name: 'Analise', contactId: '', detail: 'McKinsey', places: [] },
    ],
    plans: [{ title: 'Coffee', detail: 'Coffee with Taylor', places: [] }],
    places: [],
  },
  actions: [
    { kind: 'contact', personName: 'Taylor', contactId: 't', text: 'GSB' },
    { kind: 'contact', personName: 'Analise', text: 'McKinsey' },
  ],
};
test('matching is scoped to the person selected, not the first unrelated action', () => {
  assert.deepEqual(
    focusedMemoSorting(entry, sorting, { kind: 'contact', label: 'Analise', index: 1 }).actions,
    [sorting.actions[1]],
  );
});
test('an unresolved plan stays a draft without invented dates', () => {
  const result = focusedMemoSorting(entry, sorting, { kind: 'calendar', label: 'Coffee', index: 0 })
    .actions[0] as Record<string, unknown>;
  assert.equal(result.needsTiming, true);
  assert.equal(result.startsAt, undefined);
  assert.equal(result.text, 'Coffee with Taylor');
});
test('stale transcript extraction cannot supply identity or overwrite new note content', () => {
  const result = focusedMemoSorting({ ...entry, text: 'Corrected memo' }, sorting, {
    kind: 'contact',
    label: 'Taylor',
    index: 0,
  }).actions[0] as Record<string, unknown>;
  assert.equal(result.contactId, '');
  assert.equal(result.text, 'Corrected memo');
});
test('transcript removes generated context only, preserving ordinary spoken text', () => {
  assert.equal(
    memoTranscript('Attached to person: Taylor\nContext\n\nVoice memo:\nMet at GSB'),
    'Met at GSB',
  );
  assert.equal(memoTranscript('Voice memo:\nMet at GSB'), 'Voice memo:\nMet at GSB');
});
