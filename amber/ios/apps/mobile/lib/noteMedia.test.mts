import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const mobile = new URL('../', import.meta.url).pathname;
const stub = `export const callMedhaId=(...args)=>globalThis.__audioCall(...args);`;
const loader = `export async function resolve(specifier,context,next){
 if(context.parentURL?.endsWith('/noteMedia.ts') && specifier==='./medhaId')
 return {url:'data:text/javascript,'+encodeURIComponent(${JSON.stringify(stub)}),shortCircuit:true};
 return next(specifier,context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);
const { uploadAudioSequence } = await import(pathToFileURL(`${mobile}/lib/noteMedia.ts`).href);
const globals = globalThis as any;
const fetchBefore = globalThis.fetch;
const base = '/v1/me/notes/11111111-1111-4111-8111-111111111111/audio';
const ticket = { uploadUrl: 'https://storage.example.test/signed', contentType: 'audio/mp4', maxBytes: 100, maxDurationMs: 300000 };
const meta = { durationMs: 1250, peaks: [0, 20, 95] };

function setup({ticketOk=true, readOk=true, putOk=true, finalizeOk=true, size=3}={}) {
 const order: string[] = [];
 globals.__audioCall = async (args:any) => {
   assert.equal(args.requireAuth, true);
   if(args.path.endsWith('/upload-url')) { order.push('ticket'); return {ok:ticketOk, data:ticket}; }
   order.push('finalize'); assert.equal(args.path,base); assert.deepEqual(args.body,meta);
   return {ok:finalizeOk, data:{ok:finalizeOk,byteSize:size}};
 };
 globalThis.fetch = (async (input:any, init:any) => {
   if(input.startsWith('file:')) { order.push('read'); if(!readOk)throw Error('evicted file'); return new Response(new Blob([new Uint8Array(size)], {type:'wrong/local-type'})); }
   order.push('put'); assert.equal(input,ticket.uploadUrl); assert.equal(init.method,'PUT');
   assert.equal(init.headers['content-type'],ticket.contentType); assert.equal(init.body.type,ticket.contentType);
   return new Response('', {status:putOk?200:503});
 }) as typeof fetch;
 return order;
}
test.afterEach(()=> {globalThis.fetch=fetchBefore; delete globals.__audioCall;});

test('cloud audio uses authenticated ticket then signed upload then acknowledged finalize',async()=>{
 const order=setup(); const out=await uploadAudioSequence(base,'file:///recording.m4a',meta);
 assert.equal(out?.ok,true); assert.deepEqual(order,['ticket','read','put','finalize']);
});
test('failed ticket never reads or uploads private audio',async()=>{
 const order=setup({ticketOk:false}); assert.equal(await uploadAudioSequence(base,'file:///recording.m4a',meta),null);
 assert.deepEqual(order,['ticket']);
});
test('missing file and oversized audio never PUT or finalize',async()=>{
 for(const options of [{readOk:false},{size:101}]){
   const order=setup(options); assert.equal(await uploadAudioSequence(base,'file:///recording.m4a',meta),null);
   assert.deepEqual(order,['ticket','read']);
 }
});
test('failed storage upload never finalizes a nonexistent recording',async()=>{
 const order=setup({putOk:false}); assert.equal(await uploadAudioSequence(base,'file:///recording.m4a',meta),null);
 assert.deepEqual(order,['ticket','read','put']);
});
test('finalization failure is recoverable and never reports audio saved',async()=>{
 const order=setup({finalizeOk:false}); assert.equal(await uploadAudioSequence(base,'file:///recording.m4a',meta),null);
 assert.deepEqual(order,['ticket','read','put','finalize']);
 setup(); assert.equal((await uploadAudioSequence(base,'file:///recording.m4a',meta))?.ok,true);
});

test('empty or over-duration recordings are not silently accepted or shortened',async()=>{
 const empty=setup({size:0}); assert.equal(await uploadAudioSequence(base,'file:///recording.m4a',meta),null);
 assert.deepEqual(empty,['ticket','read']);
 const order=setup(); assert.equal(await uploadAudioSequence(base,'file:///recording.m4a',{...meta,durationMs:300001}),null);
 assert.deepEqual(order,['ticket','read']);
});
test('explicit failed finalization in an HTTP success is not a confirmed audio save',async()=>{
 setup(); globals.__audioCall=async(args:any)=>({ok:true,data:args.path.endsWith('/upload-url')?ticket:{ok:false}});
 assert.equal(await uploadAudioSequence(base,'file:///recording.m4a',meta),null);
});
