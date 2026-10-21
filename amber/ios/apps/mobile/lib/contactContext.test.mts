import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContactFacts, contactSourceGroups, detailText } from './contactContext.ts';
test('Amber ID observation text, timestamp and original memo ID survive normalization', () => {
  const [fact] = normalizeContactFacts([
    {
      id: 'a',
      fact_text: 'Met at school',
      observed_at: '2026-09-21',
      source: 'soundboard',
      source_conversation_id: 'memo-a',
      dimensions: [{ code: 'social' }],
    },
  ]);
  assert.equal(fact.factText, 'Met at school');
  assert.equal(fact.createdAt, '2026-09-21');
  assert.equal(fact.sourceConversationId, 'memo-a');
  assert.deepEqual(
    contactSourceGroups('apple', [fact]).map((g) => g.label),
    ['Apple Contacts', 'Voice memos'],
  );
});
test('all server facts stay visible and blank malformed records cannot create empty cards', () => {
  assert.equal(
    normalizeContactFacts(Array.from({ length: 350 }, (_, id) => ({ id, text: `Memory ${id}` })))
      .length,
    350,
  );
  assert.deepEqual(normalizeContactFacts([null, { id: 'a' }, { body: 'missing id' }]), []);
  assert.equal(
    normalizeContactFacts([{ id: 1, factText: 'Legacy value' }])[0].factText,
    'Legacy value',
  );
});
test('structured address and date fields retain values', () => {
  assert.match(
    detailText([{ label: 'home', city: 'Chicago', street: 'Test Street' }]),
    /home.*Chicago.*Test Street/,
  );
});
