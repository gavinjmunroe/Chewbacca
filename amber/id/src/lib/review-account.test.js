import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import { REVIEW_PHONE, isReviewPhone, reviewCodeMatches, reviewAccountConfigured, reviewSessionAllowed } from './review-account.js';
import { verifyReviewLogin } from './review-login.js';
import { registerMobileAuthRoutes } from '../routes/mobile-auth.js';
import { registerPhoneAuthRoutes } from '../routes/phone-auth.js';
import { personIdFromHandle } from '../pdw/person-resolver.js';
import { signMedhaAccessToken, verifyMedhaSession } from './medha-jwt.js';
const ownerId = '55555555-1234-4321-8123-123456789012';
const code = '314159';
function configure() {
  process.env.APP_REVIEW_AMBER_ID = ownerId;
  process.env.APP_REVIEW_CODE_SALT = 'test-only-salt-'.repeat(4);
  process.env.APP_REVIEW_CODE_HASH = crypto.createHmac('sha256', process.env.APP_REVIEW_CODE_SALT).update(code).digest('hex');
  process.env.APP_REVIEW_EXPIRES_AT = new Date(Date.now()+86400000).toISOString();
}
test.afterEach(() => {
  for (const key of ['APP_REVIEW_AMBER_ID','APP_REVIEW_CODE_SALT','APP_REVIEW_CODE_HASH','APP_REVIEW_EXPIRES_AT']) delete process.env[key];
});
test('disabled, incomplete, expired and real-phone configurations fail closed', () => {
  assert.equal(reviewAccountConfigured(), false);
  assert.equal(reviewCodeMatches(code), false);
  configure();
  assert.equal(reviewAccountConfigured(), true);
  assert.equal(isReviewPhone('+1 (408) 555-0186'), true);
  assert.equal(isReviewPhone('+15550100004'), false);
  assert.equal(reviewCodeMatches(code), true);
  for (const bad of ['31415','3141590','314158',314159,null]) assert.equal(reviewCodeMatches(bad), false);
  process.env.APP_REVIEW_EXPIRES_AT = '2000-01-01T00:00:00Z';
  assert.equal(reviewCodeMatches(code), false);
  assert.equal(reviewSessionAllowed(REVIEW_PHONE), false);
  assert.equal(reviewSessionAllowed('+15550100004'), true);
});
function fakeDb({ isolated=true, failures=0, personId=personIdFromHandle(REVIEW_PHONE), hash }={}) {
  const review={isolated,failures,credentialHash:hash || process.env.APP_REVIEW_CODE_HASH};
  const calls=[];
  return { review, calls, transact:async fn => fn({query:async(sql,args)=> {
    calls.push({sql,args});
    if(sql.startsWith('SELECT')) return {rows:[{amber_id:ownerId,person_id:personId,tenant_metadata:{appReview:review}}]};
    review.failures=args[1]; return {rows:[]};
  }}) };
}
test('only pre-seeded isolated owner with matching credential version may sign in', async () => {
  configure();
  const db=fakeDb();
  assert.deepEqual(await verifyReviewLogin(code,db.transact),{ok:true,amberId:ownerId,personId:personIdFromHandle(REVIEW_PHONE)});
  assert.match(db.calls[0].sql,/FOR UPDATE/);
  assert.deepEqual(db.calls[0].args,[ownerId,REVIEW_PHONE]);
  for(const opts of [{isolated:false},{personId:'another-user'},{hash:'another-credential'}]) {
    const bad=fakeDb(opts); assert.equal((await verifyReviewLogin(code,bad.transact)).ok,false);
  }
});
test('persistent lifetime failure budget cannot be reset with a valid code', async () => {
  configure(); const db=fakeDb({failures:19});
  assert.equal((await verifyReviewLogin('999999',db.transact)).reason,'mismatch');
  assert.equal(db.review.failures,20);
  assert.equal((await verifyReviewLogin(code,db.transact)).reason,'too_many_attempts');
});
test('database failure cannot grant review access', async () => {
  configure(); await assert.rejects(verifyReviewLogin(code,async()=>{throw new Error('offline')}));
});
test('reserved review number never sends or issues an OTP, including when disabled', async () => {
  const app=Fastify({logger:false}); registerMobileAuthRoutes(app); registerPhoneAuthRoutes(app);
  for(const url of ['/v1/auth/otp/request','/v1/auth/start']) {
    assert.equal((await app.inject({method:'POST',url,payload:{phone:REVIEW_PHONE}})).statusCode,503);
  }
  configure();
  for(const url of ['/v1/auth/otp/request','/v1/auth/start']) {
    const res=await app.inject({method:'POST',url,payload:{phone:REVIEW_PHONE}});
    assert.equal(res.statusCode,200); assert.deepEqual(res.json(),{ok:true});
  }
  await app.close();
});
test('both verify endpoints reject review login without enabled configuration', async () => {
  const app=Fastify({logger:false}); registerMobileAuthRoutes(app); registerPhoneAuthRoutes(app);
  for(const url of ['/v1/auth/otp/verify','/v1/auth/verify']) {
    const res=await app.inject({method:'POST',url,payload:{phone:REVIEW_PHONE,code}});
    assert.equal(res.statusCode,401); assert.equal(res.json().token,undefined);
  }
  await app.close();
});
test('review access tokens stop working when configuration expires or is disabled', () => {
  configure(); process.env.MEDHA_JWT_SECRET='review-test-only-'.repeat(4);
  const token=signMedhaAccessToken({personId:personIdFromHandle(REVIEW_PHONE),phone:REVIEW_PHONE,sid:'test-session'}).token;
  assert.ok(verifyMedhaSession(token));
  delete process.env.APP_REVIEW_CODE_HASH;
  assert.equal(verifyMedhaSession(token),null);
});
