import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
const loader = `
const stub = (source) => ({url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true});
export async function resolve(specifier, context, next) {
  if (specifier === 'react-native') return stub('export const Platform={OS:"ios"};');
  if (specifier === 'expo-contacts') return stub('export const getPermissionsAsync=()=>globalThis.__contactStatus(); export const requestPermissionsAsync=()=>globalThis.__contactRequest();');
  if (specifier === 'expo-modules-core') return stub('export const requireOptionalNativeModule=()=>globalThis.__appleNative;');
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);
const { getApplePermission, requestApplePermission, permissionLabel, permissionAction, performApplePermissionAction } = await import('./applePermissions.ts');
const { integrationSources } = await import('./integrationCatalog.ts');
const state = globalThis as any;

test('permission reads never prompt; contact limited and denied states survive', async () => {
  let prompts = 0;
  state.__contactRequest = async () => { prompts++; return { status: 'denied' }; };
  state.__contactStatus = async () => ({ status: 'granted', accessPrivileges: 'limited' });
  assert.equal(await getApplePermission('contacts'), 'limited');
  assert.equal(prompts, 0);
  assert.equal(await requestApplePermission('contacts'), 'denied');
  assert.equal(prompts, 1);
  assert.equal(permissionLabel('limited'), 'Selected only');
});

test('older clients report unsupported native permissions without crashing or granting access', async () => {
  state.__appleNative = null;
  for (const kind of ['location', 'photos', 'health', 'fitness'] as const) {
    assert.equal(await getApplePermission(kind), 'unavailable');
    assert.equal(await requestApplePermission(kind), 'unavailable');
  }
});

test('each request stays scoped and a Health sheet completion never means a read grant', async () => {
  const requests: string[] = [];
  state.__appleNative = {
    getStatus: async () => 'notDetermined',
    request: async (kind: string) => { requests.push(kind); return kind === 'health' ? 'reviewed' : 'limited'; },
  };
  assert.equal(await getApplePermission('health'), 'notDetermined');
  assert.deepEqual(requests, []);
  assert.equal(await requestApplePermission('health'), 'reviewed');
  assert.equal(permissionLabel('reviewed'), 'Choices reviewed');
  assert.deepEqual(requests, ['health']);
  assert.equal(await requestApplePermission('photos'), 'limited');
  assert.deepEqual(requests, ['health', 'photos']);
});

test('shared integration order replaces standalone messaging apps with Meta', () => {
  assert.deepEqual(integrationSources.slice(0, 3), ['Apple', 'Google', 'Meta']);
  for (const removed of ['WhatsApp', 'Instagram', 'iMessage']) assert.ok(!integrationSources.includes(removed as any));
  for (const retained of ['Slack', 'LinkedIn', 'Snapchat', 'Partiful', 'TikTok']) assert.ok(integrationSources.includes(retained as any));
});

test('Manage for reviewed Health shows instructions without another native request', async () => {
  let nativeRequests = 0;
  state.__appleNative = { request: async () => { nativeRequests++; return 'reviewed'; } };
  assert.equal(permissionAction('reviewed'), 'Manage');
  const result = await performApplePermissionAction('health', 'reviewed');
  assert.equal(result.kind, 'instructions');
  if (result.kind === 'instructions') {
    assert.match(result.message, /Open Health.*profile.*Apps.*Amber/);
    assert.match(result.message, /keeps your read-permission choices private/);
  }
  assert.equal(nativeRequests, 0);
  assert.deepEqual(await performApplePermissionAction('photos', 'limited'), { kind: 'settings' });
  assert.equal(nativeRequests, 0);
  assert.deepEqual(await performApplePermissionAction('health', 'notDetermined'), { kind: 'permission', status: 'reviewed' });
  assert.equal(nativeRequests, 1);
});
