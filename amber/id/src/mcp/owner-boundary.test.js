import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from './server.js';
import { ownerBoundHandler } from './owner-boundary.js';

test('a bound key refuses an account override before calling any data handler', async () => {
  let calls = 0;
  const handler = ownerBoundHandler({ requiresOwnerDid: true, handler: () => { calls++; } }, 'did:amber:alice');
  for (const did of ['did:amber:bob', '', ' did:amber:alice']) {
    const result = await handler({ did });
    assert.equal(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).error, 'owner_mismatch');
  }
  assert.equal(calls, 0);
});

test('bound owner is injected; unrelated arguments and MCP context survive', async () => {
  const context = { requestId: 'one' };
  const handler = ownerBoundHandler({ requiresOwnerDid: true, handler: (args, extra) => ({ args, extra }) }, 'did:amber:alice');
  assert.deepEqual(await handler({ query: 'Alex' }, context), { args: { query: 'Alex', did: 'did:amber:alice' }, extra: context });
  assert.equal((await handler({ did: 'did:amber:alice' })).args.did, 'did:amber:alice');
});

test('bound keys cannot discover or invoke arbitrary-phone session creation', async () => {
  const server = createMcpServer({ ownerDid: 'did:amber:alice' });
  const client = new Client({ name: 'boundary-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.some(t => t.name === 'search_people'));
    assert.ok(!tools.some(t => t.name === 'get_dashboard_url'));
    const denied = await client.callTool({ name: 'search_people', arguments: { query: 'Alex', did: 'did:amber:bob' } });
    assert.equal(denied.isError, true);
    const hidden = await client.callTool({ name: 'get_dashboard_url', arguments: { phone: '+14155550100' } });
    assert.equal(hidden.isError, true);
  } finally { await client.close(); await server.close(); }
});

test('unbound trusted callers retain their existing explicit-owner handler', () => {
  const handler = () => 'service';
  assert.equal(ownerBoundHandler({ handler }, null), handler);
});
