import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerConversationRoutes } from './conversations.js';
const id = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';
async function read({ audio = null, authed = true, voice = true, list = false } = {}) {
  const app = Fastify();
  registerConversationRoutes(app, {
    requireAuth: async req => { if (authed) req.privyUser = { userId: 'did:amber:me', phone: '+12025550123' }; },
    resolveAmberIdByPhone: async () => owner,
    listConversation: async (actualOwner, actualId) => {
      assert.equal(actualOwner, owner); assert.equal(actualId, id);
      return [{ id: '1', role: 'user', content: 'My memo', metadata: { voice } }];
    },
    listRecentConversations: async () => [{ conversation_id: id, kind: 'note' }],
    getFiledPeopleForConversation: async () => ({ people: [], pendingNames: [] }),
    getMessageAudioForConversation: async () => ({}),
    getAudioRow: async (actualOwner, actualId) => {
      assert.equal(actualOwner, owner); assert.equal(actualId, id); return audio;
    },
  });
  try { return await app.inject({ url: list ? '/v1/conversations' : `/v1/conversations/${id}` }); }
  finally { await app.close(); }
}
test('opening a memo returns original recording metadata without storage keys or signed URLs', async () => {
  const res = await read({ audio: { status: 'ready', duration_ms: '1000', byte_size: '2400', peaks: [1, 50], storage_key: 'private/storage/key' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().audio, { durationMs: 1000, byteSize: 2400, peaks: [1, 50] });
  assert.equal(res.json().ownerId, owner);
  assert.ok(!res.body.includes('private/storage'));
});
test('pending or absent audio is never shown as playable', async () => {
  assert.equal((await read({ audio: { status: 'pending' } })).json().audio, null);
  assert.equal((await read()).json().audio, null);
});
test('original audio metadata is behind the existing auth gate', async () => {
  assert.equal((await read({ authed: false })).statusCode, 401);
});
test('journal media kind preserves typed versus recorded distinction in history', async () => {
  assert.equal((await read({ list: true, voice: true })).json().conversations[0].voice, true);
  assert.equal((await read({ list: true, voice: false })).json().conversations[0].voice, false);
});
