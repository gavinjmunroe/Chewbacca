/**
 * THE ANSWER STILL BEING THERE WHEN YOU REOPEN THE NOTE.
 *
 * This is the cache behind "I asked something, closed the app, came back, and
 * the reply was gone". Every rule in it is about not losing an answer and not
 * showing the wrong one: which question a stored answer belongs to, what happens
 * when the same question is asked twice, and which threads get evicted when the
 * cache is full.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ANSWER_CHARS,
  MAX_TURNS,
  findTurn,
  isStorable,
  normalizeQuery,
  parseEntries,
  threadsToEvict,
  upsertTurn,
} from './turnCacheRules.ts';

const turn = (query: string, answer = 'an answer', messageId: string | null = null) => ({ query, answer, messageId });

test('the same question typed differently is the same question', () => {
  const forms = ['Who do I know in NYC?', 'who do i know in nyc?', '  Who   do I know in NYC?  ', 'WHO DO I KNOW IN NYC?'];
  const keys = new Set(forms.map(normalizeQuery));
  assert.equal(keys.size, 1, [...keys].join(' | '));
  assert.equal(normalizeQuery('  a\t\nb  '), 'a b');
  assert.equal(normalizeQuery(null as any), '');
});

test('a turn with no question or no answer is not worth storing', () => {
  assert.equal(isStorable(turn('who is Ana', 'she is a nurse')), true);
  assert.equal(isStorable(turn('', 'an answer')), false);
  assert.equal(isStorable(turn('   ', 'an answer')), false);
  assert.equal(isStorable(turn('a question', '')), false);
  assert.equal(isStorable(turn('a question', '   ')), false);
  assert.equal(isStorable(null), false);
});

test('asking the same thing twice replaces the answer instead of growing the thread', () => {
  let entries = upsertTurn([], turn('who is Ana', 'first'), 1000);
  entries = upsertTurn(entries, turn('  WHO IS ANA  ', 'second'), 2000);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].answer, 'second');
  assert.equal(entries[0].savedAt, 2000);
});

test('the newest turn is last, and the thread is capped', () => {
  let entries: any[] = [];
  for (let i = 0; i < MAX_TURNS + 12; i += 1) entries = upsertTurn(entries, turn(`q${i}`, `a${i}`), i);
  assert.equal(entries.length, MAX_TURNS);
  assert.equal(entries.at(-1)!.query, `q${MAX_TURNS + 11}`, 'the newest turn was dropped instead of the oldest');
  assert.equal(entries[0].query, `q12`);
});

test('an enormous answer is truncated rather than refused', () => {
  // Losing the answer entirely because it was long is worse than losing its
  // tail; the user can still read what they had.
  const huge = 'x'.repeat(MAX_ANSWER_CHARS + 5000);
  const [entry] = upsertTurn([], turn('q', huge));
  assert.equal(entry.answer.length, MAX_ANSWER_CHARS);
});

test('an unstorable turn leaves the thread exactly as it was', () => {
  const before = upsertTurn([], turn('q', 'a'), 1);
  const after = upsertTurn(before, turn('', 'a'), 2);
  assert.equal(after, before, 'a rejected turn should not even copy the array');
});

test('finding an answer matches on the question, newest first', () => {
  let entries = upsertTurn([], turn('who is Ana', 'older'), 1);
  entries = [...entries, { ...entries[0], answer: 'newer', savedAt: 2 }];
  assert.equal(findTurn(entries, 'WHO IS ANA')?.answer, 'newer');
  assert.equal(findTurn(entries, 'someone else'), null);
  assert.equal(findTurn(entries, ''), null);
  assert.equal(findTurn([], 'anything'), null);
});

test('stored garbage reads as an empty cache, never as a crash', () => {
  assert.deepEqual(parseEntries(null), []);
  assert.deepEqual(parseEntries(''), []);
  assert.deepEqual(parseEntries('not json'), []);
  assert.deepEqual(parseEntries('{"not":"an array"}'), []);
  assert.deepEqual(parseEntries('[1,2,3]'), []);
  assert.deepEqual(parseEntries('[{"query":"q"}]'), [], 'a turn with no answer is not a turn');
  assert.deepEqual(parseEntries('[null]'), []);
  assert.equal(parseEntries('[{"query":"q","answer":"a"},{"bad":1}]').length, 1);
});

test('eviction keeps the most recently ANSWERED threads, not the most recently written', () => {
  // A thread that was merely reopened must not outrank one that got a new
  // answer, or reading an old note evicts the reply you got five minutes ago.
  const raw = (savedAt: number) => JSON.stringify([{ query: 'q', answer: 'a', savedAt }]);
  const threads = [
    { key: 'old', raw: raw(100) },
    { key: 'newest', raw: raw(900) },
    { key: 'middle', raw: raw(500) },
  ];
  assert.deepEqual(threadsToEvict(threads, 2), ['old']);
  assert.deepEqual(threadsToEvict(threads, 3), []);
  assert.deepEqual(threadsToEvict(threads, 0).sort(), ['middle', 'newest', 'old']);
});

test('a thread whose storage is unreadable is the first to go, not a crash', () => {
  const threads = [
    { key: 'good', raw: JSON.stringify([{ query: 'q', answer: 'a', savedAt: 500 }]) },
    { key: 'corrupt', raw: 'not json' },
    { key: 'empty', raw: null },
  ];
  assert.deepEqual(threadsToEvict(threads, 1), ['corrupt', 'empty'].sort(), 'unreadable threads should evict first');
});

test('upsert never mutates the entries it was handed', () => {
  const before = upsertTurn([], turn('q1', 'a1'), 1);
  const snapshot = JSON.stringify(before);
  upsertTurn(before, turn('q2', 'a2'), 2);
  assert.equal(JSON.stringify(before), snapshot);
});
