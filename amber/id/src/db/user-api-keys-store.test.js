import test from 'node:test';
import assert from 'node:assert/strict';
import { __injectPoolForSmokeTests } from './sql.js';
import { issueUserApiKey, verifyUserApiKey, listUserApiKeys, revokeUserApiKey, hashKey } from './user-api-keys-store.js';

test('issued keys store hashes only, remain purpose/owner bound, and revoke immediately', async () => {
  const rows = [];
  __injectPoolForSmokeTests({ query: async (sql, params) => {
    if (sql.includes('INSERT INTO user_api_keys')) {
      const [key_id, owner_id, key_hash, key_prefix, last4, name] = params;
      const row = { key_id, owner_id, key_hash, key_prefix, last4, name, created_at: new Date(), revoked_at: null };
      rows.push(row); return { rows: [row] };
    }
    if (sql.includes('SET last_used_at')) return { rows: [] };
    if (sql.includes('SET revoked_at')) {
      const row = rows.find(r => r.key_id === params[0] && r.owner_id === params[1] && !r.revoked_at);
      if (row) row.revoked_at = new Date(); return { rowCount: row ? 1 : 0 };
    }
    if (sql.includes('WHERE key_hash')) return { rows: rows.filter(r => r.key_hash === params[0] && !r.revoked_at) };
    if (sql.includes('WHERE owner_id')) return { rows: rows.filter(r => r.owner_id === params[0] && !r.revoked_at) };
    throw Error('Unexpected query');
  }});
  for (const purpose of ['mcp', 'ingest']) {
    const issued = await issueUserApiKey('alice', 'My agent', purpose);
    assert.equal(issued.purpose, purpose);
    assert.equal(JSON.stringify(rows).includes(issued.key), false);
    assert.equal(rows.at(-1).key_hash, hashKey(issued.key));
    assert.deepEqual(await verifyUserApiKey(issued.key, purpose), { ownerId: 'alice', keyId: issued.id });
    assert.equal(await verifyUserApiKey(issued.key, purpose === 'mcp' ? 'ingest' : 'mcp'), null);
    assert.equal((await listUserApiKeys('alice'))[0].purpose, purpose);
    assert.deepEqual(await listUserApiKeys('bob'), []);
    assert.equal(await revokeUserApiKey('bob', issued.id), false);
    assert.equal(await revokeUserApiKey('alice', issued.id), true);
    assert.equal(await verifyUserApiKey(issued.key, purpose), null);
    assert.deepEqual(await listUserApiKeys('alice'), []);
  }
});
