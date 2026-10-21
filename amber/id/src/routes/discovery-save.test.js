import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {registerDiscoverySave,linkDiscoveryProfile} from './discovery-save.js';
const id='11111111-1111-4111-8111-111111111111';
test('saving a search result is owned, repeatable and does not overwrite a conflicting profile',async()=>{
 const app=Fastify();let merges=0;let links=0;let conflict=false;
 registerDiscoverySave(app,{target:async()=>null,auth:async r=>{r.privyUser={phone:r.headers.authorization};},resolve:async p=>p,
 get:async owner=>owner==='a'?{kind:'search',status:'complete',input:{scope:'people'},output:{provider:'exa',people:[{id:'p',name:'Person',linkedin:'https://linkedin.com/in/person'}]}}:null,
 merge:async(owner,record)=>{assert.equal(owner,'a');assert.equal(record.externalId,'https://linkedin.com/in/person');merges++;return {contactId:'same-contact'};},
 web:async()=>conflict?{linkedin_url:'https://linkedin.com/in/other'}:null,
 link:async()=>{links++;return {ok:true};}});
 const save=owner=>app.inject({method:'POST',url:`/v1/me/discovery/jobs/${id}/people/p/save`,headers:{authorization:owner}});
 try{assert.equal((await save('b')).statusCode,404);assert.equal(merges,0);
 assert.equal((await save('a')).json().contactId,'same-contact');assert.equal((await save('a')).json().contactId,'same-contact');
 conflict=true;assert.equal((await save('a')).statusCode,409);assert.equal(links,2);
 }finally{await app.close();}
});

test('explicit Apple card reuses owner-scoped contact and never creates a duplicate',async()=>{
 const app=Fastify();let target='existing';let creates=0;let sources=0;
 registerDiscoverySave(app,{auth:async r=>{r.privyUser={phone:'a'};},resolve:async()=> 'owner',
 get:async()=>({kind:'search',status:'complete',input:{scope:'people'},output:{people:[{id:'p',name:'Person',linkedin:'https://linkedin.com/in/person'}]}}),
 target:async(owner,person,apple)=>{assert.equal(owner,'owner');assert.equal(apple,'apple-card');return target;},
 merge:async()=>{creates++;return null;},web:async()=>({linkedin_url:'https://www.linkedin.com/in/person/'}),link:async()=>true,source:async()=>{sources++;}});
 const save=()=>app.inject({method:'POST',url:`/v1/me/discovery/jobs/${id}/people/p/save`,payload:{appleExternalId:'apple-card'}});
 try {assert.equal((await save()).json().contactId,'existing');assert.equal(sources,1);target=null;assert.equal((await save()).statusCode,409);assert.equal(creates,0);}finally{await app.close();}
});

test('profile writes atomically preserve a concurrently changed LinkedIn value',async()=>{let called=0;const r=await linkDiscoveryProfile('owner','contact',{linkedin_url:'https://linkedin.com/in/person'},async(sql,args)=>{called++;assert.match(sql,/owner_id=\$2/);assert.match(sql,/linkedin_url IS NULL/);assert.match(sql,/ELSE linkedin_url END/);assert.deepEqual(args,['contact','owner','https://linkedin.com/in/person','/in/person']);return{rows:[]};});assert.equal(called,1);assert.equal(r,null);});
