import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { loadSession } from './secureStorage';
import { defaultSpace, parseSpace, type AmberSpace } from './amberSpace';
export function useAmberSpace(sample: boolean, name = '') {
  const [space, setSpace] = useState(() => defaultSpace(name, sample));
  const current = useRef(space),
    key = useRef('');
  const writes = useRef(Promise.resolve());
  const [ready, setReady] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    key.current = '';
    setReady(false);
    void (async () => {
      const session = sample ? null : await loadSession();
      if (!sample && !session) throw Error('Sign in first.');
      const owner = sample
        ? 'preview'
        : await digestStringAsync(CryptoDigestAlgorithm.SHA256, session!.phone);
      const storageKey = `amber_space_v1:${owner}`;
      const raw = await AsyncStorage.getItem(storageKey);
      const parsed = raw
        ? parseSpace(JSON.parse(raw), defaultSpace(name, sample))
        : defaultSpace(name, sample);
      if (alive) {
        key.current = storageKey;
        current.current = parsed;
        setSpace(parsed);
        setReady(true);
      }
    })().catch(() => {
      if (alive) setError('Could not load your saved networks. Reopen Amber to retry.');
    });
    return () => {
      alive = false;
    };
  }, [sample, name]);
  const save = useCallback(async (patch: Partial<AmberSpace>) => {
    if (!key.current) throw Error('Saved networks are still loading.');
    const next = { ...current.current, ...patch };
    current.current = next;
    setSpace(next);
    setError('');
    const storageKey = key.current;
    const job = writes.current
      .catch(() => {})
      .then(() => AsyncStorage.setItem(storageKey, JSON.stringify(next)));
    writes.current = job;
    try {
      await job;
    } catch {
      setError('Changes are visible but could not be saved. Please retry.');
      throw Error('Could not save on this device.');
    }
  }, []);
  return { space, save, ready, error };
}
