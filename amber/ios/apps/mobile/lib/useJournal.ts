import { persistJournalEntries } from './journalLocal';
import { syncJournalMemo } from './journalSync';
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { loadSession } from './secureStorage';
import type { MemoEntry } from './memoActions';

/** Account-isolated index; audio is copied out of the recorder's evictable cache. */
export function useJournal(sample: boolean) {
  const [memos, setMemos] = useState<MemoEntry[]>([]);
  const [storage, setStorage] = useState<{ key: string; directory: string }>();
  const [error, setError] = useState('');
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const committedIds = useRef(new Set<string>());
  const latestMemos = useRef(memos);
  latestMemos.current = memos;
  const pendingRecordings = useRef(new Map<string, MemoEntry>());
  for (const memo of memos) pendingRecordings.current.delete(memo.id);
  const latestCloud = useRef(new Map<string, NonNullable<MemoEntry['cloud']>>());
  const syncing = useRef(new Map<string, Promise<void>>());
  const syncMemo = useCallback(
    (entry: MemoEntry): Promise<void> => {
      if (sample || !entry.cloud) return Promise.resolve();
      const active = syncing.current.get(entry.id);
      if (active)
        return active.then(() =>
          syncMemo({ ...entry, cloud: latestCloud.current.get(entry.id) ?? entry.cloud }),
        );
      const report = (cloud: NonNullable<MemoEntry['cloud']>) => {
        latestCloud.current.set(entry.id, cloud);
        setMemos((old) => old.map((memo) => (memo.id === entry.id ? { ...memo, cloud } : memo)));
      };
      const job = syncJournalMemo(entry, report)
        .then(report)
        .finally(() => syncing.current.delete(entry.id));
      syncing.current.set(entry.id, job);
      return job;
    },
    [sample],
  );
  useEffect(() => {
    let alive = true;
    void (async () => {
      const session = sample ? null : await loadSession();
      if (!sample && !session) throw Error('Sign in to load your journal.');
      const owner = sample
        ? 'preview'
        : await digestStringAsync(CryptoDigestAlgorithm.SHA256, session!.phone);
      if (!FileSystem.documentDirectory) throw Error('Recording storage unavailable.');
      const directory = `${FileSystem.documentDirectory}journal/${owner}/`;
      const key = `amber_journal_v1:${owner}`;
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const raw = await AsyncStorage.getItem(key);
      const restored: MemoEntry[] = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(restored)) throw Error('Invalid journal index');
      // iOS can change the sandbox prefix. Resolve durable filenames against
      // the current Documents location on each launch.
      const entries = restored.map((entry) => ({
        ...entry,
        source: entry.source
          ? { ...entry.source, uri: directory + entry.source.uri.split('/').pop() }
          : undefined,
        media: entry.media
          ? {
              ...entry.media,
              uri: directory + entry.media.uri.split('/').pop(),
            }
          : undefined,
      }));
      if (alive) {
        committedIds.current = new Set(entries.map((entry) => entry.id));
        setMemos((current) => [
          ...current,
          ...entries.filter((entry) => !current.some((v) => v.id === entry.id)),
        ]);
        setStorage({ key, directory });
      }
    })().catch(() => {
      if (alive)
        setError(
          'Could not open saved recordings. New memos remain in this session; reopen Journal to retry.',
        );
    });
    return () => {
      alive = false;
    };
  }, [sample]);
  useEffect(() => {
    if (!storage) return;
    let alive = true;
    const snapshot = memos;
    const job = writes.current
      .catch(() => {})
      .then(async () => {
        const merged = [
          ...snapshot,
          ...Array.from(pendingRecordings.current.values()).filter(
            (p) => !snapshot.some((m) => m.id === p.id),
          ),
        ];
        const durable = await persistJournalEntries(
          storage,
          merged,
          new Set(merged.filter((m) => !committedIds.current.has(m.id)).map((m) => m.id)),
        );
        durable.forEach((m) => committedIds.current.add(m.id));
        if (alive) {
          setError('');
          setMemos((current) => {
            const warnings = new Map(durable.map((m) => [m.id, m.localStorageError]));
            if (
              !current.some((m) => warnings.has(m.id) && m.localStorageError !== warnings.get(m.id))
            )
              return current;
            return current.map((m) =>
              warnings.has(m.id) ? { ...m, localStorageError: warnings.get(m.id) } : m,
            );
          });
        }
      });
    writes.current = job;
    void job.catch(() => {
      if (alive)
        setError(
          'Recording is available now, but could not be saved on this device. Keep Amber open and try again.',
        );
    });
    return () => {
      alive = false;
    };
  }, [memos, storage]);
  async function preserveMemo(entry: MemoEntry): Promise<MemoEntry> {
    if (!storage) throw Error('Journal storage is not ready');
    pendingRecordings.current.set(entry.id, entry);
    const job = writes.current
      .catch(() => {})
      .then(async () => {
        const snapshot = latestMemos.current;
        const merged = [
          ...snapshot,
          ...Array.from(pendingRecordings.current.values()).filter(
            (p) => !snapshot.some((m) => m.id === p.id),
          ),
        ];
        const strict = new Set(
          merged
            .filter((m) => !committedIds.current.has(m.id) || pendingRecordings.current.has(m.id))
            .map((m) => m.id),
        );
        const saved = await persistJournalEntries(storage, merged, strict);
        saved.forEach((m) => committedIds.current.add(m.id));
        return saved.find((m) => m.id === entry.id)!;
      });
    writes.current = job;
    const durable = await job.catch((error) => {
      pendingRecordings.current.delete(entry.id);
      throw error;
    });
    pendingRecordings.current.set(entry.id, durable);
    return durable;
  }
  return { memos, setMemos, syncMemo, preserveMemo, error, ready: !!storage };
}
