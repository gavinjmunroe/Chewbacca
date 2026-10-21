import test from 'node:test';
import assert from 'node:assert/strict';
import { personalMcpIdentity } from './personal-mcp-auth.js';
import { looksLikeUserApiKey, verifyUserApiKey } from '../db/user-api-keys-store.js';

test('MCP and ingest credentials cannot cross purpose boundaries', async () => {
  assert.equal(looksLikeUserApiKey('amberk_live_test', 'mcp'), false);
  assert.equal(looksLikeUserApiKey('ambermcp_live_test'), false);
  assert.equal(await verifyUserApiKey('ambermcp_live_test'), null);
  assert.equal(await verifyUserApiKey('amberk_live_test', 'mcp'), null);
  let checked = false;
  assert.equal(await personalMcpIdentity('amberk_live_test', { verify: () => { checked = true; } }), null);
  assert.equal(checked, false);
});

test('personal MCP resolves only the key owner and verifies its account is live', async () => {
  const result = await personalMcpIdentity('ambermcp_live_test', {
    verify: async (key, purpose) => { assert.equal(purpose, 'mcp'); return { ownerId: 'alice', keyId: 'key-one' }; },
    phone: async owner => { assert.equal(owner, 'alice'); return '+14155550100'; },
  });
  assert.deepEqual(result, { ownerDid: 'did:amber:alice', keyId: 'key-one' });
});

test('revoked, deleted and temporary review identities cannot authenticate with MCP', async () => {
  const key = 'ambermcp_live_test';
  assert.equal(await personalMcpIdentity(key, { verify: async () => null }), null);
  for (const phone of [null, '+14085550186']) {
    assert.equal(await personalMcpIdentity(key, {
      verify: async () => ({ ownerId: 'alice', keyId: 'key-one' }), phone: async () => phone,
    }), null);
  }
});
