import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
const loader = `export async function resolve(specifier,context,next){
 if(context.parentURL?.endsWith('/manualContact.ts') && specifier==='./medhaId') return {url:'data:text/javascript,'+encodeURIComponent('export const callMedhaId=(args)=>globalThis.__manualCall(args);'),shortCircuit:true};
 if(context.parentURL?.endsWith('/manualContact.ts') && specifier==='./network') return {url:'data:text/javascript,'+encodeURIComponent('export const bustContactsCache=()=>globalThis.__manualBust();'),shortCircuit:true};
 return next(specifier,context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);
const { createManualContact } = await import('./manualContact.ts');
const globals = globalThis as any;
test.afterEach(() => {
  delete globals.__manualCall;
  delete globals.__manualBust;
});
test('manual contact creates through the authenticated owner endpoint with no handle and no automatic retry', async () => {
  let calls = 0,
    busts = 0;
  globals.__manualBust = () => busts++;
  globals.__manualCall = async (args: any) => {
    calls++;
    assert.equal(args.path, '/v1/me/contacts/create');
    assert.equal(args.method, 'POST');
    assert.equal(args.requireAuth, true);
    assert.equal(args.retries, 0);
    assert.equal(args.body.name, 'Test Person');
    assert.equal(args.body.email, 'test@example.test');
    assert.equal(args.body.username, undefined);
    assert.equal(args.body.ownerId, undefined);
    return { ok: true, data: { ok: true, contactId: 'confirmed-id' } };
  };
  assert.equal(
    await createManualContact({ fullName: ' Test Person ', email: ' test@example.test ' }),
    'confirmed-id',
  );
  assert.equal(calls, 1);
  assert.equal(busts, 1);
});
test('name-only contact cannot silently become an unresolvable identity', async () => {
  globals.__manualCall = () => assert.fail('must validate before sending');
  await assert.rejects(createManualContact({ fullName: 'Person' }), /phone number or email/);
});
test('unconfirmed create never clears cache or returns a fabricated contact', async () => {
  globals.__manualBust = () => assert.fail('not confirmed');
  for (const result of [
    { ok: false },
    { ok: true, data: { ok: false } },
    { ok: true, data: { ok: true } },
  ]) {
    globals.__manualCall = async () => result;
    await assert.rejects(
      createManualContact({ fullName: 'Test Person', email: 'test@example.test' }),
      /not confirmed/,
    );
  }
});
