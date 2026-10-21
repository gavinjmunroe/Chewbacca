import test from 'node:test';
import assert from 'node:assert/strict';
import { pollEnrichment } from './clay-search.js';
const url='https://linkedin.com/in/example';
const original={id:'job',kind:'enrich',status:'processing',input:{action:'work_email'},output:{stage:'profile',runId:'profile-run',context:{name:'Example Person',linkedin:url}}};
const profile={'Enrich person':{url,name:'Example Person',experience:[{company:'Former',company_domain:'old.com',is_current:false},{company:'Current',company_domain:'current.com',is_current:true}]}};
test('concurrent profile polling dispatches one paid lookup using the current employer',async()=>{
 let job=structuredClone(original),dispatches=0;
 const deps={
  call:async(path,body)=>{
   if(!body) return {status:'complete',data:[{id:'job',status:'complete',result:profile}]};
   dispatches++;assert.equal(body.items[0].inputs['Company Domain'],'current.com');
   return {routine_run_id:'work-run'};
  },
  query:async(sql,args)=>{assert.match(sql,/owner_id=\$1/);assert.equal(args[0],'owner');if(job.output.stage!=='profile')return {rows:[]};job={...job,output:{...job.output,...JSON.parse(args[2])}};return {rows:[job]};},
  update:async(owner,id,changes)=>{assert.equal(owner,'owner');job={...job,...changes};return job;},get:async()=>job,
 };
 await Promise.all([pollEnrichment('owner',original,deps),pollEnrichment('owner',original,deps)]);
 assert.equal(dispatches,1);assert.equal(job.output.runId,'work-run');assert.equal(job.output.profile.company,'Current');
});
test('mismatched profile never starts the email lookup',async()=>{
 let dispatches=0;
 const result=await pollEnrichment('owner',original,{call:async(path,body)=>{if(body)dispatches++;return {status:'complete',data:[{id:'job',status:'complete',result:{'Enrich person':{...profile['Enrich person'],url:'https://linkedin.com/in/other'}}}]};},update:async(o,i,changes)=>changes});
 assert.equal(dispatches,0);assert.equal(result.status,'error');assert.equal(result.output.error,'profile_mismatch');
});
test('a completed empty lookup is not a fabricated email',async()=>{
 const result=await pollEnrichment('owner',{...original,output:{stage:'lookup',runId:'work',profile:{company:'Current'}}},{call:async()=>({status:'complete',data:[{id:'job',status:'complete',result:{}}]}),update:async(o,i,c)=>c});
 assert.equal(result.status,'complete');assert.equal(result.output.fields.workEmail,'');assert.equal(result.output.profile.company,'Current');
});
test('uncertain second dispatch is terminal and never automatically retried',async()=>{
 let calls=0;
 const deps={call:async(path,body)=>{if(body){calls++;throw Error('timeout');}return {status:'complete',data:[{id:'job',status:'complete',result:profile}]};},query:async()=>({rows:[{}]}),update:async(o,i,c)=>({...original,...c})};
 const result=await pollEnrichment('owner',original,deps);assert.equal(result.status,'error');
 await pollEnrichment('owner',result,deps);assert.equal(calls,1);
});
