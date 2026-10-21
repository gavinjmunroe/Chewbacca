import test from 'node:test';
import assert from 'node:assert/strict';
import {exaDiscovery,searchExcerpt} from './exa-discovery.js';
test('Exa retrieval is bounded, deduplicated, with no unsafe or non-person links',async()=>{
 process.env.EXA_API_KEY='test';
 const result=await exaDiscovery({scope:'people',query:'Example engineer'},async(url,init)=>{
 const body=JSON.parse(init.body);assert.equal(body.numResults,10);assert.equal(body.category,'people');assert.equal(body.type,'fast');assert.equal(body.outputSchema,undefined);
 return Response.json({results:[{url:'https://www.linkedin.com/in/example/',title:'Example Person - Engineer | LinkedIn'},{url:'https://www.linkedin.com/in/example/?tracking=x',title:'Duplicate'}, {url:'https://example.com',title:'Not a person'}, {url:'https://secret@linkedin.com/in/x',title:'Unsafe'}]});
 });assert.equal(result.results.length,1);assert.equal(result.provider,'exa');assert.equal(result.results[0].kind,'person');assert.equal(result.results[0].name,'Example Person');
});
test('provider failure cannot masquerade as empty successful search',async()=>{
 process.env.EXA_API_KEY='test';let calls=0;
 await assert.rejects(exaDiscovery({scope:'plans',query:'cafes',location:'Chicago'},async()=>{calls++;return new Response('',{status:429});}),/search_quota/);assert.equal(calls,1);
});

test('search snippets do not leak raw Markdown or duplicate the name',()=>{assert.equal(searchExcerpt('# Example Person\n\n**Engineer** at [Example](https://example.com)\n500 connections • 100 followers\n## About\nBuilds things','Example Person'),'Engineer at Example · Builds things');});

test('Plans presets places and requires source-backed local addresses, not dates or generic pages',async()=>{
 process.env.EXA_API_KEY='test';
 const place={name:'Corner Cafe',url:'https://example.org/cafe?id=1',city:'Chicago',region:'IL',country:'US',address:'10 Main St, Chicago',summary:'Coffee and pastries'};
 const result=await exaDiscovery({scope:'plans',query:'cafes',location:'Chicago, IL'},async(_,init)=>{
  const body=JSON.parse(init.body);assert.equal(body.category,'places');assert.equal(body.type,'fast');assert.equal(body.numResults,10);
  assert.equal(body.outputSchema.properties.places.maxItems,10);assert.match(body.query,/Chicago, IL/);
  return Response.json({results:[{url:place.url}],output:{content:{places:[place,place,{...place,city:'Boston'}, {...place,region:'MA'}, {...place,url:'https://invented.org'}, {...place,address:''},null]}}});
 });
 assert.equal(result.results.length,1);assert.equal(result.resultType,'places');assert.equal(result.results[0].kind,'place');
 assert.equal(result.results[0].url,place.url);assert.equal(result.results[0].startsAt,undefined);assert.equal(result.people,undefined);
});
test('places never silently falls back to untyped webpages if synthesis fails',async()=>{
 process.env.EXA_API_KEY='test';
 await assert.rejects(exaDiscovery({scope:'plans',query:'cafes',location:'Chicago'},async()=>Response.json({results:[{url:'https://example.org',title:'Ten cafes'}]})),/search_unavailable/);
 await assert.rejects(exaDiscovery({scope:'plans',query:'cafes'},()=>assert.fail()),/location_required/);
});
