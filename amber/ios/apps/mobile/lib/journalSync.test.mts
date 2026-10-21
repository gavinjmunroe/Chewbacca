import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
const loader = `
const stub = source => ({url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true});
export async function resolve(specifier,context,next){
 if(context.parentURL?.endsWith('/journalSync.ts')){
  if(specifier==='./medhaId')return stub('export const callMedhaId=(...args)=>globalThis.__journalCall(...args);');
  if(specifier==='./noteMedia')return stub('export const uploadNoteAudio=(...args)=>globalThis.__journalUpload(...args);');
 }
 return next(specifier,context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);
const { syncJournalMemo, journalSyncLabel } = await import('./journalSync.ts');
const state = globalThis as any;
const entry = {
  id: 'local', text: 'Original words', destination: 'Needs review',
  createdAt: '2026-09-20T12:00:00Z',
  cloud: { conversationId: '11111111-1111-4111-8111-111111111111', originalText: 'Original words' },
  media: { uri: 'file:///private/memo.m4a', durationMs: 2000, peaks: [12, 50] },
};
test('private memo keeps original transcript and uploads against Main conversation ID', async () => {
  const order: string[] = [];
  state.__journalCall = async (request: any) => {
    order.push('save');
    assert.equal(request.method, 'PUT');
    assert.equal(request.requireAuth, true);
    assert.equal(request.path, `/v1/me/journal/${entry.cloud.conversationId}`);
    assert.equal(request.body.text, 'Original words');
    return { ok: true, data: { ok: true, conversationId: entry.cloud.conversationId } };
  };
  state.__journalUpload = async (id: string, uri: string) => {
    order.push('audio');
    assert.equal(id, entry.cloud.conversationId);
    assert.equal(uri, entry.media.uri);
    return true;
  };
  const cloud = await syncJournalMemo(entry);
  assert.equal(cloud.transcriptSaved, true);
  assert.equal(cloud.audioSaved, true);
  assert.deepEqual(order, ['save', 'audio']);
});
test('unavailable or malformed server save leaves audio local and never attempts upload', async () => {
  state.__journalUpload = () => assert.fail('must not upload');
  for (const result of [{ ok: false, status: 404 }, { ok: true, data: { ok: false } }, { ok: true, data: { ok: true, conversationId: 'wrong' } }]) {
    state.__journalCall = async () => result;
    const cloud = await syncJournalMemo(entry);
    assert.equal(cloud.transcriptSaved, undefined);
    assert.ok(cloud.error);
  }
});
test('audio failure preserves successful transcript and retry does not write it again', async () => {
  state.__journalCall = () => assert.fail('must not rewrite confirmed transcript');
  state.__journalUpload = async () => false;
  const cloud = await syncJournalMemo({ ...entry, cloud: { ...entry.cloud, transcriptSaved: true } });
  assert.equal(cloud.transcriptSaved, true);
  assert.equal(cloud.audioSaved, false);
  assert.ok(cloud.error);
  state.__journalUpload = async () => true;
  const retry = await syncJournalMemo({ ...entry, cloud });
  assert.equal(retry.audioSaved, true);
  assert.equal(retry.error, undefined);
});
test('completed audio is not uploaded again when reopening a memo', async () => {
  state.__journalCall = state.__journalUpload = () => assert.fail('must not repeat');
  const cloud = await syncJournalMemo({ ...entry, cloud: { ...entry.cloud, transcriptSaved: true, audioSaved: true } });
  assert.equal(journalSyncLabel({ ...entry, cloud }), 'Saved privately to Amber');
});
test('lost save response remains retryable with the same conversation identity', async () => {
  state.__journalCall = async () => { throw Error('connection lost'); };
  const cloud = await syncJournalMemo(entry);
  assert.equal(cloud.conversationId, entry.cloud.conversationId);
  assert.equal(cloud.originalText, entry.cloud.originalText);
  assert.ok(cloud.error);
});

test('corrected transcript uses compare-and-set and preserves first recording transcript', async () => {
  const corrected = { ...entry, text: 'Corrected words', cloud: { ...entry.cloud, transcriptSaved: true, audioSaved: true } };
  state.__journalCall = async (request: any) => {
    assert.equal(request.method, 'PATCH');
    assert.deepEqual(request.body, { previousText: 'Original words', text: 'Corrected words' });
    return { ok: true, data: { ok: true, conversationId: entry.cloud.conversationId, text: 'Corrected words' } };
  };
  state.__journalUpload = () => assert.fail('audio already saved');
  const cloud = await syncJournalMemo(corrected);
  assert.equal(cloud.syncedText, 'Corrected words');
  assert.equal(cloud.originalText, 'Original words');
  state.__journalCall = () => assert.fail('confirmed correction must not repeat');
  assert.equal((await syncJournalMemo({ ...corrected, cloud })).error, undefined);
});
test('failed correction keeps original cloud revision and local text for retry', async () => {
  const corrected = { ...entry, text: 'Corrected words', cloud: { ...entry.cloud, transcriptSaved: true, audioSaved: true } };
  state.__journalCall = async () => ({ ok: false, status: 409 });
  const cloud = await syncJournalMemo(corrected);
  assert.equal(cloud.transcriptSaved, true);
  assert.equal(cloud.syncedText, undefined);
  assert.ok(cloud.error);
  assert.equal(corrected.text, 'Corrected words');
});

test('unsynced transcript edits never claim the cloud has the corrected words', () => {
  assert.equal(journalSyncLabel({ ...entry, text: 'Edited words', cloud: { ...entry.cloud, transcriptSaved: true, audioSaved: true } }), 'Transcript edits saved on this device');
});

test('query readiness is emitted after transcript save and before audio upload finishes', async () => {
  const order: string[] = [];
  state.__journalCall = async () => { order.push('saved'); return { ok: true, data: { ok: true, conversationId: entry.cloud.conversationId } }; };
  state.__journalUpload = async () => { order.push('audio'); return true; };
  await syncJournalMemo(entry, cloud => { assert.equal(cloud.transcriptSaved, true); assert.equal(cloud.audioSaved, undefined); order.push('query-ready'); });
  assert.deepEqual(order, ['saved', 'query-ready', 'audio']);
});
