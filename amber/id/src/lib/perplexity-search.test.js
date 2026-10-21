import test from 'node:test';
import assert from 'node:assert/strict';
import { searchResults, perplexitySearch, perplexityKey } from './perplexity-search.js';
const now = Date.parse('2026-10-06T12:00:00Z');
const person = {kind:'person',name:'Maya Chen',title:'Engineer',company:'Acme',location:'Chicago',summary:'Climate software',url:'https://www.linkedin.com/in/maya'};
const event = {kind:'event',name:'Evening concert',url:'https://events.example.org/concert',city:'Chicago',region:'IL',country:'US',venue:'Music Hall',date:'2026-10-08',startsAt:'2026-10-08T19:00:00-05:00',endsAt:null,timezone:'America/Chicago',summary:'Live music'};
function response(rows, sources=rows) { return {status:'completed',output:[{results:sources.map(r=>({url:r.url}))},{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({results:rows})}]}]}; }
test('people are source-backed individuals, deduplicated and capped at ten',()=>{
  const rows=[person,person,{...person,url:'https://linkedin.com/company/acme'},event,{...person,url:'https://linkedin.com.evil.org/in/fake'},...Array.from({length:20},(_,i)=>({...person,url:`https://linkedin.com/in/person-${i}`}))];
  const result=searchResults(response(rows),{scope:'people'},now);
  assert.equal(result.length,10); assert.equal(result[0].name,'Maya Chen');
  assert.equal(result[0].email,undefined); assert.equal(result[0].phone,undefined);
  assert.deepEqual(searchResults(response([person],[]),{scope:'people'},now),[]);
  assert.deepEqual(searchResults(response([{...person,kind:'event'}]),{scope:'people'},now),[]);
});
test('events reject wrong cities, articles, stale dates, fabricated times and private URLs',()=>{
  const rows=[event,event,person,{...event,city:'Boston'}, {...event,region:'MA'}, {...event,date:'2026-02-30'},
    {...event,date:'2025-10-08'}, {...event,startsAt:'2026-10-08T19:00:00'},
    {...event,startsAt:'2026-10-09T19:00:00Z'}, {...event,timezone:'Mars'},
    {...event,endsAt:'2026-10-08T18:00:00-05:00'}, {...event,url:'https://127.0.0.1/event'},
    {...event,date:undefined}, {...event,kind:'article'}, {...event,venue:''}];
  const results=searchResults(response(rows),{scope:'plans',location:'Chicago, IL'},now);
  assert.equal(results.length,1); assert.equal(results[0].startsAt,'2026-10-09T00:00:00.000Z');
  const undatedTime={...event,startsAt:null,endsAt:null};
  assert.equal(searchResults(response([undatedTime]),{scope:'plans',location:'Chicago'},now)[0].startsAt,null);
});
test('malformed or incomplete model responses fail closed',()=>{
  assert.throws(()=>searchResults({results:[person]},{scope:'people'}),/search_unavailable/);
  assert.throws(()=>searchResults({...response([person]),status:'incomplete'},{scope:'people'}),/search_unavailable/);
  assert.throws(()=>searchResults({status:'completed',output:[]},{scope:'people'}),/search_unavailable/);
});
test('uses Perplexity Agent structured schemas with no fallback or implicit retry',async()=>{
  const before=process.env.PERPLEXITY_API_KEY;
  process.env.PERPLEXITY_API_KEY='  pplx-fixture  ';
  let calls=0;
  try {
    const data=await perplexitySearch({scope:'people',query:'climate engineers'},async(url,options)=>{
      calls++; assert.equal(url,'https://api.perplexity.ai/v1/agent');
      assert.equal(options.headers.Authorization,'Bearer pplx-fixture');
      const body=JSON.parse(options.body);
      assert.equal(body.response_format.json_schema.schema.properties.results.maxItems,10);
      assert.equal(body.response_format.json_schema.name,'AmberPeople');
      assert.equal(body.tools[0].max_results,10);
      assert.match(body.instructions,/No emails or phone/);
      return {ok:true,json:async()=>response([person])};
    });
    assert.equal(data.people.length,1); assert.equal(calls,1);
    await assert.rejects(perplexitySearch({scope:'plans',query:'concerts'},()=>assert.fail()),/location_required/);
    await assert.rejects(perplexitySearch({scope:'plans',query:'concerts',location:'Chicago'},async(_,options)=>{
      calls++;const body=JSON.parse(options.body);assert.equal(body.tools[0].user_location.city,'Chicago');
      return {ok:false,status:429};
    }),/search_quota/);
    assert.equal(calls,2);
    for (const invalid of ['', 'Bearer pplx-key', '"pplx-key"', 'pplx key']) {
      process.env.PERPLEXITY_API_KEY=invalid;assert.throws(perplexityKey,/not_configured/);
    }
  } finally { if(before===undefined)delete process.env.PERPLEXITY_API_KEY;else process.env.PERPLEXITY_API_KEY=before; }
});
