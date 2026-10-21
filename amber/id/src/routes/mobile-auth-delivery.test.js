import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { installFakeSql } from '../db/sql-fake-harness.js';
await installFakeSql({stubs:{
  '/src/lib/medha-otp-store.js': 'export const startMedhaOtp = async () => ({code:"123456",throttled:false}); export const verifyMedhaOtp = async () => ({ok:false});',
  '/src/routes/auth-sessions.js': 'export const issueSessionPair = async () => ({});',
  '/src/db/store.js': 'export const getUserByPhone = async () => null; export const resolveAmberIdByPhone = async () => null;',
  '/src/lib/photon-sender.js': 'export const sendPhotonIMessage = async () => { if (globalThis.__sendFailure) throw new Error(globalThis.__sendFailure); };',
  '/src/pdw/person-resolver.js': 'export const personIdFromHandle = () => "test-person";',
}});
const { registerMobileAuthRoutes } = await import('./mobile-auth.js');

test('request endpoint distinguishes Photon restriction and preserves successful delivery', async () => {
  const app = Fastify();
  registerMobileAuthRoutes(app);
  try {
    globalThis.__sendFailure = '[spectrum-imessage] Target not allowed for this project';
    const failure = await app.inject({method:'POST',url:'/v1/auth/otp/request',payload:{phone:'+13105550101'}});
    assert.equal(failure.statusCode, 503);
    assert.equal(failure.json().error, 'delivery_restricted');
    assert.ok(!failure.body.includes('123456'));
    globalThis.__sendFailure = null;
    const success = await app.inject({method:'POST',url:'/v1/auth/otp/request',payload:{phone:'+13105550101'}});
    assert.equal(success.statusCode, 200);
    assert.deepEqual(success.json(), {ok:true});
  } finally { await app.close(); }
});
