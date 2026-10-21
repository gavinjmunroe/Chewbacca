import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeClayFields,applyClayFields} from './clay-contact-fields.js';
test('enrichment preserves existing details, primary phone and unrelated metadata',()=>{
 const row={emails:'old@example.com',phones_all:'+12025550100',phone_primary:'+12025550100',enrichment:{notes:'Keep this'},linkedin_url:'https://linkedin.com/in/example'};
 const next=mergeClayFields(row,{workEmail:'new@example.com',phone:'+12025550200'});
 assert.equal(next.emails,'old@example.com, new@example.com');assert.equal(next.phone,row.phone_primary);assert.equal(next.enrichment.notes,'Keep this');
 assert.deepEqual(mergeClayFields({...row,emails:next.emails},{workEmail:'new@example.com'}).emails,next.emails);
 assert.throws(()=>mergeClayFields(row,{linkedin:'https://linkedin.com/in/another'}),/contact_conflict/);
});
test('cannot apply a pending job, another contact result, or another owner contact',async()=>{
 const job={kind:'enrich',status:'complete',input:{contactId:'c'},output:{fields:{workEmail:'x@example.com'}}};
 await assert.rejects(applyClayFields('o','other',job),/contact_conflict/);
 await assert.rejects(applyClayFields('o','c',{...job,status:'processing'}),/contact_conflict/);
 let reads=0;
 await assert.rejects(applyClayFields('owner','c',job,async fn=>fn({query:async(sql,args)=>{reads++;assert.match(sql,/owner_id=\$1/);assert.deepEqual(args,['owner','c']);return {rows:[]};}})),/contact_conflict/);
 assert.equal(reads,1);
});

test('equivalent phone and email formats are idempotent and keep saved formatting',()=>{
 const row={emails:'Person@Example.com',phones_all:'+1 (202) 555-0100',phone_primary:'+1 (202) 555-0100',enrichment:{}};
 const next=mergeClayFields(row,{workEmail:'person@example.com',phone:'2025550100'});
 assert.equal(next.emails,row.emails);assert.equal(next.phones,row.phones_all);
});
