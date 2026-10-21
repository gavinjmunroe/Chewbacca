import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerCommunityRoutes, readCommunityRanks, readContactDetails, mapContactDetails } from './community.js';
const owner = '11111111-1111-4111-8111-111111111111';
const contact = '22222222-2222-4222-8222-222222222222';
async function request(url, deps = {}) {
  const app = Fastify();
  registerCommunityRoutes(app, {
    requireAuth: async req => { req.privyUser = { userId: 'session', phone: '+12025550100' }; },
    resolveOwner: async () => owner,
    readRanks: async actual => { assert.equal(actual, owner); return [{ contactId: contact, score: .8, computedAt: '2026-09-21' }]; },
    readDetails: async (actual, id) => { assert.equal(actual, owner); assert.equal(id, contact); return { birthday: '2000-01-01' }; },
    ...deps,
  });
  try { return await app.inject({ url }); } finally { await app.close(); }
}
test('community rank reads are authenticated and owner-scoped', async () => {
  assert.equal((await request('/v1/me/contact-ranks')).json().ranks[0].score, .8);
  assert.equal((await request('/v1/me/contact-ranks', { requireAuth: async () => {}, readRanks: () => assert.fail() })).statusCode, 401);
});
test('a failed rank read is not a successful empty network', async () => {
  assert.equal((await request('/v1/me/contact-ranks', { readRanks: async () => { throw Error(); } })).statusCode, 503);
});
test('contact details reject malformed and unowned identifiers', async () => {
  assert.equal((await request('/v1/me/contacts/bad/details', { readDetails: () => assert.fail() })).statusCode, 400);
  assert.equal((await request(`/v1/me/contacts/${contact}/details`, { readDetails: async () => null })).statusCode, 404);
});
test('ranking SQL scopes both sides of join and does not cap the graph at 50', async () => {
  const rows = await readCommunityRanks(owner, async (sql, args) => {
    assert.deepEqual(args, [owner]); assert.match(sql, /s.owner_id = c.owner_id/); assert.match(sql, /c.owner_id = \$1/); assert.match(sql, /c.deleted_at IS NULL/); assert.doesNotMatch(sql, /LIMIT/);
    return { rows: [{ contact_id: contact, base_score: null, computed_at: null }] };
  });
  assert.equal(rows[0].computedAt, null);
});
test('details expose contact data but exclude sync bookkeeping and unknown metadata', async () => {
  assert.deepEqual(mapContactDetails({ raw: { addresses: [{ city: 'Chicago' }], privateToken: 'exclude' }, metadata: { nickname: 'Jo', syncCursor: 'exclude' }, website: 'https://example.org' }), { nickname: 'Jo', addresses: [{ city: 'Chicago' }], website: 'https://example.org' });
  await readContactDetails(owner, contact, async (sql, args) => {
    assert.deepEqual(args, [owner, contact]); assert.match(sql, /owner_id = \$1 AND id = \$2 AND deleted_at IS NULL/); return { rows: [] };
  });
});
