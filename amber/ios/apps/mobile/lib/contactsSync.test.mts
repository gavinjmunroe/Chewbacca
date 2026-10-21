import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const loader = `
const stub = (source) => ({url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true});
export async function resolve(specifier, context, next) {
  if (specifier === 'expo-contacts') return stub(\`
    export const Fields = new Proxy({}, { get: (_, key) => key === 'Note' ? 'note' : key });
    export const getPermissionsAsync = async () => ({status:'granted',accessPrivileges:'limited'});
    export const requestPermissionsAsync = getPermissionsAsync;
    export const getContactsAsync = async (options) => globalThis.__readContacts(options);
  \`);
  if (context.parentURL?.endsWith('/contactsSync.ts')) {
    if (specifier === './medhaId') return stub('export const callMedhaId = async () => globalThis.__uploadContacts();');
    if (specifier === './network') return stub('export const bustContactsCache = () => {};');
    if (specifier === './contactMap') return next(new URL('./contactMap.ts', context.parentURL).href, context);
  }
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);
const { readDeviceContactsDetailed, syncContactsInChunks } = await import('./contactsSync.ts');
const state = globalThis as any;

test('device read works without notes entitlement and preserves paginated limited access', async () => {
  const offsets: number[] = [];
  state.__readContacts = async (options: { fields: string[]; pageOffset: number }) => {
    if (options.fields.includes('note')) throw new Error('CNErrorDomain unauthorizedKeys');
    offsets.push(options.pageOffset);
    return { data: [{id: String(options.pageOffset), name:'Test contact'}], hasNextPage: options.pageOffset === 0 };
  };
  const result = await readDeviceContactsDetailed();
  assert.deepEqual(offsets, [0, 1]);
  assert.equal(result.access, 'limited');
  assert.equal(result.deviceTotal, 2);
  assert.equal(result.contacts.length, 2);
});

test('partial upload reports failure instead of claiming every contact saved', async () => {
  state.__uploadContacts = async () => ({ok:true, data:{upserted:1, failed:1}});
  const contacts = [1,2].map(id => ({id:String(id), name:'Test', phones:[], emails:[]}));
  const result = await syncContactsInChunks(contacts);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.failed, 1);
});
