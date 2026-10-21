import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerOnboardingContextRoutes, saveOnboardingContext } from './onboarding-context.js';
const owner = '11111111-1111-4111-8111-111111111111';
const memoId = '22222222-2222-4222-8222-222222222222';
const contact = '33333333-3333-4333-8333-333333333333';
const input = {memoId, contactIds:[contact], priorities:['professional'], prompt:'priorities'};
async function request(body, overrides={}) {
  const app=Fastify();
  registerOnboardingContextRoutes(app, {requireAuth:async req=>{req.privyUser={userId:'did:amber:'+owner};},resolveOwner:async did=>{assert.equal(did,'did:amber:'+owner);return owner;},save:async(id,value)=>{assert.equal(id,owner);assert.deepEqual(value,input);return{context:{priorities:value}};},...overrides});
  try{return await app.inject({method:'PUT',url:'/v1/me/onboarding-context/priorities',payload:body});}finally{await app.close();}
}
test('context saves derive the owner from authenticated DID and reject invalid selections', async()=>{
  const {prompt,...body}=input;
  assert.equal((await request(body)).statusCode,200);
  assert.equal((await request({...body,contactIds:['not-a-contact']})).statusCode,400);
  assert.equal((await request({...body,priorities:['inferred-religion']})).statusCode,400);
  assert.equal((await request(body,{requireAuth:async()=>{},save:()=>assert.fail()})).statusCode,401);
});
test('unowned memos and contacts cannot change the profile',async()=>{
  for(const failAt of [1,2]){
    let calls=0;
    const result=await saveOnboardingContext(owner,input,fn=>fn({query:async(sql,args)=>{
      calls++;assert.equal(args[0],owner);
      if(calls===1){assert.match(sql,/c.owner_id = \$1/);assert.match(sql,/m.owner_id = c.owner_id/);return{rows:failAt===1?[]:[{content:'My answer'}]};}
      if(calls===2){assert.match(sql,/owner_id = \$1/);return{rows:[]};}
      assert.fail('must not write');
    }}));
    assert.equal(result.error,failAt===1?'memo_not_found':'contact_not_found');
    assert.equal(calls,failAt);
  }
});
test('retries preserve the original boost date and other profile context',async()=>{
  const savedAt='2026-10-01T00:00:00.000Z';let calls=0;
  const result=await saveOnboardingContext(owner,input,fn=>fn({query:async(sql,args)=>{
    calls++;
    if(calls===1)return{rows:[{content:'answer'}]};
    if(calls===2)return{rows:[{id:contact}]};
    if(calls===3){assert.match(sql,/FOR UPDATE/);return{rows:[{context:{memoId,contactIds:[contact],priorities:['professional'],savedAt}}]};}
    assert.match(sql,/jsonb_set/);assert.match(sql,/COALESCE\(profile_extra->'onboardingVoice'/);
    const value=JSON.parse(args[2]);assert.equal(value.savedAt,savedAt);
    return{rows:[{context:{priorities:value,family:{memoId:'preserved'}}}]};
  }}));
  assert.equal(result.context.family.memoId,'preserved');
});
