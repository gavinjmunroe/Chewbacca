import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { register } from 'node:module';
const loader = `const stub=s=>({url:'data:text/javascript,'+encodeURIComponent(s),shortCircuit:true});
export async function resolve(specifier,context,next){
 if(context.parentURL?.endsWith('/memoActionId.ts')&&specifier==='expo-crypto')return stub('export const CryptoDigestAlgorithm={SHA256:"SHA256"};export const digestStringAsync=(algo,text)=>globalThis.__memoDigest(text);');
 if(['voiceTranscribe.ts','contactNotes.ts','scheduleEdits.ts','googleCalendarWrite.ts'].some(name=>context.parentURL?.endsWith('/'+name))&&specifier==='./medhaId')return stub('export const callMedhaId=(...args)=>globalThis.__memoCall(...args);');
 return next(specifier,context);
}`;
register('data:text/javascript,' + encodeURIComponent(loader), import.meta.url);
const state = globalThis as any;
state.__memoDigest = async (text: string) => createHash('sha256').update(text).digest('hex');
const { memoActionId } = await import('./memoActionId.ts');
const { blankMemoAction } = await import('./memoActions.ts');
const { transcribeVoice } = await import('./voiceTranscribe.ts');
const { captureContactNote } = await import('./contactNotes.ts');
const { createCalendarEvent, blankEventDraft } = await import('./scheduleEdits.ts');
test('an unchanged action keeps its identity across retries; edited text or different memo is separate', async () => {
  const request = { ...blankMemoAction('Prefers mornings'), contactId: 'maya' };
  const id = await memoActionId('memo-1', request);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(await memoActionId('memo-1', { ...request }), id);
  assert.notEqual(await memoActionId('memo-2', request), id);
  assert.notEqual(await memoActionId('memo-1', { ...request, text: 'Prefers evenings' }), id);
});
test('transcription has a bounded processing deadline and forwards caller cancellation without automatic retries', async () => {
  const abort = new AbortController();
  state.__memoCall = async (opts: any) => {
    assert.equal(opts.timeoutMs, 180000);
    assert.equal(opts.retries, 0);
    assert.equal(opts.signal, abort.signal);
    assert.equal(opts.requireAuth, true);
    assert.deepEqual(opts.body, { audio: 'AAAA', mimeType: 'audio/wav' });
    return { ok: false, status: 0, error: 'aborted' };
  };
  abort.abort();
  assert.equal((await transcribeVoice('AAAA', 'audio/wav', abort.signal)).ok, false);
});
test('contact and calendar confirmations carry the same supplied action identity to Amber ID', async () => {
  const id = '33333333-3333-4333-8333-333333333333';
  const calls: any[] = [];
  state.__memoCall = async (opts: any) => {
    calls.push(opts);
    return { ok: true, data: { ok: true } };
  };
  await captureContactNote('maya', 'Prefers mornings', id);
  await createCalendarEvent(blankEventDraft(new Date('2026-09-24T10:00:00Z')), id);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.requestId, id);
  assert.equal(calls[1].body.requestId, id);
  assert.equal(calls[0].retries, 0);
  assert.equal(calls[0].timeoutMs, 90000);
});

const { createGoogleMemoEvent } = await import('./googleCalendarWrite.ts');
test('Google destination is explicit and retries reuse the same event identity', async () => {
  const request = {
    ...blankMemoAction('Lunch', 'calendar'),
    title: 'Lunch',
    googleAccountId: 'account-1',
  };
  const id = await memoActionId('memo-google', request);
  assert.equal(await memoActionId('memo-google', { ...request }), id);
  assert.notEqual(
    await memoActionId('memo-google', { ...request, googleAccountId: 'account-2' }),
    id,
  );
  state.__memoCall = async (opts: any) => {
    assert.equal(opts.path, '/v1/me/google-calendar-events');
    assert.equal(opts.body.accountId, 'account-1');
    assert.equal(opts.body.requestId, id);
    assert.equal(opts.requireAuth, true);
    assert.equal(opts.retries, 0);
    return { ok: true, data: { ok: true, destination: 'google' } };
  };
  await createGoogleMemoEvent(request, id);
  await assert.rejects(createGoogleMemoEvent({ ...request, googleAccountId: undefined }, id));
  state.__memoCall = async () => ({ ok: false, error: 'google_saved_amber_pending' });
  await assert.rejects(createGoogleMemoEvent(request, id), /Saved in Google Calendar/);
});
