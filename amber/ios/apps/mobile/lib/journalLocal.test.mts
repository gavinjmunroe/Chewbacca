import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { MemoEntry } from './memoActions.ts';

const loader = `
const stub = source => ({url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true});
export async function resolve(specifier,context,next){
 if(context.parentURL?.endsWith('/journalLocal.ts')){
  if(specifier==='expo-file-system/legacy') return stub('export const getInfoAsync=(...args)=>globalThis.__journalLocalFs.getInfoAsync(...args); export const copyAsync=(...args)=>globalThis.__journalLocalFs.copyAsync(...args); export const deleteAsync=(...args)=>globalThis.__journalLocalFs.deleteAsync(...args);');
  if(specifier==='@react-native-async-storage/async-storage') return stub('export default {setItem:(...args)=>globalThis.__journalLocalStore.setItem(...args)};');
 }
 return next(specifier,context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);
const { persistJournalEntries } = await import('./journalLocal.ts');
const state = globalThis as any;

const storage = { directory: 'file:///Documents/journal/account-a/', key: 'journal:account-a' };
function memo(id = 'memo-one'): MemoEntry {
  return {
    id, text: 'Synthetic recording', destination: 'Needs review',
    createdAt: '2026-09-24T09:00:00.000Z',
    media: { uri: `file:///Caches/${id}.m4a`, durationMs: 2700, peaks: [1, 20, 5] },
  };
}
function harness(entries: MemoEntry[] = []) {
  const files = new Map<string, { size: number; isDirectory?: boolean }>();
  for (const entry of entries) {
    if (entry.media) files.set(entry.media.uri, { size: 1800 });
    if (entry.source) files.set(entry.source.uri, { size: 300 });
  }
  const index = new Map<string, string>();
  const calls: { kind: string; uri?: string; from?: string; key?: string }[] = [];
  const control = { failCopy: '', failWrite: false, emptyCopy: false, missingCopy: false };
  state.__journalLocalFs = {
    async getInfoAsync(uri: string) {
      calls.push({ kind: 'info', uri });
      const file = files.get(uri);
      return file ? { exists: true, uri, ...file } : { exists: false, uri };
    },
    async copyAsync({ from, to }: { from: string; to: string }) {
      calls.push({ kind: 'copy', uri: to, from });
      if (from === control.failCopy) throw Error('copy failed');
      const source = files.get(from);
      if (!source) throw Error('source missing');
      if (!control.missingCopy) files.set(to, { ...source, size: control.emptyCopy ? 0 : source.size });
    },
    async deleteAsync(uri: string) {
      calls.push({ kind: 'delete', uri });
      files.delete(uri);
    },
  };
  state.__journalLocalStore = {
    async setItem(key: string, value: string) {
      calls.push({ kind: 'index', key });
      if (control.failWrite) throw Error('index write failed');
      index.set(key, value);
    },
  };
  return { files, index, calls, control };
}

test('copies every original before committing the index and returns durable URIs', async () => {
  const entry = { ...memo(), source: { name: 'context.txt', mimeType: 'text/plain', uri: 'file:///Caches/context.txt' } };
  const original = structuredClone(entry);
  const h = harness([entry]);
  const result = await persistJournalEntries(storage, [entry]);
  assert.deepEqual(entry, original);
  assert.equal(result[0].media?.uri, storage.directory + 'memo-one.m4a');
  assert.equal(result[0].source?.uri, storage.directory + 'memo-one-source.txt');
  assert.equal(h.calls.at(-1)?.kind, 'index');
  assert.equal(h.calls.filter((c) => c.kind === 'copy').length, 2);
  assert.deepEqual(JSON.parse(h.index.get(storage.key)!), result);
  assert.deepEqual(result[0].media?.peaks, original.media?.peaks);
  assert.equal(result[0].media?.durationMs, 2700);
});

test('a failed copy leaves the existing index and original recording URI unchanged', async () => {
  const entries = [memo('one'), memo('two')];
  const original = structuredClone(entries);
  const h = harness(entries);
  h.index.set(storage.key, '[{"id":"previous"}]');
  h.control.failCopy = entries[1].media!.uri;
  await assert.rejects(persistJournalEntries(storage, entries), /copy failed/);
  assert.equal(h.index.get(storage.key), '[{"id":"previous"}]');
  assert.equal(h.calls.some((call) => call.kind === 'index'), false);
  assert.deepEqual(entries, original);
  assert.equal(h.files.get(storage.directory + 'one.m4a')?.size, 1800);
});

test('retry after a partial copy reuses the successful file without needing its cache original', async () => {
  const entries = [memo('one'), memo('two')];
  const h = harness(entries);
  h.control.failCopy = entries[1].media!.uri;
  await assert.rejects(persistJournalEntries(storage, entries));
  h.files.delete(entries[0].media!.uri);
  h.control.failCopy = '';
  h.calls.length = 0;
  const result = await persistJournalEntries(storage, entries);
  assert.deepEqual(h.calls.filter((c) => c.kind === 'copy').map((c) => c.from), [entries[1].media!.uri]);
  assert.equal(result.length, 2);
  assert.ok(h.index.has(storage.key));
});

test('failed index write preserves original input and retry reuses already durable audio', async () => {
  const entry = memo();
  const original = structuredClone(entry);
  const h = harness([entry]);
  h.index.set(storage.key, '[{"id":"previous"}]');
  h.control.failWrite = true;
  await assert.rejects(persistJournalEntries(storage, [entry]), /index write failed/);
  assert.equal(h.index.get(storage.key), '[{"id":"previous"}]');
  assert.deepEqual(entry, original);
  h.files.delete(entry.media!.uri);
  h.control.failWrite = false;
  h.calls.length = 0;
  await persistJournalEntries(storage, [entry]);
  assert.equal(h.calls.some((c) => c.kind === 'copy'), false);
  assert.equal(JSON.parse(h.index.get(storage.key)!)[0].media.uri, storage.directory + 'memo-one.m4a');
});

test('same memo ID is isolated by account directory and index key, including unsafe ID characters', async () => {
  const entry = memo('../shared/note');
  const other = { directory: 'file:///Documents/journal/account-b/', key: 'journal:account-b' };
  const h = harness([entry]);
  const first = await persistJournalEntries(storage, [entry]);
  const second = await persistJournalEntries(other, [entry]);
  const filename = encodeURIComponent(entry.id) + '.m4a';
  assert.equal(first[0].media?.uri, storage.directory + filename);
  assert.equal(second[0].media?.uri, other.directory + filename);
  assert.equal(h.index.size, 2);
  assert.notEqual(first[0].media?.uri, second[0].media?.uri);
});

test('a missing or zero-byte copied recording cannot be committed as saved', async () => {
  for (const mode of ['missingCopy', 'emptyCopy'] as const) {
    const entry = memo();
    const h = harness([entry]);
    h.control[mode] = true;
    await assert.rejects(persistJournalEntries(storage, [entry]), /Recording was not saved/);
    assert.equal(h.index.has(storage.key), false);
    assert.equal(entry.media?.uri, 'file:///Caches/memo-one.m4a');
  }
});

test('file extension ignores audio URL query parameters and a text-only memo needs no file copy', async () => {
  const entry = memo();
  entry.media!.uri = 'file:///Caches/take.aac?cache=latest';
  const text = { ...memo('text'), media: undefined };
  const h = harness([entry]);
  const result = await persistJournalEntries(storage, [entry, text]);
  assert.equal(result[0].media?.uri, storage.directory + 'memo-one.aac');
  assert.equal(result[1].media, undefined);
  assert.equal(h.calls.filter((c) => c.kind === 'copy').length, 1);
});

test('missing or empty attachment copies cannot replace a previously saved index', async () => {
  for (const mode of ['missingCopy', 'emptyCopy'] as const) {
    const entry = {
      ...memo(), media: undefined,
      source: { name: 'context.pdf', mimeType: 'application/pdf', uri: 'file:///Caches/context.pdf' },
    };
    const h = harness([entry]);
    h.index.set(storage.key, '[{"id":"previous"}]');
    h.control[mode] = true;
    await assert.rejects(persistJournalEntries(storage, [entry]), /Attachment was not saved/);
    assert.equal(h.index.get(storage.key), '[{"id":"previous"}]');
    assert.equal(entry.source.uri, 'file:///Caches/context.pdf');
  }
});

test('retry replaces empty destination files while preserving original audio and attachment', async () => {
  const entry = {
    ...memo(), source: { name: 'context.pdf', mimeType: 'application/pdf', uri: 'file:///Caches/context.pdf?version=1' },
  };
  const h = harness([entry]);
  h.files.set(storage.directory + 'memo-one.m4a', { size: 0 });
  h.files.set(storage.directory + 'memo-one-source.pdf', { size: 0 });
  const result = await persistJournalEntries(storage, [entry]);
  assert.equal(h.calls.filter((c) => c.kind === 'delete').length, 2);
  assert.equal(h.calls.filter((c) => c.kind === 'copy').length, 2);
  assert.equal(h.files.get(result[0].media!.uri)?.size, 1800);
  assert.equal(h.files.get(result[0].source!.uri)?.size, 300);
  assert.equal(h.files.get(entry.media!.uri)?.size, 1800);
  assert.equal(h.files.get(entry.source.uri)?.size, 300);
});

test('does not delete an original corrupt file or a directory occupying its destination', async () => {
  const entry = memo();
  entry.media!.uri = storage.directory + 'memo-one.m4a';
  const h = harness([entry]);
  h.files.set(entry.media!.uri, { size: 0 });
  await assert.rejects(persistJournalEntries(storage, [entry]), /Recording was not saved/);
  h.files.set(entry.media!.uri, { size: 4096, isDirectory: true });
  await assert.rejects(persistJournalEntries(storage, [entry]), /Recording was not saved/);
  assert.equal(h.calls.some((c) => c.kind === 'delete'), false);
  assert.equal(h.index.has(storage.key), false);
});

test('missing historical audio does not block a new recording from being saved', async () => {
  const old: MemoEntry = { ...memo('old'), text: 'Keep this historical context' };
  const fresh = memo('fresh');
  const h = harness([fresh]);
  const result = await persistJournalEntries(storage, [old, fresh], new Set(['fresh']));
  assert.equal(result.length, 2);
  assert.equal(result[0].media?.uri, old.media?.uri);
  assert.equal(result[0].text, old.text);
  assert.match(result[0].localStorageError ?? '', /Original audio is unavailable/);
  assert.equal(result[1].media?.uri, storage.directory + 'fresh.m4a');
  assert.equal(result[1].localStorageError, undefined);
  assert.equal(JSON.parse(h.index.get(storage.key)!)[1].id, 'fresh');
  assert.equal(old.localStorageError, undefined);
});

test('historical attachment failure keeps metadata, but a new missing file still blocks commit', async () => {
  const old: MemoEntry = {
    ...memo('old'), media: undefined,
    source: { name: 'Old context.pdf', mimeType: 'application/pdf', uri: 'file:///Lost/context.pdf' },
  };
  const fresh = memo('fresh');
  const h = harness([fresh]);
  const result = await persistJournalEntries(storage, [old, fresh], new Set(['fresh']));
  assert.deepEqual(result[0].source, old.source);
  assert.match(result[0].localStorageError ?? '', /original attachment is unavailable/);
  const lastCommitted = h.index.get(storage.key);
  const another = memo('new-missing');
  await assert.rejects(persistJournalEntries(storage, [old, fresh, another], new Set(['new-missing'])));
  assert.equal(h.index.get(storage.key), lastCommitted);
});

test('recovered historical files clear their storage warning without changing the saved context', async () => {
  const old: MemoEntry = { ...memo('old'), localStorageError: 'Unavailable earlier' };
  const h = harness([old]);
  const result = await persistJournalEntries(storage, [old], new Set());
  assert.equal(result[0].localStorageError, undefined);
  assert.equal(result[0].media?.uri, storage.directory + 'old.m4a');
  assert.equal(result[0].text, old.text);
  assert.equal(old.localStorageError, 'Unavailable earlier');
  assert.equal(JSON.parse(h.index.get(storage.key)!)[0].localStorageError, undefined);
});
