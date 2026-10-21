import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
function setup(teamId: string | null = 'TESTTEAM') {
  const values = new Map<string, string>();
  const scopedKey = (key: string, options?: { accessGroup?: string }) =>
    `${options?.accessGroup ?? 'private'}:${key}`;
  const storage = {
    setItemAsync: async (key: string, value: string, options?: { accessGroup?: string }) => { values.set(scopedKey(key, options), value); },
    getItemAsync: async (key: string, options?: { accessGroup?: string }) => values.get(scopedKey(key, options)) ?? null,
    deleteItemAsync: async (key: string, options?: { accessGroup?: string }) => { values.delete(scopedKey(key, options)); },
  };
  const module = { exports: {} as Record<string, (...args: any[]) => Promise<any>> };
  const source = readFileSync(new URL('./secureStorage.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const sessionStoreModule = { exports: {} as Record<string, unknown> };
  const sessionStoreSource = readFileSync(new URL('./sessionStore.ts', import.meta.url), 'utf8');
  const sessionStoreOutput = ts.transpileModule(sessionStoreSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  runInNewContext(sessionStoreOutput.outputText, { exports: sessionStoreModule.exports });
  runInNewContext(output.outputText, { exports: module.exports, require: (id: string) => {
    if (id === 'expo-secure-store') return storage;
    if (id === 'expo-constants') return { default: { expoConfig: { ios: teamId ? { appleTeamId: teamId } : {} } } };
    if (id === './sessionStore') return sessionStoreModule.exports;
    throw new Error(`unexpected module: ${id}`);
  } });
  return { api: module.exports, storage, values };
}
test('new legacy sign-in cannot inherit another account refresh credential', async () => {
  const { api } = setup();
  await api.saveSession('access-a', '+12025550101', 'refresh-a');
  await api.saveSession('access-b', '+12025550102');
  assert.equal(await api.loadRefreshToken(), null);
  const session = await api.loadSession();
  assert.equal(session.token, 'access-b');
  assert.equal(session.phone, '+12025550102');
});
test('explicit rotated refresh credential replaces the old one', async () => {
  const { api, storage } = setup();
  await api.saveSession('access-a', '+12025550101', 'refresh-a');
  await api.saveSession('access-new', '+12025550101', 'refresh-new');
  assert.equal(await api.loadRefreshToken(), 'refresh-new');
  assert.equal(await storage.getItemAsync('medha_refresh_token_v1', { accessGroup: 'TESTTEAM.com.joinrytual.amber.shared' }), 'refresh-new');
});
test('null refresh credential clears old credential and sign-out clears the session', async () => {
  const { api, storage } = setup();
  await api.saveSession('access-a', '+12025550101', 'refresh-a');
  await api.saveSession('access-b', '+12025550102', null);
  assert.equal(await api.loadRefreshToken(), null);
  assert.equal(await storage.getItemAsync('medha_refresh_token_v1', { accessGroup: 'TESTTEAM.com.joinrytual.amber.shared' }), null);
  await api.clearSession();
  assert.equal(await api.loadSession(), null);
  assert.equal(await storage.getItemAsync('medha_session_token_v1', { accessGroup: 'TESTTEAM.com.joinrytual.amber.shared' }), null);
});
test('a build without an Apple team still stores the app-private session', async () => {
  const { api } = setup(null);
  await api.saveSession('access-private', '+12025550103', 'refresh-private');
  const session = await api.loadSession();
  assert.equal(session?.token, 'access-private');
  assert.equal(session?.phone, '+12025550103');
  assert.equal(await api.loadRefreshToken(), 'refresh-private');
});
