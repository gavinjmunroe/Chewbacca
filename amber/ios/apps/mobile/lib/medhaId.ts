import { ensureProcessingConsent } from './aiConsent';
import { consentForRequest } from './aiConsentPolicy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { config, networkConfig } from './config';
import { getFreshAccessToken, refreshSession } from './sessionRefresh';

export type MedhaIdError = {
  ok: false;
  status: number;
  error: string;
  message?: string;
  attemptsRemaining?: number;
};

export type MedhaIdSuccess<T> = {
  ok: true;
  status: number;
  data: T;
};

export type MedhaIdResult<T> = MedhaIdSuccess<T> | MedhaIdError;

type CallOptions = {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  // When true, do not attach the bearer token. Used for /v1/otp/start and /v1/otp/verify.
  unauthenticated?: boolean;
  // When true, throw if no bearer token is present. Defaults to false (just sends without auth).
  requireAuth?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  // Override retry count. Defaults to networkConfig.maxRetries for GET, 0 for
  // writes (a retried POST could double-apply). Set to 0 to force no retry.
  retries?: number;
  // Force this call into the dedup + retry "idempotent" path even if it is not
  // a GET. Use only for genuinely safe reads expressed as POST. Default false.
  idempotent?: boolean;
  // Opt OUT of in-flight dedup for a GET (e.g. a manual pull-to-refresh that
  // must hit the network even if a background fetch is already running).
  dedupe?: boolean;
  // Instrumentation label. Defaults to "METHOD /path" with the query stripped.
  tag?: string;
};

// Error codes whose `message` is authored by us for end users and is safe to
// show verbatim. Anything else (raw http_* backend strings, internal errors)
// falls back to friendly generic copy so we never leak internal detail.
const USER_SAFE_ERRORS = new Set(['code_required', 'invalid_format', 'expired', 'mismatch']);

// Anything shaped like a failed envelope: the transport's own MedhaIdError, or a
// domain result that mirrors it without a status (e.g. contactsSync's
// SyncOutcome). Accepting both means every screen can hand its failure straight
// to medhaIdErrorCopy() without reshaping it first.
export type ErrorLike = { ok: false; error: string; message?: string; status?: number };

// Human-readable copy for a failed call, with an optional subject so screens
// can stay terse at the call site. Mirrors the old platformErrorCopy contract.
export function medhaIdErrorCopy(err: ErrorLike, subject = 'The service'): string {
  switch (err.error) {
    case 'processing_consent_required':
      return 'Processing was not enabled. Your saved information is unchanged.';
    case 'no_session':
      return 'Sign in first.';
    case 'aborted':
      return 'Cancelled.';
    case 'network_error':
      return `Could not reach ${subject}. Check your connection.`;
    case 'timeout':
      return `${subject} took too long. Try again.`;
    default:
      if (err.error.startsWith('http_')) {
        // Do not echo the raw status or backend message: use generic copy.
        return `${subject} is having a moment. Try again shortly.`;
      }
      if (USER_SAFE_ERRORS.has(err.error) && err.message) {
        return err.message;
      }
      return 'Something went wrong.';
  }
}

// A queryFn/mutationFn that needs to throw (so React Query can mark the query
// errored) must not flatten the envelope into `new Error(r.message ?? r.error)`:
// that turns a typed failure into a raw string like "network_error" or
// "Network request failed", which then leaks into a toast. Throw this instead
// and the envelope survives to the catch site, where errorCopy() can classify it.
export class MedhaIdRequestError extends Error {
  readonly result: ErrorLike;

  constructor(result: ErrorLike) {
    super(result.error);
    this.name = 'MedhaIdRequestError';
    this.result = result;
  }
}

// Unwrap a successful result, or throw a MedhaIdRequestError carrying the
// failure. The one-liner for React Query's queryFn.
export function unwrapOrThrow<T>(res: MedhaIdResult<T>): T {
  if (!res.ok) throw new MedhaIdRequestError(res);
  return res.data;
}

function toErrorLike(e: unknown): ErrorLike {
  if (e instanceof MedhaIdRequestError) return e.result;
  if (typeof e === 'object' && e !== null) {
    const o = e as Record<string, unknown>;
    if (o.ok === false && typeof o.error === 'string') return o as unknown as ErrorLike;
  }
  // A bare Error (or a non-Error throw) carries no envelope. Its message is a
  // runtime string — RN's fetch rejects with "Network request failed" — never
  // copy we can show, so classify it as a generic failure.
  return { ok: false, error: 'unknown' };
}

// User-safe copy for anything a catch block or an onError handler can receive:
// a MedhaIdRequestError, a bare failed envelope, or an arbitrary throw. Use this
// wherever a toast description is derived from an error.
export function errorCopy(e: unknown, subject = 'Amber'): string {
  return medhaIdErrorCopy(toErrorLike(e), subject);
}

// ---------------------------------------------------------------------------
// Transport observability (item 148: connectivity, item 149: timing)
// ---------------------------------------------------------------------------
// The transport is the one place every request passes through, so it is the
// right place to (a) report whether the server was reachable, and (b) record
// how long each call took. Both are emitted as plain events; lib/queryClient.ts
// subscribes to drive the offline banner and React Query's onlineManager. We do
// not import queryClient here to keep the import graph one-directional and
// avoid a cycle.

export type TransportEvent = {
  // True when an HTTP response was received at all (even a 4xx/5xx). False only
  // when the request never reached the server (network error or timeout).
  reachable: boolean;
  status: number;
  tag: string;
};

type TransportListener = (event: TransportEvent) => void;
const transportListeners = new Set<TransportListener>();

export function addTransportListener(listener: TransportListener): () => void {
  transportListeners.add(listener);
  return () => {
    transportListeners.delete(listener);
  };
}

function emitTransport(event: TransportEvent): void {
  for (const listener of transportListeners) {
    try {
      listener(event);
    } catch {
      // A misbehaving listener must never break a network call.
    }
  }
}

// Rolling timing buffer per tag. Bounded so it can never grow unbounded over a
// long session. getTimingSnapshot() turns it into p50/p95 for a dev overlay or
// log sink; setTimingReporter() lets dev tooling stream raw samples live.
type TimingSample = { ms: number; ok: boolean };
const TIMING_BUFFER = 50;
const timings = new Map<string, TimingSample[]>();
let timingReporter: ((tag: string, sample: TimingSample) => void) | null = null;

export function setTimingReporter(fn: ((tag: string, sample: TimingSample) => void) | null): void {
  timingReporter = fn;
}

function recordTiming(tag: string, sample: TimingSample): void {
  const bucket = timings.get(tag) ?? [];
  bucket.push(sample);
  if (bucket.length > TIMING_BUFFER) bucket.shift();
  timings.set(tag, bucket);
  if (timingReporter) {
    try {
      timingReporter(tag, sample);
    } catch {
      // Reporting must never break a network call.
    }
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export type TimingStat = {
  tag: string;
  count: number;
  p50: number;
  p95: number;
  max: number;
  errorRate: number;
};

// Snapshot of recent request latencies, sorted slowest-p95 first so a dev
// overlay surfaces the worst offenders immediately.
export function getTimingSnapshot(): TimingStat[] {
  const stats: TimingStat[] = [];
  for (const [tag, samples] of timings) {
    if (samples.length === 0) continue;
    const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
    const errors = samples.filter((s) => !s.ok).length;
    stats.push({
      tag,
      count: samples.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      max: sorted[sorted.length - 1],
      errorRate: errors / samples.length,
    });
  }
  return stats.sort((a, b) => b.p95 - a.p95);
}

// ---------------------------------------------------------------------------
// Core transport
// ---------------------------------------------------------------------------

function tagFor(opts: CallOptions, method: string): string {
  if (opts.tag) return opts.tag;
  const pathOnly = opts.path.split('?')[0];
  return `${method} ${pathOnly}`;
}

function isRetryable(result: MedhaIdError): boolean {
  if (result.error === 'aborted' || result.error === 'no_session') return false;
  if (result.error === 'network_error' || result.error === 'timeout') return true;
  return networkConfig.retryableStatuses.has(result.status);
}

function backoffDelay(attempt: number): number {
  const base = networkConfig.retryBaseDelayMs * 2 ** attempt;
  const capped = Math.min(base, networkConfig.retryMaxDelayMs);
  // Full jitter: a random point in [0, capped] spreads retries across clients.
  return Math.random() * capped;
}

// A single network attempt. Resolves to a typed envelope, never throws. Emits
// one transport + one timing event. Distinguishes a deliberate caller abort
// from our own timeout abort so retry/copy can react correctly.
async function attempt<T>(opts: CallOptions): Promise<MedhaIdResult<T>> {
  const method = opts.method ?? 'GET';
  const tag = tagFor(opts, method);
  const url = `${config.medhaIdBaseUrl}${opts.path.startsWith('/') ? '' : '/'}${opts.path}`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
  };

  if (!opts.unauthenticated) {
    // getFreshAccessToken refreshes FIRST when the stored access token is
    // expired or within the skew window, so a 15-minute token is invisible to
    // callers. Single-flighted inside sessionRefresh, so N concurrent requests
    // trigger at most one refresh.
    const token = await getFreshAccessToken();
    if (token) {
      headers.authorization = `Bearer ${token}`;
    } else if (opts.requireAuth) {
      return { ok: false, status: 401, error: 'no_session' };
    }
  }

  const controller = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, opts.timeoutMs ?? networkConfig.timeoutMs);

  // Honor a caller-provided signal in addition to our timeout: abort our
  // controller when theirs fires, so an in-flight fetch is actually cancelled.
  const onCallerAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onCallerAbort);
  }

  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    emitTransport({ reachable: true, status: res.status, tag });

    // Read the body defensively. On React Native, calling res.text() on a
    // response whose JSON-typed body is empty or unreadable (e.g. a 204, or a
    // 401/403/402 error the backend returns with no body) can throw a body /
    // content-type error from the fetch polyfill: the source of the on-device
    // "body cannot be called application/json" message. Swallow that and treat
    // the body as empty so callers degrade on the HTTP status, never on a
    // body-read exception.
    let text = '';
    try {
      text = await res.text();
    } catch {
      text = '';
    }
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Non-JSON response; fall through with null.
      }
    }

    recordTiming(tag, { ms: Date.now() - startedAt, ok: res.ok });

    if (!res.ok) {
      const err = (parsed ?? {}) as Record<string, unknown>;
      return {
        ok: false,
        status: res.status,
        error: typeof err.error === 'string' ? err.error : `http_${res.status}`,
        message: typeof err.message === 'string' ? err.message : undefined,
        attemptsRemaining:
          typeof err.attemptsRemaining === 'number' ? err.attemptsRemaining : undefined,
      };
    }

    return { ok: true, status: res.status, data: parsed as T };
  } catch (e: unknown) {
    clearTimeout(timeout);
    recordTiming(tag, { ms: Date.now() - startedAt, ok: false });
    // Caller deliberately cancelled (screen blur, debounced supersede): not a
    // connectivity problem, and never retried.
    if (opts.signal?.aborted && !didTimeout) {
      return { ok: false, status: 0, error: 'aborted' };
    }
    emitTransport({ reachable: false, status: 0, tag });
    if (didTimeout) {
      return { ok: false, status: 0, error: 'timeout' };
    }
    const msg = e instanceof Error ? e.message : 'network_error';
    return { ok: false, status: 0, error: 'network_error', message: msg };
  } finally {
    if (opts.signal) opts.signal.removeEventListener('abort', onCallerAbort);
  }
}

// In-flight GET dedup (item 138). Two screens asking for the same resource at
// the same time share one network round-trip. Keyed by method + url. We never
// dedup a call that carries a caller signal (aborting one must not abort the
// other) or a body.
const inflight = new Map<string, Promise<MedhaIdResult<unknown>>>();

function canDedupe(opts: CallOptions, method: string): boolean {
  if (opts.dedupe === false) return false;
  if (opts.signal) return false;
  if (opts.body !== undefined) return false;
  return method === 'GET' || opts.idempotent === true;
}

// Public entry point. Backward compatible with every existing caller; the new
// behavior (retry, dedup, timing, connectivity) is automatic and opt-out.
export async function callMedhaId<T>(opts: CallOptions): Promise<MedhaIdResult<T>> {
  const method = opts.method ?? 'GET';
  const consent = consentForRequest(opts.path, method);
  if (consent && !await ensureProcessingConsent(consent, opts.signal))
    return { ok: false, status: 0, error: 'processing_consent_required' };


  if (canDedupe(opts, method)) {
    const key = `${method} ${opts.path}`;
    const existing = inflight.get(key);
    if (existing) return existing as Promise<MedhaIdResult<T>>;
    const promise = runWithRetry<T>(opts, method).finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, promise as Promise<MedhaIdResult<unknown>>);
    return promise;
  }

  return runWithRetry<T>(opts, method);
}

// A 401 that the proactive refresh could not anticipate: the token was revoked
// server-side, or the clock skewed, or it expired between attach and arrival.
// Worth exactly ONE refresh-and-retry -- more would risk hammering a genuinely
// dead session. Only for authenticated calls that actually carry a refresh
// token; `unauthenticated` calls (sign-in itself) are excluded so a bad OTP
// never triggers a refresh.
function isAuthRecoverable<T>(res: MedhaIdResult<T>, opts: CallOptions): boolean {
  if (opts.unauthenticated) return false;
  if (res.ok || res.status !== 401) return false;
  // 'no_session' means there was no credential to begin with -- refreshing
  // cannot help, and retrying would just spin.
  return res.error !== 'no_session';
}

async function runWithRetry<T>(opts: CallOptions, method: string): Promise<MedhaIdResult<T>> {
  const idempotent = method === 'GET' || opts.idempotent === true;
  const maxRetries = opts.retries ?? (idempotent ? networkConfig.maxRetries : 0);

  let last: MedhaIdResult<T> = { ok: false, status: 0, error: 'network_error' };
  let triedAuthRecovery = false;
  for (let i = 0; i <= maxRetries; i++) {
    last = await attempt<T>(opts);
    if (last.ok) return last;
    if (isAuthRecoverable(last, opts) && !triedAuthRecovery) {
      triedAuthRecovery = true;
      const refreshed = await refreshSession();
      if (refreshed) {
        // Retry immediately with the new credential. Does not consume a retry
        // slot: this is a credential problem, not a transport failure.
        last = await attempt<T>(opts);
        if (last.ok) return last;
      }
    }
    if (!isRetryable(last) || i === maxRetries) return last;
    // Stop early if the caller cancelled between attempts.
    if (opts.signal?.aborted) return { ok: false, status: 0, error: 'aborted' };
    await new Promise((r) => setTimeout(r, backoffDelay(i)));
  }
  return last;
}

// ---------------------------------------------------------------------------
// Offline write queue (item 141)
// ---------------------------------------------------------------------------
// Writes that fail because the device is offline (feedback signals, notes) are
// not lost: they persist to disk and replay in order when connectivity returns.
// lib/queryClient.ts calls flushQueue() on reconnect and on app foreground.

const QUEUE_KEY = 'medha_offline_writes_v1';

export type QueuedWrite = {
  id: string;
  path: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  tag?: string;
  createdAt: number;
};

let queueCache: QueuedWrite[] | null = null;
let flushing = false;

async function loadQueue(): Promise<QueuedWrite[]> {
  if (queueCache) return queueCache;
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    queueCache = raw ? (JSON.parse(raw) as QueuedWrite[]) : [];
  } catch {
    queueCache = [];
  }
  return queueCache;
}

async function persistQueue(q: QueuedWrite[]): Promise<void> {
  queueCache = q;
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    // A failed persist is non-fatal: the in-memory copy still flushes this
    // session; only a kill-before-reconnect loses the write, which is acceptable
    // for best-effort signals.
  }
}

export async function enqueueWrite(write: Omit<QueuedWrite, 'id' | 'createdAt'>): Promise<void> {
  const q = await loadQueue();
  q.push({
    ...write,
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: Date.now(),
  });
  await persistQueue(q);
}

export async function pendingWriteCount(): Promise<number> {
  return (await loadQueue()).length;
}

// Drop every queued write, in memory and on disk. Called on sign-out and
// account deletion: a write enqueued by one user must never replay under the
// next user's session (flushQueue replays with requireAuth, i.e. whatever token
// is current). Clearing the in-memory `queueCache` too is essential — removing
// only the AsyncStorage key would leave this launch's cache to re-persist and
// replay the old entries on the next flush.
export async function clearOfflineQueue(): Promise<void> {
  queueCache = [];
  try {
    await AsyncStorage.removeItem(QUEUE_KEY);
  } catch {
    // Best-effort: the in-memory queue is already emptied for this session.
  }
}

// Replay queued writes oldest-first. A success or a permanent client rejection
// (4xx that is not no_session) drops the entry; a transient failure (network,
// timeout, 5xx) or no_session stops the drain so the rest survive for the next
// reconnect. Re-entrancy guarded so reconnect + foreground can both call it.
export async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    let q = await loadQueue();
    while (q.length > 0) {
      const next = q[0];
      const res = await attempt({
        path: next.path,
        method: next.method,
        body: next.body,
        requireAuth: true,
        tag: next.tag ?? `queue ${next.method} ${next.path.split('?')[0]}`,
      });
      const permanentReject =
        !res.ok && res.status >= 400 && res.status < 500 && res.error !== 'no_session';
      if (res.ok || permanentReject) {
        q = q.slice(1);
        await persistQueue(q);
      } else {
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

// Attempt a write now; if it fails purely on connectivity, persist it for replay
// and report queued=true. Permanent failures (4xx) surface to the caller as-is.
export async function callOrQueue<T>(
  opts: CallOptions & { method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' },
): Promise<MedhaIdResult<T> & { queued?: boolean }> {
  const res = await callMedhaId<T>(opts);
  if (!res.ok && (res.error === 'network_error' || res.error === 'timeout')) {
    await enqueueWrite({ path: opts.path, method: opts.method, body: opts.body, tag: opts.tag });
    return { ...res, queued: true };
  }
  return res;
}
