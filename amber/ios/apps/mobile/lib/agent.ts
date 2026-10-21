import { ensureProcessingConsent } from './aiConsent';
import { getFreshAccessToken } from './sessionRefresh';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetch as expoFetch } from 'expo/fetch';
import { config } from './config';

export type Citation = {
  ref: string;
  personId?: string;
  name?: string;
  kind?: string;
  source?: string;
  snippet?: string;
  score?: number;
  created_at?: string;
};

export type Person = {
  id: string;
  name?: string;
  personId?: string;
  score?: number;
  pineconeScore?: number;
  reasoning?: string;
};

export type AskMeta = {
  people: Person[];
  citations: Citation[];
  dimensionWeights?: Record<string, number>;
  usedPeopleRank?: boolean;
  model?: string;
};

// A tool-execution progress signal. The agent backend may emit these as it runs
// a tool (calendar, gmail, drive, network search) so the client can show a live
// "Checking your calendar" status that collapses to the result. The backend is
// free to omit them entirely; the client degrades to a plain typing indicator.
export type ToolPhase = 'start' | 'end';

export type AskStreamEvent =
  | { kind: 'meta'; meta: AskMeta }
  | { kind: 'token'; delta: string }
  | { kind: 'tool'; name: string; phase: ToolPhase; label?: string }
  | { kind: 'done'; answer: string }
  | { kind: 'complete'; tookMs?: number }
  | { kind: 'error'; error: string; message?: string };

export type AskMessage = { role: 'user' | 'assistant'; content: string };

export type AgentTarget = 'medha' | 'togari';

type AskStreamOptions = {
  agent: AgentTarget;
  question: string;
  history?: AskMessage[];
  topK?: number;
  signal?: AbortSignal;
  onEvent: (event: AskStreamEvent) => void;
};

export async function askAgent(opts: AskStreamOptions): Promise<void> {
  if (!await ensureProcessingConsent('ai', opts.signal)) {
    opts.onEvent({ kind: 'error', error: 'processing_consent_required', message: 'AI processing is not enabled.' });
    return;
  }

  if (opts.agent === 'togari') {
    await askTogari(opts);
  } else {
    await askMedha(opts);
  }
}

// SSE stream from medha-platform /api/v1/quick-call/stream, bearer JWT auth.
// This runs the SAME tool-using agent loop iMessage Medha uses (calendar,
// gmail, drive via the user's connected Google account), and streams the
// reply back inline. The older /api/ask/stream is RAG/PeopleRank only (no
// tools); the Amber tab still uses that PeopleRank surface directly. The
// agent keeps its own per-tenant conversation memory server-side, so this
// path sends only the latest turn (no client-side history/topK).
async function askMedha(opts: AskStreamOptions): Promise<void> {
  const token = await getFreshAccessToken();
  if (!token) {
    opts.onEvent({ kind: 'error', error: 'no_session' });
    return;
  }

  // Use expo/fetch, NOT React Native's global fetch. RN's global fetch does
  // not implement a readable response body (res.body is always null), so SSE
  // can't be streamed: the old code fell into the !res.body branch on a 200
  // and emitted http_200. expo/fetch (SDK 54, native iOS module) returns a
  // real ReadableStream body whose getReader() streams the SSE frames.
  const res = await expoFetch(`${config.amberAgentBaseUrl}/api/v1/quick-call/stream`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text: opts.question }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    let errBody: { error?: string; message?: string } = {};
    try {
      errBody = await res.json();
    } catch {
      /* ignore parse */
    }
    opts.onEvent({
      kind: 'error',
      error: errBody.error ?? `http_${res.status}`,
      message: errBody.message,
    });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Guard against an upstream that streams without ever sending a frame
  // delimiter: if the buffer grows past this cap with no '\n\n', stop rather
  // than letting memory grow unbounded.
  const MAX_BUFFER_BYTES = 256 * 1024;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        // Natural end-of-stream. The /quick-call/stream path has no explicit
        // "done" frame (the server settles a beat after the last segment), so
        // reaching EOF without an abort is how we know the turn finished. Emit
        // a synthetic complete so the UI can drop the cursor and fire its
        // stream-complete haptic. Skip it on abort: that is a clean cancel.
        if (!opts.signal?.aborted) opts.onEvent({ kind: 'complete' });
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let frameEnd = buffer.indexOf('\n\n');
      while (frameEnd !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        handleFrame(frame, opts.onEvent);
        frameEnd = buffer.indexOf('\n\n');
      }

      if (buffer.length > MAX_BUFFER_BYTES) {
        opts.onEvent({
          kind: 'error',
          error: 'stream_overflow',
          message: 'The response stream was malformed.',
        });
        break;
      }
    }
  } catch (e: unknown) {
    // An aborted read (component unmount, agent switch) is a clean cancel, not
    // an error: stay silent so the UI doesn't flash a failure bubble. Anything
    // else is a real transport failure and surfaces as an error event.
    const aborted =
      (e instanceof Error && e.name === 'AbortError') || opts.signal?.aborted === true;
    if (!aborted) {
      opts.onEvent({ kind: 'error', error: 'network_error' });
    }
  } finally {
    // Always release the lock so the underlying stream can be reclaimed.
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

// One-shot POST to the AUTHED backend proxy (medha-platform), which forwards
// to togari-platform server-side. Returns the full reply text as a single
// token + done. No streaming on togari side today.
//
// SECURITY: this used to POST directly to togari-platform /api/v1/message with
// a shared service secret (x-togari-key) baked into the client bundle, and set
// user_id from the local phone with no server verification. That secret is
// extractable from the IPA and visible to any network proxy, and a
// client-chosen user_id lets a caller impersonate any phone. Both were removed.
// We now send only { text } to ${amberAgentBaseUrl}/api/v1/togari/message with
// the user's medha-id JWT as the bearer; the server attaches the Togari key and
// derives identity from the JWT. If the proxy host is not configured we fail
// SAFE with a friendly error rather than calling production Togari with no key.
// REMEDIATION: the leaked key committed to git history must be ROTATED
// server-side; deleting it from the client does not invalidate the old value.
async function askTogari(opts: AskStreamOptions): Promise<void> {
  if (!config.amberAgentBaseUrl) {
    opts.onEvent({
      kind: 'error',
      error: 'togari_not_configured',
      message: 'Togari is not available yet.',
    });
    return;
  }

  const token = await getFreshAccessToken();
  if (!token) {
    opts.onEvent({ kind: 'error', error: 'no_session' });
    return;
  }

  const res = await fetch(`${config.amberAgentBaseUrl}/api/v1/togari/message`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text: opts.question }),
    signal: opts.signal,
  }).catch(() => null);

  if (!res) {
    opts.onEvent({ kind: 'error', error: 'network_error' });
    return;
  }
  if (!res.ok) {
    let errBody: { error?: string; message?: string } = {};
    try {
      errBody = await res.json();
    } catch {
      /* ignore parse */
    }
    opts.onEvent({
      kind: 'error',
      error: errBody.error ?? `http_${res.status}`,
      message: errBody.message,
    });
    return;
  }
  const json: { success?: boolean; data?: { type?: string; text?: string } } = await res
    .json()
    .catch(() => ({}));
  const text = json.data?.text;
  if (!json.success || typeof text !== 'string' || text.length === 0) {
    opts.onEvent({
      kind: 'error',
      error: 'empty_response',
      message: 'Togari returned no text.',
    });
    return;
  }
  opts.onEvent({ kind: 'token', delta: text });
  opts.onEvent({ kind: 'done', answer: text });
}

function handleFrame(frame: string, emit: (e: AskStreamEvent) => void): void {
  const lines = frame.split('\n');
  let eventName = '';
  // Per the SSE spec, multiple data: lines in one frame are a single payload
  // joined by newlines. Collect them and trim only the assembled value, never
  // each line, so multi-line JSON payloads survive intact.
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5));
  }
  const dataRaw = dataLines.join('\n').trim();
  if (!eventName || !dataRaw) return;

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(dataRaw) as Record<string, unknown>;
  } catch {
    return;
  }

  switch (eventName) {
    case 'meta':
      emit({
        kind: 'meta',
        meta: {
          people: (payload.people as Person[]) ?? [],
          citations: (payload.citations as Citation[]) ?? [],
          dimensionWeights: payload.dimensionWeights as Record<string, number> | undefined,
          usedPeopleRank: payload.usedPeopleRank as boolean | undefined,
          model: payload.model as string | undefined,
        },
      });
      return;
    case 'token':
      emit({ kind: 'token', delta: String(payload.delta ?? '') });
      return;
    // Tool progress. Accept a few shapes so we stay forward-compatible with the
    // backend: a single `tool` event carrying { name, phase }, or discrete
    // `tool_start` / `tool_end` events, or a generic `status` frame. A missing
    // name falls back to a neutral label so we never render an empty chip.
    case 'tool':
    case 'tool_start':
    case 'tool_end':
    case 'status': {
      const phase: ToolPhase =
        eventName === 'tool_end' || payload.phase === 'end' || payload.status === 'end'
          ? 'end'
          : 'start';
      const name = String(payload.name ?? payload.tool ?? 'tool');
      const label = typeof payload.label === 'string' ? payload.label : undefined;
      emit({ kind: 'tool', name, phase, label });
      return;
    }
    case 'done':
      emit({ kind: 'done', answer: String(payload.answer ?? '') });
      return;
    case 'complete':
      emit({ kind: 'complete', tookMs: payload.tookMs as number | undefined });
      return;
    case 'error':
      emit({
        kind: 'error',
        error: String(payload.error ?? 'unknown'),
        message: payload.message as string | undefined,
      });
      return;
  }
}

// Local chat history persistence
//
// The agent keeps its own per-tenant conversation memory server-side, so this
// is purely a UI convenience: rehydrate the visible transcript on app open so a
// session is not lost when the user backgrounds or kills the app. We store a
// trimmed, render-only shape (no transient streaming flags) keyed per agent.

export type PersistedMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  tools?: string[];
};

// Cap what we persist so a long-lived chat never bloats secure-adjacent storage
// or slows rehydration. The transcript scrolls; older turns live server-side.
const MAX_PERSISTED_MESSAGES = 80;

function historyKey(agent: AgentTarget): string {
  return `amber.chat.history.${agent}`;
}

export async function loadChatHistory(agent: AgentTarget): Promise<PersistedMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(historyKey(agent));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensively narrow: drop anything that does not look like a message so a
    // corrupted or schema-drifted blob can never crash the chat on open.
    return parsed.filter(
      (m): m is PersistedMessage =>
        !!m &&
        typeof m === 'object' &&
        (m as PersistedMessage).role !== undefined &&
        typeof (m as PersistedMessage).content === 'string',
    );
  } catch {
    return [];
  }
}

export async function saveChatHistory(
  agent: AgentTarget,
  messages: PersistedMessage[],
): Promise<void> {
  try {
    const trimmed = messages.slice(-MAX_PERSISTED_MESSAGES);
    await AsyncStorage.setItem(historyKey(agent), JSON.stringify(trimmed));
  } catch {
    /* best-effort: a failed persist must never break the live chat */
  }
}

export async function clearChatHistory(agent: AgentTarget): Promise<void> {
  try {
    await AsyncStorage.removeItem(historyKey(agent));
  } catch {
    /* best-effort */
  }
}
