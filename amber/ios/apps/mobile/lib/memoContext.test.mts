import test from 'node:test';
import assert from 'node:assert/strict';
import { contextualMemo } from './memoContext';
import { actionKey, blankMemoAction } from './memoActions';
test('context preserves the spoken words and labels provenance for cloud history', () => {
  const text = 'Move it to Friday. Keep the guest list.';
  assert.equal(contextualMemo(text), text);
  assert.equal(contextualMemo(text, { kind: 'plan', id: 'private-id', label: 'Dinner', place: 'Cafe' }), 'Attached to plan: Dinner\nPlace: Cafe\n\nVoice memo:\n'+text);
  assert.ok(!contextualMemo(text, { kind: 'person', id: 'private-id', label: 'Maya' }).includes('private-id'));
});
test('participant order does not create duplicate action IDs but changed people do', () => {
  const draft = { ...blankMemoAction('Lunch', 'calendar'), participantIds: ['a','b'] };
  assert.equal(actionKey(draft), actionKey({ ...draft, participantIds: ['b','a'] }));
  assert.notEqual(actionKey(draft), actionKey({ ...draft, participantIds: ['a'] }));
});
