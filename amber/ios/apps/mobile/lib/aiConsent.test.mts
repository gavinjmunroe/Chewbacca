import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
const loader=`
export async function resolve(s,c,n){
 if(c.parentURL?.endsWith('/aiConsent.ts')&&s==='./secureStorage')return{url:'data:text/javascript,export const loadSession=async()=>globalThis.__consentSession;',shortCircuit:true};
 if(c.parentURL?.endsWith('/aiConsent.ts')&&s==='./config')return{url:'data:text/javascript,export const privacyPolicyUrl="https://example.org/privacy";',shortCircuit:true};
 return n(s,c);
}`;
register('data:text/javascript,'+encodeURIComponent(loader),import.meta.url);
const {ensureProcessingConsent,revokeProcessingConsent}=await import('./aiConsent.ts');
const {consentForRequest}=await import('./aiConsentPolicy.ts');
const {Alert}=await import('react-native');
const state=globalThis as any;
test('explicit consent is account scoped, revocable and fails closed',async()=>{
 state.__consentSession={phone:'account-a'};
 let prompts=0;
 Alert.alert=(_title:any,_message:any,buttons:any)=>{prompts++;buttons.find((b:any)=>b.text==='Not now').onPress();};
 assert.equal(await ensureProcessingConsent('ai'),false);
 Alert.alert=(_title:any,_message:any,buttons:any)=>{prompts++;buttons.find((b:any)=>b.text==='Allow').onPress();};
 assert.equal(await ensureProcessingConsent('ai'),true);
 assert.equal(await ensureProcessingConsent('ai'),true);assert.equal(prompts,2);
 state.__consentSession={phone:'account-b'};
 assert.equal(await ensureProcessingConsent('ai'),true);assert.equal(prompts,3);
 await revokeProcessingConsent();
 assert.equal(await ensureProcessingConsent('ai'),true);assert.equal(prompts,4);
 state.__consentSession=null;assert.equal(await ensureProcessingConsent('ai'),false);
});
test('account changes or revocation while the dialog is open cannot authorize processing',async()=>{
 state.__consentSession={phone:'race-a'};
 Alert.alert=(_t:any,_m:any,b:any)=>{state.__consentSession={phone:'race-b'};b.find((x:any)=>x.text==='Allow').onPress();};
 assert.equal(await ensureProcessingConsent('research'),false);
 Alert.alert=(_t:any,_m:any,b:any)=>{void revokeProcessingConsent().then(()=>b.find((x:any)=>x.text==='Allow').onPress());};
 assert.equal(await ensureProcessingConsent('research'),false);
 const c=new AbortController();c.abort();assert.equal(await ensureProcessingConsent('research',c.signal),false);
});
test('local/history requests stay ungated while model, web, and enrichment writes require the right disclosure',()=>{
 assert.equal(consentForRequest('/v1/me/journal/id','PUT'),null);
 assert.equal(consentForRequest('/v1/me/contacts','GET'),null);
 assert.equal(consentForRequest('/v1/voice/transcribe','POST'),'ai');
 assert.equal(consentForRequest('/v1/me/discovery/search','POST'),'research');
 assert.equal(consentForRequest('/v1/me/clay/lookup','POST'),'enrichment');
});
