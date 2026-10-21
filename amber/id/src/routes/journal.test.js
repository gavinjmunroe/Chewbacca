import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerJournalRoutes } from './journal.js';
import { saveJournalMemo } from '../db/journal-store.js';
const id = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';
const body = { text: 'Morning walk', voice: true, createdAt: '2026-09-20T10:00:00Z' };
async function request(overrides = {}, payload = body, url = `/v1/me/journal/${id}`) {
  const app = Fastify();
  registerJournalRoutes(app, {
    requireAuth: async req => { req.privyUser = { userId: 'did:amber:me', phone: '+12025550123' }; },
    resolveOwner: async () => owner,
    save: async (actualOwner, memo) => {
      assert.equal(actualOwner, owner);
      assert.equal(memo.id, id);
      return { ok: true, created: true, conversationId: memo.id, createdAt: memo.createdAt };
    },
    ...overrides,
  });
  try { return await app.inject({ method: 'PUT', url, payload }); }
  finally { await app.close(); }
}
test('journal creates a private Main-compatible conversation using the authenticated owner', async () => {
  const res = await request();
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().conversationId, id);
});
test('unauthenticated or unresolved account cannot write', async () => {
  const save = () => assert.fail('must not save');
  assert.equal((await request({ requireAuth: async () => {}, save })).statusCode, 401);
  assert.equal((await request({ resolveOwner: async () => null, save })).statusCode, 401);
});
test('invalid IDs, dates, empty typed memos and oversized input are rejected', async () => {
  const overrides = { save: () => assert.fail('must not save') };
  assert.equal((await request(overrides, body, '/v1/me/journal/not-a-uuid')).statusCode, 400);
  for (const patch of [{ createdAt: 'bad' }, { createdAt: '2099-01-01T00:00:00Z' }, { voice: false, text: ' ' }, { text: 'x'.repeat(32001) }])
    assert.equal((await request(overrides, { ...body, ...patch })).statusCode, 400);
});
test('audio can be saved even when transcription returned no words', async () => {
  assert.equal((await request({}, { ...body, text: '' })).statusCode, 201);
});
test('existing memo replay returns 200; conflicting/deleted/unowned ID never gets overwritten', async () => {
  assert.equal((await request({ save: async () => ({ ok: true, created: false, conversationId: id }) })).statusCode, 200);
  assert.equal((await request({ save: async () => ({ ok: false, error: 'memo_conflict' }) })).statusCode, 409);
});
test('storage failure cannot claim a confirmed save', async () => {
  assert.equal((await request({ save: async () => { throw Error('database unavailable'); } })).statusCode, 500);
});
test('store atomically inserts exactly one conversation and message, with recording time', async () => {
  const calls = [];
  const result = await saveJournalMemo(owner, { id, ...body }, async fn => fn({ query: async (sql, args) => {
    calls.push({ sql, args });
    return { rowCount: 1, rows: [] };
  } }));
  assert.equal(result.created, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, [id, owner, body.createdAt]);
  assert.deepEqual(JSON.parse(calls[1].args[3]), { source: 'journal', voice: true });
});
test('store retry reads only the owner’s live journal entry, and never appends a second message', async () => {
  const statements = [];
  const result = await saveJournalMemo(owner, { id, ...body }, async fn => fn({ query: async (sql, args) => {
    statements.push(sql);
    if (statements.length === 1) return { rowCount: 0, rows: [] };
    assert.deepEqual(args, [id, owner]);
    assert.match(sql, /c\.owner_id = \$2/);
    assert.match(sql, /c\.deleted_at IS NULL/);
    assert.match(sql, /m\.metadata->>'source' = 'journal'/);
    return { rows: [{ content: body.text, metadata: { voice: true }, created_at: body.createdAt }] };
  } }));
  assert.equal(result.created, false);
  assert.equal(statements.length, 2);
});
test('store does not accept a changed transcript, missing entry or a different media kind', async () => {
  for (const row of [undefined, { content: 'changed', metadata: { voice: true } }, { content: body.text, metadata: { voice: false } }]) {
    let count = 0;
    const result = await saveJournalMemo(owner, { id, ...body }, async fn => fn({ query: async () => ++count === 1 ? { rowCount: 0 } : { rows: row ? [row] : [] } }));
    assert.equal(result.ok, false);
    assert.equal(count, 2);
  }
});

test('retry of original journal creation still succeeds after a confirmed transcript correction', async () => {
  let count = 0;
  const result = await saveJournalMemo(owner, { id, ...body }, async fn => fn({ query: async () => ++count === 1 ? { rowCount: 0 } : { rows: [{ content: 'Corrected text', metadata: { voice: true, originalTranscript: body.text } }] } }));
  assert.equal(result.ok, true);
  assert.equal(result.created, false);
  assert.equal(result.text, 'Corrected text');
});
