/**
 * THE POLL MUST NOT LOOK LIKE A CHANGE.
 *
 * A DM thread re-reads its newest twenty rows every four seconds. Before this,
 * every one of those reads replaced every message object and returned a new
 * array, so React re-rendered every visible bubble twenty times a minute -- and
 * memoizing the bubble could not help, because the object really was new.
 *
 * These tests are about IDENTITY, which is an odd thing to assert and is the
 * whole point: the values were always right. Nothing on screen was ever wrong.
 * What was wrong was that the merge said "everything changed" when nothing had,
 * and identity is the only way to catch a lie of that shape.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeMessages, messageSignature } from './dmsMerge.ts';
import type { DmMessage } from './dms.ts';

function msg(id: string, over: Partial<DmMessage> = {}): DmMessage {
  return {
    id,
    mine: false,
    kind: 'text',
    body: `message ${id}`,
    durationMs: 0,
    byteSize: 0,
    peaks: [],
    audioStatus: 'none',
    createdAt: '2026-09-11T12:00:00.000Z',
    reactions: { counts: {}, mine: null },
    ...over,
  };
}

/** What a poll response is: the same rows, parsed again into new objects. */
function reparse(list: DmMessage[]): DmMessage[] {
  return JSON.parse(JSON.stringify(list)) as DmMessage[];
}

test('a poll that brings back the same rows changes nothing at all', () => {
  const prev = [msg('30'), msg('29'), msg('28')];
  const next = mergeMessages(prev, reparse(prev));
  assert.equal(next, prev, 'the array itself was replaced, so every row re-renders');
});

test('...and that is true of a voice row too, waveform and all', () => {
  const prev = [
    msg('12', { kind: 'voice', body: 'talked about the trip', durationMs: 8200, peaks: [3, 40, 71, 22] }),
  ];
  assert.equal(mergeMessages(prev, reparse(prev)), prev);
});

test('a new message is added, and the rows already there keep their objects', () => {
  const a = msg('30');
  const b = msg('29');
  const prev = [a, b];
  const next = mergeMessages(prev, [msg('31')]);
  assert.notEqual(next, prev, 'adding a message has to produce a new array');
  assert.deepEqual(
    next.map((m) => m.id),
    ['31', '30', '29'],
    'newest first, by numeric id',
  );
  assert.equal(next[1], a, 'an untouched row was replaced with an equal copy');
  assert.equal(next[2], b, 'an untouched row was replaced with an equal copy');
});

test('a row whose contents really changed IS replaced', () => {
  const before = msg('30');
  const after = msg('30', { reactions: { counts: { love: 1 }, mine: 'love' } });
  const prev = [before];
  const next = mergeMessages(prev, [after]);
  assert.notEqual(next, prev, 'a real change has to produce a new array');
  assert.equal(next[0], after, 'the new reaction did not land');
});

test('a transcript arriving on a voice note is a change', () => {
  const pendingTranscript = msg('7', { kind: 'voice', body: null, audioStatus: 'pending' });
  const arrived = msg('7', { kind: 'voice', body: 'see you at eight', audioStatus: 'ready' });
  assert.notEqual(
    mergeMessages([pendingTranscript], [arrived])[0],
    pendingTranscript,
    'the transcript appearing was treated as no change',
  );
});

test('a pin is a change, and unpinning is a change back', () => {
  const plain = msg('9');
  const pinned = msg('9', { pinnedAt: '2026-09-11T13:00:00.000Z', pinnedByMe: true });
  assert.notEqual(messageSignature(plain), messageSignature(pinned));
  assert.equal(mergeMessages([plain], [pinned])[0], pinned);
  assert.equal(mergeMessages([pinned], [plain])[0], plain);
});

test('reaction counts in a different order are the same reactions', () => {
  // Two responses, same reactions, keys written in a different order. Object key
  // order is not part of what a reaction IS, and a signature that says otherwise
  // fires on nothing -- which is the bug, restored.
  const one = msg('4', { reactions: { counts: { love: 2, ha: 1 }, mine: 'love' } });
  const two = msg('4', { reactions: { counts: { ha: 1, love: 2 }, mine: 'love' } });
  assert.equal(messageSignature(one), messageSignature(two));
  const prev = [one];
  assert.equal(mergeMessages(prev, [two]), prev, 'key order was treated as a change');
});

test('an empty poll response is not a change', () => {
  const prev = [msg('30')];
  assert.equal(mergeMessages(prev, []), prev);
});

test('a pending row sorts above every real one and does not corrupt the order', () => {
  // DmThreadView gives an unacknowledged message a numeric id above any bigserial
  // precisely so this comparator keeps working. Assert the property rather than
  // trusting the comment.
  const pending = msg('9000000000000001', { mine: true, body: 'on my way' });
  const next = mergeMessages([msg('30'), msg('29')], [pending]);
  assert.deepEqual(next.map((m) => m.id), ['9000000000000001', '30', '29']);
});

test('a non-numeric id sorts to the end instead of scrambling the list', () => {
  /**
   * THE FIRST VERSION OF THIS TEST WAS WORTHLESS, and it is worth saying why.
   *
   * It merged one junk id into a two-message thread and asserted the result was
   * ['30','29','oops'] -- which the NAIVE comparator also produces. `Number(b.id)
   * - Number(a.id)` returns NaN for the junk row, and a NaN result is neither
   * greater nor less than zero, so V8's insertion sort leaves the pair where it
   * found them. On three elements already in order, a broken comparator and a
   * correct one agree.
   *
   * Mutation-tested rather than reasoned about: replacing the comparator with the
   * naive one left the whole suite green. This input is the one that actually
   * separates them -- the junk row sits SECOND, and the NaN comparisons around it
   * strand 100 at the front and reverse the rest:
   *
   *     naive:  100, oops, 103, 102, 101
   *     right:  103, 102, 101, 100, oops
   *
   * That is the real shape of the hazard. A NaN comparator does not misplace the
   * one bad row; it makes the ordering of the GOOD rows meaningless, which in a
   * chat means messages jumping around the thread.
   */
  const prev = [msg('100'), msg('oops')];
  const next = mergeMessages(prev, [msg('101'), msg('102'), msg('103')]);
  assert.deepEqual(
    next.map((m) => m.id),
    ['103', '102', '101', '100', 'oops'],
    'a junk id dragged the real messages out of order',
  );
});

test('the signature does not fold in fields that are not part of the message', () => {
  // The trap this replaced JSON.stringify to avoid: the server adding a field, or
  // sending the same row with a fresh timestamp, must not make every row look
  // different and quietly restore the churn.
  const a = msg('5');
  const b = { ...msg('5'), serverSeenAt: '2026-09-11T14:00:00.000Z' } as DmMessage;
  assert.equal(messageSignature(a), messageSignature(b));
});
