import test from 'node:test';
import assert from 'node:assert/strict';
import { compileClayFilter, planClaySearch } from './clay-query.js';
import { clayPublic, clayPerson, enrichmentRequest, enrichmentResult, safeLinkedIn } from './clay-public.js';
test('query compilation preserves current-role grouping and exclusions', () => {
  assert.equal(compileClayFilter({and:[{field:'location_city',op:'in',value:['San Francisco','Oakland']},{experience:{and:[{field:'job_title',op:'is_similar_to',value:['engineer']},{field:'is_current',op:'=',value:true}]}},{field:'full_name',op:'!=',value:'Example Person'}]}), '(location_city in ("San Francisco", "Oakland") and experiences.any((job_title is_similar_to ("engineer") and is_current = true)) and full_name != "Example Person")');
});
test('compiler rejects broad, unsupported, and injected filters', () => {
  for (const bad of [{and:[]},{field:'private_health',op:'=',value:'x'},{field:'full_name',op:'=',value:'x" or true'},{field:'full_name',op:'in',value:[]},{field:'is_current',op:'=',value:true}]) assert.throws(() => compileClayFilter(bad));
});
test('public API requests exactly one page and never retries an ambiguous write', async () => {
  process.env.CLAY_PUBLIC_API_KEY='test-key';
  let calls=0;
  await assert.rejects(clayPublic('/search/query-mode/test/run',{limit:10},async (url,init) => {calls++;assert.equal(JSON.parse(init.body).limit,10);throw new Error('timeout');}));
  assert.equal(calls,1);
  delete process.env.CLAY_PUBLIC_API_KEY;
});
test('normalization keeps real names and safe links', () => {
  const p=clayPerson({clay_profile_id:7,first_name:'Example',last_name:'Person',linkedin_url:'https://www.linkedin.com/in/example',matched_experiences:[{title:'Engineer',company:'Example Co',end_date:null}],location:{name:'San Francisco'}});
  assert.equal(p.name,'Example Person');assert.equal(p.title,'Engineer');assert.equal(p.company,'Example Co');
  assert.equal(safeLinkedIn('https://linkedin.com.attacker.example/in/foo'),null);
  assert.equal(safeLinkedIn('javascript:alert(1)'),null);
});
test('individual enrichment cannot trigger combined paid routine', () => {
  const p={name:'Example Person',linkedin:'https://linkedin.com/in/example',company:'Example',companyDomain:'example.com'};
  assert.equal(enrichmentRequest(p,'email').routine,'function:t_0tivcdkDid9RmFBpp7k');
  assert.equal(enrichmentRequest(p,'phone').routine,'function:t_0tivcd9nsdpVHPknrm8');
  assert.throws(() => enrichmentRequest({...p,companyDomain:''},'email'));
  assert.deepEqual(enrichmentResult('email',{'Work Email':'person@example.com'}),{workEmail:'person@example.com'});
});

test('natural-language planning uses a typed tool contract, not free-form JSON text',async()=>{
 const plan=await planClaySearch('Engineers in San Francisco',async(_url,init)=>{
 const request=JSON.parse(init.body);assert.equal(request.tool_choice.name,'plan_people_search');
 return new Response(JSON.stringify({content:[{type:'tool_use',name:'plan_people_search',input:{description:'Engineers in San Francisco',filter:{field:'location_city',op:'=',value:'San Francisco'}}}]}));
 });assert.equal(plan.query,'select from people where location_city = "San Francisco"');
});
