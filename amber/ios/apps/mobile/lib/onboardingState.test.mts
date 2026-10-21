import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
const loader = `export async function resolve(s,c,n){
 if(c.parentURL?.endsWith('/onboardingState.ts') && s==='./api') return {url:'data:text/javascript,'+encodeURIComponent('export const api={me:()=>globalThis.__me()}; export function unwrapSingle(r){return r.ok ? (r.data?.data ?? r.data) : null;}'),shortCircuit:true};
 return n(s,c);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);
const { isOnboardingComplete, profileCompletedOnboarding } = await import('./onboardingState.ts');
const { clearSession, hasOnboarded } = await import('./secureStorage.ts');
const state = globalThis as any;
test('server completion persists through logout and subsequent sign-in', async () => {
  await clearSession();
  state.__me = async () => ({ok:true,data:{id:'returning',onboardingCompletedAt:'2026-10-01T10:00:00Z'}});
  assert.equal(await isOnboardingComplete(), true);
  assert.equal(await hasOnboarded(), true);
  await clearSession();
  assert.equal(await isOnboardingComplete(), true);
});
test('switching to an unfinished account does not inherit completion or treat a name as completed', async () => {
  await clearSession();
  state.__me = async () => ({ok:true,data:{id:'new',displayName:'New Person',onboardingCompletedAt:null}});
  assert.equal(await isOnboardingComplete(), false);
});
test('profile transport errors do not restart onboarding or persist a guessed completion', async () => {
  await clearSession();
  state.__me = async () => ({ok:false,error:'timeout'});
  assert.equal(await isOnboardingComplete(), true);
  assert.equal(await hasOnboarded(), false);
});
test('legacy profile compatibility requires a name; modern profiles require completion', () => {
  assert.equal(profileCompletedOnboarding({id:'old',displayName:'Known Person'}), true);
  assert.equal(profileCompletedOnboarding({id:'new'}), false);
  assert.equal(profileCompletedOnboarding({id:'new',displayName:'Known Person',onboardingCompletedAt:null}), false);
});
