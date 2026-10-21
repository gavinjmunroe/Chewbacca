import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerClaySearchRoutes } from './clay-search.js';
test('search, enrichment and polling all reject unauthenticated callers',async()=>{
 const app=Fastify();registerClaySearchRoutes(app);
 try {
 for(const request of [
  {method:'POST',url:'/v1/me/clay/search',payload:{requestId:'11111111-1111-4111-8111-111111111111',query:'engineers'}},
  {method:'POST',url:'/v1/me/clay/enrich',payload:{requestId:'11111111-1111-4111-8111-111111111111',searchId:'11111111-1111-4111-8111-111111111111',personId:'7',action:'phone'}},
  {method:'GET',url:'/v1/me/clay/jobs/11111111-1111-4111-8111-111111111111'}]){
 const res=await app.inject(request);assert.equal(res.statusCode,401);
 }
 }finally{await app.close();}
});
