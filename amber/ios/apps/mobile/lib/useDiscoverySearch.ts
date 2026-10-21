import { useCallback, useEffect, useRef, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { callMedhaId } from './medhaId';
import { discoveryFingerprint, runDiscovery, type DiscoveryInput, type DiscoveryJob } from './discoveryRequest';

export function useDiscoverySearch<T>(sample: boolean) {
  const [job, setJob] = useState<DiscoveryJob<T> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const requests = useRef(new Map<string, { id: string; expires: number; result?: DiscoveryJob<T> }>());
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  const search = useCallback(async (input: DiscoveryInput) => {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setError('');
    if (sample) { setBusy(false); setError('Sign in to search the web.'); return; }
    if (input.query.trim().length < 2 || (input.scope === 'plans' && !input.location?.trim())) { setBusy(false); return; }
    const key = discoveryFingerprint(input);
    const previous = requests.current.get(key);
    const cached = previous && previous.expires > Date.now() ? previous : undefined;
    if (cached?.result) { setJob(cached.result); setBusy(false); return; }
    const request = cached || { id: randomUUID(), expires: Date.now() + 120000 };
    requests.current.set(key, request);
    setBusy(true); setJob(null);
    try {
      const result = await runDiscovery<T>(input, { id: request.id, resume: !!cached, signal: controller.signal }, callMedhaId);
      if (active.current !== controller || controller.signal.aborted) return;
      requests.current.set(key, { ...request, result, expires: Date.now() + 300000 });
      // Keep this cache scoped to the open sheet, bounded and session-local.
      if (requests.current.size > 12) requests.current.delete(requests.current.keys().next().value!);
      setJob(result);
    } catch (e) {
      if (active.current !== controller || controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : 'Search could not finish.');
      // Keep unknown outcomes resumable; completed failures get a fresh ID next time.
      if (!(e instanceof Error && /longer than expected/.test(e.message))) requests.current.delete(key);
    } finally { if (active.current === controller && !controller.signal.aborted) setBusy(false); }
  }, [sample]);
  return { job, busy, error, setError, search };
}
