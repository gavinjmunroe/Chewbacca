import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s,c,n){if(c.parentURL?.endsWith('/memoQuery.ts')&&s==='./chat')return {url:'data:text/javascript,export const streamChat=()=>{}',shortCircuit:true};return n(s,c);}`)}`, import.meta.url);
const { queryMemo, memoQueryMessage, memoRecordedOn, shouldStartMemoQuery } = await import('./memoQuery.ts');
const memo = { id: 'memo-id', text: 'Alex is hosting a walk', createdAt: '2026-10-03T10:00:00Z', destination: '', cloud: { conversationId: 'memo-id', originalText: 'Alex is hosting a walk', transcriptSaved: true } };
test('automatic query stays attached to the saved memo and preserves query semantics', async () => {
  let calls = 0;
  const progress: string[] = [];
  const turn = await queryMemo(memo, { signal: new AbortController().signal, onProgress: text => progress.push(text) }, async (message: string, options: any) => {
    calls++; assert.equal(options.conversationId, memo.id); assert.equal(options.followUp, true);
    assert.equal(options.forceWeb, undefined); assert.match(message, /\?$/);
    options.onEvent({ type: 'token', text: 'Ask Alex about the walk.' });
    options.onEvent({ type: 'people', people: [{ id: 'alex' }, { contactId: 'alex' }, null, { id: 12 }] });
    options.onEvent({ type: 'persisted', saved: true }); options.onEvent({ type: 'complete' });
  });
  assert.deepEqual(progress, ['Ask Alex about the walk.']); assert.equal(calls, 1); assert.equal(turn.saved, true); assert.deepEqual(turn.peopleIds, ['alex']);
});
test('unsaved transcript never starts a model request', async () => {
  await assert.rejects(queryMemo({ ...memo, cloud: { ...memo.cloud, transcriptSaved: false } }, { signal: new AbortController().signal }, async () => assert.fail('not saved')), /Save the transcript/);
});
test('truncated, error and aborted streams never report success or retry automatically', async () => {
  for (const kind of ['truncated', 'error', 'abort']) {
    const controller = new AbortController(); let calls = 0;
    await assert.rejects(queryMemo(memo, { signal: controller.signal }, async (_: string, o: any) => {
      calls++; o.onEvent({ type: 'token', text: 'partial' });
      if (kind === 'error') { o.onEvent({ type: 'error' }); o.onEvent({ type: 'complete' }); }
      if (kind === 'abort') { controller.abort(); o.onEvent({ type: 'complete' }); }
    })); assert.equal(calls, 1);
  }
});
test('answer without persistence acknowledgment remains explicitly unconfirmed', async () => {
  const turn = await queryMemo(memo, { signal: new AbortController().signal, question: 'Who could join?' }, async (_: string, o: any) => {
    o.onEvent({ type: 'token', text: 'A suggestion' }); o.onEvent({ type: 'complete' });
  }); assert.equal(turn.saved, false); assert.equal(turn.question, 'Who could join?');
});
test('memo query stays inside API length limit and dates use local recording date', () => {
  assert.ok(memoQueryMessage('a'.repeat(32000), 'b'.repeat(9000)).length < 8000);
  assert.equal(memoRecordedOn(new Date(2026, 9, 3, 23, 59).toISOString(), new Date(2026, 9, 3)), true);
  assert.equal(memoRecordedOn(new Date(2026, 9, 4, 0, 0).toISOString(), new Date(2026, 9, 3)), false);
  assert.equal(memoRecordedOn(undefined, new Date()), false);
});

test('only a queued memo with its current transcript saved starts automatically', () => {
  for (const status of [undefined, 'running', 'complete', 'error'])
    assert.equal(shouldStartMemoQuery({ ...memo, query: status ? { status: status as any, turns: [] } : undefined }), false);
  const queued = { ...memo, query: { status: 'queued' as const, turns: [] } };
  assert.equal(shouldStartMemoQuery(queued), true);
  assert.equal(shouldStartMemoQuery({ ...queued, text: 'Unsaved edit' }), false);
  assert.equal(shouldStartMemoQuery({ ...queued, text: '' }), false);
  assert.equal(shouldStartMemoQuery({ ...queued, cloud: { ...memo.cloud, transcriptSaved: false } }), false);
});
