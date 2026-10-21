import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerContactNoteRoutes } from './contact-notes.js';
import { registerScheduleRoutes } from './schedule.js';
import { registerJournalRoutes } from './journal.js';
import { memoActionResourceId } from '../db/memo-action-store.js';
const owner = '11111111-1111-4111-8111-111111111111';
const contact = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const auth = async req => { req.privyUser = {userId:'did:amber:fixture',phone:'+12025550101'}; };
const deps = { requireAuth:auth,resolveAmberIdByPhone:async()=>owner };

test('stable action identities separate owners and destinations',()=>{
 const first=memoActionResourceId(owner,'contact',requestId);
 assert.equal(memoActionResourceId(owner,'contact',requestId),first);
 assert.notEqual(memoActionResourceId(contact,'contact',requestId),first);
 assert.notEqual(memoActionResourceId(owner,'calendar',requestId),first);
 assert.throws(()=>memoActionResourceId(owner,'contact','bad'));
});
test('contact note acknowledges durable write while slow extraction continues; replay skips extraction',async()=>{
 const app=Fastify();let captures=0,saves=0,finish;
 const blocked=new Promise(resolve=>{finish=resolve;});
 registerContactNoteRoutes(app,{...deps,getContactById:async()=>({id:contact,name:'Fixture'}),
   saveMemoContactNote:async args=>{assert.equal(args.ownerId,owner);assert.equal(args.requestId,requestId);return {noteId:'fixture-note',replayed:saves++>0};},
   captureFromMessage:async()=>{captures++;await blocked;return {status:'captured'};},reembedContactSoon:()=>{},getFactsForContact:async()=>[]});
 try{
  const req={method:'POST',url:`/v1/me/contacts/${contact}/note`,payload:{text:'Likes morning walks.',requestId}};
  const first=await app.inject(req);assert.equal(first.statusCode,200);assert.equal(first.json().status,'processing');
  const replay=await app.inject(req);assert.equal(replay.json().replayed,true);assert.equal(captures,1);
 }finally{finish();await app.close();}
});
test('contact action conflict and invalid request identity never claim a save',async()=>{
 const app=Fastify(); registerContactNoteRoutes(app,{...deps,getContactById:async()=>({id:contact}),saveMemoContactNote:async()=>{throw Error('memo_action_conflict');}});
 try{
  const send=payload=>app.inject({method:'POST',url:`/v1/me/contacts/${contact}/note`,payload});
  assert.equal((await send({text:'Fixture',requestId})).statusCode,409);
  assert.equal((await send({text:'Fixture',requestId:'invalid'})).statusCode,400);
 }finally{await app.close();}
});
test('calendar passes stable request ID and surfaces safe replay versus conflict',async()=>{
 const app=Fastify();let conflict=false;
 registerScheduleRoutes(app,{...deps,createScheduledEvent:async args=>{assert.equal(args.ownerId,owner);assert.equal(args.requestId,requestId);if(conflict)throw Error('memo_action_conflict');return {eventId:'fixture-event',replayed:true};}});
 try{
  const req={method:'POST',url:'/v1/me/calendar-events',payload:{title:'Fixture',startsAt:'2026-09-24T10:00:00Z',requestId}};
  const replay=await app.inject(req);assert.equal(replay.statusCode,200);assert.equal(replay.json().replayed,true);
  conflict=true;assert.equal((await app.inject(req)).statusCode,409);
 }finally{await app.close();}
});
test('journal corrections are authenticated, owner scoped, bounded and distinguish conflict from absence',async()=>{
 const app=Fastify();let result={ok:true,conversationId:requestId,text:'Corrected'};
 registerJournalRoutes(app,{requireAuth:auth,resolveOwner:async()=>owner,correct:async(actual,args)=>{assert.equal(actual,owner);assert.equal(args.previousText,'Original');return result;}});
 try{
  const req={method:'PATCH',url:`/v1/me/journal/${requestId}`,payload:{text:'Corrected',previousText:'Original'}};
  assert.equal((await app.inject(req)).statusCode,200);
  result={ok:false,error:'memo_conflict'};assert.equal((await app.inject(req)).statusCode,409);
  result={ok:false,error:'memo_not_found'};assert.equal((await app.inject(req)).statusCode,404);
  assert.equal((await app.inject({...req,payload:{...req.payload,text:'x'.repeat(32001)}})).statusCode,400);
 }finally{await app.close();}
 const unauth=Fastify();registerJournalRoutes(unauth,{requireAuth:async()=>{},correct:()=>assert.fail('must not write')});
 try{assert.equal((await unauth.inject({method:'PATCH',url:`/v1/me/journal/${requestId}`,payload:{text:'Corrected',previousText:'Original'}})).statusCode,401);}finally{await unauth.close();}
});
