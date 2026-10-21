import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
const loader = `
export async function resolve(specifier, context, next) {
 let source;
 if (specifier === 'spectrum-ts') source = 'export const Spectrum = async () => globalThis.__createSpectrum(); export const text = value => value;';
 if (specifier === 'spectrum-ts/providers/imessage') source = 'export const imessage = app => app.im; imessage.config = () => ({});';
 if (source) return {url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true};
 return next(specifier,context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);
const { getSpectrumApp, _resetSpectrumApp, sendPhotonIMessage } = await import('./photon-sender.js');

test('simultaneous cold callers share a single Spectrum connection', async () => {
  _resetSpectrumApp();
  let calls = 0;
  const app = {};
  globalThis.__createSpectrum = async () => { calls++; return app; };
  const options = {projectId:'test', projectSecret:'test'};
  const results = await Promise.all([getSpectrumApp(options),getSpectrumApp(options)]);
  assert.deepEqual(results, [app, app]);
  assert.equal(calls, 1);
});

test('repeat sends reuse the dedicated space but still send each message', async () => {
  _resetSpectrumApp();
  process.env.PHOTON_PROJECT_ID = 'test';
  process.env.PHOTON_PROJECT_SECRET = 'test';
  process.env.MEDHA_SENDER_PHONE = '+13105550100';
  let creates = 0;
  const sent = [];
  globalThis.__createSpectrum = async () => ({im:{space:{create:async (to, options) => {
    creates++;
    assert.equal(to, '+13105550101');
    assert.deepEqual(options, {phone:'+13105550100'});
    return {id:'chat-1', send:async body => sent.push(body)};
  }}}});
  assert.equal(await sendPhotonIMessage('+13105550101', 'first'), 'chat-1');
  await sendPhotonIMessage('+13105550101', 'second');
  assert.equal(creates, 1);
  assert.deepEqual(sent, ['first','second']);
});
