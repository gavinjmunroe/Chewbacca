export type DiscoveryInput = { query: string; scope: 'people' | 'plans'; location?: string };
export type DiscoveryJob<T> = { id: string; status: string; scope?: 'people' | 'plans'; results?: T[]; message?: string };
type Response<T> = { ok: true; data: T } | { ok: false; status: number; message?: string };
type Options = { path: string; method: 'GET' | 'POST'; body?: unknown; signal: AbortSignal; timeoutMs: number; requireAuth: boolean; retries: number };
export type DiscoveryCall = <T>(options: Options) => Promise<Response<T>>;
export function discoveryFingerprint(input: DiscoveryInput) {
  return JSON.stringify([input.scope, input.query.trim(), input.scope === 'plans' ? input.location?.trim() || '' : '']);
}
export function validDiscoveryResult(scope: DiscoveryInput['scope'], value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.name !== 'string' || !row.name.trim() || typeof row.url !== 'string') return false;
  try { if (new URL(row.url).protocol !== 'https:') return false; } catch { return false; }
  if (scope === 'people') return row.kind === 'person' && typeof row.linkedin === 'string';
  if (row.kind !== 'place' || typeof row.city !== 'string' || typeof row.address !== 'string' || !row.address.trim()) return false;
  return true;
}
function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(Error('aborted')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1500);
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
}
/** Resume the same owner-bound job after a timeout. Never automatically re-POST. */
export async function runDiscovery<T>(
  input: DiscoveryInput,
  request: { id: string; resume: boolean; signal: AbortSignal },
  call: DiscoveryCall,
  wait: (signal: AbortSignal) => Promise<void> = pause,
): Promise<DiscoveryJob<T>> {
  const path = `/v1/me/discovery/jobs/${request.id}`;
  const options = { signal: request.signal, requireAuth: true, retries: 0 };
  let response = await call<DiscoveryJob<T>>({ ...options,
    path: request.resume ? path : '/v1/me/discovery/search', method: request.resume ? 'GET' : 'POST',
    ...(request.resume ? {} : { body: { ...input, requestId: request.id } }), timeoutMs: request.resume ? 10000 : 20000 });
  for (let attempt = 0; attempt < 12; attempt++) {
    if (request.signal.aborted) throw Error('aborted');
    if (response.ok && response.data.status === 'complete') {
      if (response.data.scope !== input.scope || !Array.isArray(response.data.results) || response.data.results.some(row => !validDiscoveryResult(input.scope, row))) throw Error('Search returned the wrong type of results. Please start a new search.');
      return { ...response.data, results: response.data.results.slice(0, 10) };
    }
    if (response.ok && response.data.status === 'error') throw Error(response.data.message || 'Search could not finish. Try again.');
    if (!response.ok && response.status !== 0 && response.status !== 502 && response.status !== 504)
      throw Error(response.message || (response.status === 404 ? 'This search expired. Try again.' : 'Search is unavailable. Please try again.'));
    await wait(request.signal);
    response = await call<DiscoveryJob<T>>({ ...options, path, method: 'GET', timeoutMs: 10000 });
  }
  throw Error('Search is taking longer than expected. Tap search to check again.');
}
