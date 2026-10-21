import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import type { MemoEntry } from './memoActions';

async function preserveFile(from: string, to: string, failure: string): Promise<void> {
  const valid = (info: FileSystem.FileInfo) =>
    info.exists && !info.isDirectory && (!('size' in info) || info.size > 0);
  const existing = await FileSystem.getInfoAsync(to);
  if (valid(existing)) return;
  // An interrupted copy can leave an empty destination. It is not a successful
  // save, and retry must replace it while keeping the original source intact.
  if (existing.exists) {
    if (existing.isDirectory || from === to) throw Error(failure);
    await FileSystem.deleteAsync(to, { idempotent: true });
  }
  await FileSystem.copyAsync({ from, to });
  if (!valid(await FileSystem.getInfoAsync(to))) throw Error(failure);
}

/** Persist original files before committing the recoverable, account-scoped journal index. */
export async function persistJournalEntries(
  storage: { directory: string; key: string },
  entries: MemoEntry[],
  strictIds?: ReadonlySet<string>,
): Promise<MemoEntry[]> {
  const durable: MemoEntry[] = [];
  for (const memo of entries) {
    const strict = !strictIds || strictIds.has(memo.id);
    const unavailable: string[] = [];
    let media = memo.media;
    if (media) {
      const extension = media.uri.split('?')[0].match(/\.[a-zA-Z0-9]+$/)?.[0] || '.m4a';
      const uri = `${storage.directory}${encodeURIComponent(memo.id)}${extension}`;
      try {
        await preserveFile(media.uri, uri, 'Recording was not saved');
        media = { ...media, uri };
      } catch (error) {
        if (strict) throw error;
        unavailable.push('Original audio is unavailable on this device.');
      }
    }
    let source = memo.source;
    if (source) {
      const extension = source.uri.split('?')[0].match(/\.[a-zA-Z0-9]+$/)?.[0] || '.bin';
      const uri = `${storage.directory}${encodeURIComponent(memo.id)}-source${extension}`;
      try {
        await preserveFile(source.uri, uri, 'Attachment was not saved');
        source = { ...source, uri };
      } catch (error) {
        if (strict) throw error;
        unavailable.push('The original attachment is unavailable on this device.');
      }
    }
    const saved = { ...memo, media, source };
    if (unavailable.length)
      saved.localStorageError = `${unavailable.join(' ')} Your saved note is still available.`;
    else delete saved.localStorageError;
    durable.push(saved);
  }
  await AsyncStorage.setItem(storage.key, JSON.stringify(durable));
  return durable;
}
