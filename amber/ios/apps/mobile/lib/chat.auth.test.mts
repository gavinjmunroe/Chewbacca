import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
const loader = `
const stub = source => ({url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true});
export async function resolve(specifier,context,next){
 if(context.parentURL?.endsWith('/chat.ts')){
  if(specifier==='./aiConsent')return stub('export const ensureProcessingConsent=async()=>true;');
  if(specifier==='expo/fetch')return stub('export const fetch=(...args)=>globalThis.__chatFetch(...args);');
  if(specifier==='./config')return stub('export const config={medhaIdBaseUrl:"https://test.invalid"};');
  if(specifier==='./sessionRefresh')return stub('export const getFreshAccessToken=()=>globalThis.__freshToken();');
 }
 return next(specifier,context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);
const { streamChat } = await import('./chat.ts');
const state = globalThis as any;
const response = () =>
  new Response('event: complete\ndata: {"conversationId":"c"}\n\n', { status: 200 });
test('web follow-ups use the refreshed credential and retain routing and conversation ID', async () => {
  let calls = 0;
  state.__freshToken = async () => 'fresh-test-token';
  state.__chatFetch = async (url: string, opts: any) => {
    calls++;
    assert.equal(url, 'https://test.invalid/v1/chat');
    assert.equal(opts.headers.authorization, 'Bearer fresh-test-token');
    const body = JSON.parse(opts.body);
    assert.equal(body.forceWeb, true);
    assert.equal(body.followUp, true);
    assert.equal(body.conversationId, 'prior');
    return response();
  };
  await streamChat('designers', {
    forceWeb: true,
    followUp: true,
    conversationId: 'prior',
    onEvent: () => {},
  });
  assert.equal(calls, 1);
});
test('missing authentication never makes a paid discovery request', async () => {
  state.__freshToken = async () => null;
  state.__chatFetch = () => {
    throw Error('must not call');
  };
  const events: any[] = [];
  await streamChat('designers', { forceWeb: true, onEvent: (e) => events.push(e) });
  assert.equal(events[0].error, 'no_session');
});
test('closing discovery while authentication is refreshing cancels before any request', async () => {
  const controller = new AbortController();
  state.__freshToken = async () => {
    controller.abort();
    return 'token';
  };
  state.__chatFetch = () => {
    throw Error('must not call');
  };
  const events: any[] = [];
  await streamChat('query', { signal: controller.signal, onEvent: (e) => events.push(e) });
  assert.equal(events.length, 0);
});
test('failed streaming request surfaces failure without auto-replaying a chargeable POST', async () => {
  let calls = 0;
  state.__freshToken = async () => 'token';
  state.__chatFetch = async () => {
    calls++;
    return new Response('{"error":"upstream_unavailable"}', { status: 503 });
  };
  const events: any[] = [];
  await streamChat('query', { onEvent: (e) => events.push(e) });
  assert.equal(calls, 1);
  assert.equal(events[0].error, 'upstream_unavailable');
});
