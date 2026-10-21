import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichmentRequest,enrichmentResult,safeLinkedIn} from './clay-public.js';
const person={name:'Example Person',company:'Example',companyDomain:'example.com',linkedin:'https://linkedin.com/in/example'};
test('four actions select distinct routines and return only the requested field',()=>{
 const cases=[['work_email','Work Email','person@example.com','workEmail'],['personal_email','Personal Email','home@example.com','personalEmail'],['mobile_phone','Mobile Phone','+1 (202) 555-0123','phone'],['linkedin','LinkedIn URL',person.linkedin,'linkedin']];
 assert.equal(new Set(cases.map(([action])=>enrichmentRequest(person,action).routine)).size,4);
 for(const [action,key,value,field] of cases){const r=enrichmentResult(action,{[key]:value,'Work Email':'person@example.com','Personal Email':'home@example.com'});assert.deepEqual(Object.keys(r),[field]);assert.ok(r[field]);}
 assert.equal(enrichmentResult('mobile_phone',{'Mobile Phone':'+1 (202) 555-0123'}).phone,'+12025550123');
});
test('missing identity inputs fail before a paid request; malformed outputs never become fields',()=>{
 assert.throws(()=>enrichmentRequest({name:'Jonah Graham'},'linkedin'),/missing/);
 assert.throws(()=>enrichmentRequest({...person,linkedin:null},'personal_email'),/missing/);
 assert.throws(()=>enrichmentRequest({...person,companyDomain:''},'work_email'),/missing/);
 assert.deepEqual(enrichmentResult('work_email',{'Work Email':'Not found'}),{workEmail:''});
 assert.deepEqual(enrichmentResult('mobile_phone',{'Mobile Phone':'5551234'}),{phone:''});
 assert.equal(safeLinkedIn('https://password@linkedin.com/in/person'),null);
 assert.equal(safeLinkedIn('https://linkedin.com/in/'),null);
 assert.throws(()=>enrichmentResult('all',{}));
});
