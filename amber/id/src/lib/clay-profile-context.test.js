import test from 'node:test';
import assert from 'node:assert/strict';
import {clayProfileContext} from './clay-profile-context.js';
const url='https://linkedin.com/in/example';
const current={company:'Current',company_domain:'current.com',title:'Founder',is_current:true};
test('uses current employment instead of the first former employer',()=>{
 const result=clayProfileContext({'Enrich person':{url,name:'Example',experience:[{company:'Former',company_domain:'former.com',is_current:false},current]}},url);
 assert.equal(result.companyDomain,'current.com');assert.equal(result.company,'Current');
});
test('identity mismatch or ambiguous current employers never starts a work-email guess',()=>{
 assert.throws(()=>clayProfileContext({'Enrich person':{url:'https://linkedin.com/in/other'}},url),/profile_mismatch/);
 assert.throws(()=>clayProfileContext({'Enrich person':{url,experience:[current,{...current,company_domain:'other.com'}]}},url),/missing_enrichment_inputs/);
 assert.throws(()=>clayProfileContext({'Enrich person':{url,experience:[]}},url),/missing_enrichment_inputs/);
});
