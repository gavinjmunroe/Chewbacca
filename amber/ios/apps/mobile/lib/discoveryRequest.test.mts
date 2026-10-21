import test from 'node:test';
import assert from 'node:assert/strict';
import {runDiscovery, discoveryFingerprint, type DiscoveryCall, validDiscoveryResult} from './discoveryRequest.ts';
const input={query:'cafes',scope:'plans' as const,location:'Chicago'};
test('timeout resumes the same job with GET, never duplicates the paid POST',async()=>{
  const calls:any[]=[];
  const responses=[{ok:false,status:0},{ok:true,data:{id:'id',status:'pending'}},{ok:true,data:{id:'id',status:'complete',scope:'plans',results:[{id:'place',kind:'place',name:'Cafe',url:'https://example.org/cafe',city:'Chicago',address:'10 Main St, Chicago'}]}}];
  const call:DiscoveryCall=async(options)=>{calls.push(options);return responses.shift() as any;};
  const job=await runDiscovery(input,{id:'id',resume:false,signal:new AbortController().signal},call,async()=>{});
  assert.equal(job.results?.length,1);
  assert.deepEqual(calls.map(c=>c.method),['POST','GET','GET']);
  assert.equal(calls[1].path,'/v1/me/discovery/jobs/id');
});
test('wrong-scope responses cannot reach the screen',async()=>{
  const call:DiscoveryCall=async()=>({ok:true,data:{id:'id',status:'complete',scope:'people',results:[]}} as any);
  await assert.rejects(runDiscovery(input,{id:'id',resume:false,signal:new AbortController().signal},call),/wrong type/);
});
test('cancelled requests discard even successful late responses',async()=>{
  const controller=new AbortController();
  const call:DiscoveryCall=async()=>{controller.abort();return {ok:true,data:{id:'id',status:'complete',scope:'plans',results:[]}} as any;};
  await assert.rejects(runDiscovery(input,{id:'id',resume:false,signal:controller.signal},call),/aborted/);
});
test('scope and locality are part of identity, so one city cannot reuse another',()=>{
  assert.notEqual(discoveryFingerprint(input),discoveryFingerprint({...input,location:'Boston'}));
  assert.notEqual(discoveryFingerprint(input),discoveryFingerprint({...input,scope:'people'}));
  assert.equal(discoveryFingerprint(input),discoveryFingerprint({...input,query:' cafes '}));
});
test('terminal quota error does not poll or retry; pending has a bounded recovery window',async()=>{
  let calls=0;
  const fail:DiscoveryCall=async()=>{calls++;return {ok:false,status:429,message:'Allowance reached'};};
  await assert.rejects(runDiscovery(input,{id:'id',resume:false,signal:new AbortController().signal},fail),/Allowance/);
  assert.equal(calls,1);calls=0;
  const pending:DiscoveryCall=async()=>{calls++;return {ok:true,data:{id:'id',status:'pending'}} as any;};
  await assert.rejects(runDiscovery(input,{id:'id',resume:true,signal:new AbortController().signal},pending,async()=>{}),/longer than expected/);
  assert.equal(calls,13);
});

test('Plans rejects generic webpages and events instead of treating them as places',()=>{
  assert.equal(validDiscoveryResult('plans',{id:'x',name:'Events',url:'https://example.org'}),false);
  assert.equal(validDiscoveryResult('plans',{id:'x',kind:'event',name:'Concert',url:'https://example.org',date:'2026-10-08',startsAt:null,timezone:'Mars',city:'Chicago',venue:'Hall'}),false);
});
