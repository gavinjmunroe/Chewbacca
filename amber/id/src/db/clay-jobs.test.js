import test from 'node:test';
import assert from 'node:assert/strict';
import { getClayJob, reserveClayJob } from './clay-jobs.js';
test('job reads always bind the authenticated owner and job ID',async()=>{
 await getClayJob('owner','job',async(sql,args)=>{assert.match(sql,/owner_id=\$1 AND id=\$2/);assert.deepEqual(args,['owner','job']);return {rows:[]};});
});
test('duplicate request returns stored job without admitting another paid call',async()=>{
 let calls=0;
 const result=await reserveClayJob('owner',{id:'job',kind:'search',input:{query:'engineers'}},async fn=>fn({query:async(sql,args)=>{
 calls++;if(calls===1){assert.match(sql,/pg_advisory_xact_lock/);return {rows:[]};}
 assert.deepEqual(args,['owner','job']);return {rows:[{id:'job',status:'pending'}]};
 }}));
 assert.equal(result.created,false);assert.equal(calls,2);
});
test('global and owner quota both fail closed before insert',async()=>{
 for(const count of [{total:100,owned:1},{total:20,owned:20}]){
 let calls=0;
 await assert.rejects(reserveClayJob('owner',{id:'job',kind:'enrich',input:{}},async fn=>fn({query:async()=>{calls++;return {rows:calls===3?[count]:[]};}})),/clay_quota/);
 assert.equal(calls,3);
 }
});
test('reservation inserts only after serialized quota admission',async()=>{
 let calls=0;
 const result=await reserveClayJob('owner',{id:'job',kind:'search',input:{query:'engineers'}},async fn=>fn({query:async(sql,args)=>{
 calls++;if(calls<3)return {rows:[]};if(calls===3)return {rows:[{total:2,owned:1}]};
 assert.match(sql,/INSERT INTO clay_jobs/);assert.deepEqual(args,['owner','job','search','{"query":"engineers"}']);return {rows:[{id:'job'}]};
 }}));assert.equal(result.created,true);
});
