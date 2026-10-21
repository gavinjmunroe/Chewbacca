import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvents, searchLocalEvents, createLocalEventsHandler } from './serp-events.mjs';
const good = { title: 'Neighborhood walk', link: 'https://example.com/events/walk', date: { when: 'Sat, 10 AM' }, address: ['Park', 'Oakland'] };
test('deduplicates events, preserves date text and excludes unsafe/missing sources', () => {
  const events = normalizeEvents({ events_results: [good, good, { ...good, link: 'javascript:alert(1)' }, null, { title: 'Unverifiable' }] });
  assert.equal(events.length, 1); assert.equal(events[0].date, 'Sat, 10 AM'); assert.equal(events[0].address, 'Park, Oakland');
});
test('provider errors and malformed responses are not successful empty results', () => {
  assert.throws(() => normalizeEvents({ error: 'invalid key' }));
  assert.throws(() => normalizeEvents({ events_results: {} }));
});
test('uses google_events with explicit city and query', async () => {
  let target;
  const result = await searchLocalEvents({ query: 'art events', city: 'Oakland, CA' }, { apiKey: 'fixture', fetchImpl: async url => { target = url; return { ok: true, json: async () => ({ events_results: [good] }) }; } });
  assert.equal(target.searchParams.get('engine'), 'google_events'); assert.equal(target.searchParams.get('location'), 'Oakland, CA'); assert.equal(result.events.length, 1);
});
function response() { return { code: 200, body: null, setHeader() {}, status(code) { this.code=code; return this; }, json(body) { this.body=body; return this; } }; }
test('fails closed before provider calls for unauthenticated and rate limited users', async () => {
  let calls=0; const fetchImpl=async()=>{calls++;throw Error('must not fetch')};
  for (const [owner, allowed, status] of [[null,true,401],['owner',false,429]]) { const handler=createLocalEventsHandler({ authenticate:async()=>owner, rateLimit:async()=>allowed, apiKey:'fixture', fetchImpl }); const res=response(); await handler({query:{q:'events',city:'Oakland'}},res);assert.equal(res.code,status); }
  assert.equal(calls,0);
});
test('missing server key reports unavailable and never exposes secrets', async () => {
  const handler=createLocalEventsHandler({authenticate:async()=> 'owner',rateLimit:async()=>true});const res=response();await handler({query:{q:'events',city:'Oakland'}},res);assert.equal(res.code,503);assert.deepEqual(res.body,{error:'event_provider_not_configured'});
});
test('invalid query and array city rejected without provider call', async () => {
  const handler=createLocalEventsHandler({authenticate:async()=> 'owner',rateLimit:async()=>true}); const res=response();await handler({query:{q:'events',city:['Oakland']}},res);assert.equal(res.code,400);
});
