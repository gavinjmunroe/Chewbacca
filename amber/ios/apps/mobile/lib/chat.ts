import { ensureProcessingConsent } from './aiConsent';
import { fetch as expoFetch } from 'expo/fetch';
import { config } from './config';
import { getFreshAccessToken } from './sessionRefresh';

// Streaming client for medha-id's POST /v1/chat (Server-Sent Events).
//
// Cloned from lib/agent.ts's SSE-over-fetch reader: React Native's GLOBAL fetch
// returns a null response body (no streaming), so we use expo/fetch (SDK 54's
// native fetch), whose response exposes a real ReadableStream via getReader().
// Unlike the agent endpoint, /v1/chat lives on the medha-id host (config
// .medhaIdBaseUrl, NOT amberAgentBaseUrl) and emits an explicit `complete`
// frame, so we end on that rather than only inferring completion from EOF.

export type ChatIntent = 'chat' | 'network_query' | 'both';

// A contact the backend can't resolve unambiguously — shown as a tappable card
// so the user can pick which "Victor" (or whoever) is meant.
export type ClarifyCandidate = { id: string; name: string };

// A web source backing the answer (Perplexity-style source chip).
export type WebSource = { title: string; url: string };

// A real, checkable person found on the open web — parsed from their LinkedIn profile
// page rather than summarized by a model, so every field is something that page
// actually said. Rendered as a card with a working link, because "here are five VPs"
// with nothing to open is not an answer.
export type WebPerson = {
  name: string;
  workEmail?: string | null;
  personalEmail?: string | null;
  phone?: string | null;
  title: string | null;
  company: string | null;
  url: string;
  snippet: string | null;
  /**
   * SET WHEN THIS PROFILE IS SOMEBODY THE USER ALREADY HAS.
   *
   * "Since I already have that contact, it should just be shown to me as
   *  something I already have" -- not as a stranger with an add button, which is
   * an offer to duplicate a card that already exists. The server matches the
   * profiles against the address book strictly (full name, with the company
   * breaking a tie between two contacts of the same name) and marks the ones it
   * is sure of; see lib/web-people-known.js.
   */
  existingContactId?: string | null;
  existingContactName?: string | null;
};

// A tappable call-to-action the backend suggests after an answer. Discriminated
// on `type` so the UI can fire the right action (new query / draft / follow-up).
export type Suggestion =
  | { type: 'connect_people'; label: string; query: string }
  | { type: 'draft_message'; label: string; contactId: string; name: string }
  | { type: 'follow_up'; label: string; prompt: string }
  // Offered when a people search finds nothing in the user's own contacts. Tapping
  // it re-asks the SAME question with forceWeb, so the answer comes from the open
  // web instead. Carries the original query so nothing has to be retyped.
  | { type: 'web_search'; label: string; query: string }
  // Hand THIS answer to a circle or a person. No payload: the note it shares is
  // the conversation the chip is attached to, and the audience is picked in the
  // sheet it opens.
  | { type: 'share_note'; label: string }
  // Draft a cold approach to someone the answer NAMED but who is not in the user's
  // contacts. Distinct from draft_message, which requires a real contactId and so
  // could never act on a person surfaced off the web.
  | { type: 'draft_outreach'; label: string; prompt: string; name?: string }
  // A deeper web pass on what was just found. Carries forceWeb when tapped, so a
  // research follow-up cannot get re-routed into a search of the user's contacts.
  | { type: 'research_web'; label: string; prompt: string }
  // Make a circle for the people this turn is about. A plan naming three friends had
  // no route to becoming a group: the user had to leave, open Circles, create one and
  // re-add everybody by hand. Carries the ids so the sheet opens pre-filled.
  | { type: 'create_circle'; label: string; contactIds: string[]; name?: string }
  // Record something ABOUT a person (draft_message writes TO them).
  | { type: 'add_note'; label: string; contactId: string; name?: string };

/**
 * A venue card. Ratings, review counts and opening hours are ALWAYS null today and
 * the card renders those rows only when present — the server deliberately refuses to
 * extract them from scraped pages, because a star rating lifted out of page text is
 * a number nobody double-checks and frequently wrong. Wiring the Google Places API
 * later fills these in with no change here.
 */
export type Place = {
  name: string;
  /** What it is, in the question's own terms: "Thai", "Public library",
   *  "Coworking", "Head office". Supersedes `cuisine`, which is kept so a card
   *  from an older server response still renders. */
  category?: string | null;
  cuisine?: string | null;
  neighborhood?: string | null;
  address?: string | null;
  url?: string | null;
  blurb?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  hours?: string | null;
};

/**
 * One labeled section of an answer's people.
 *
 * `note` is the sentence from the answer that explains the section, so the cards
 * sit under the prose that placed them instead of under a bare heading.
 */
export type AnswerGroup = {
  label: string;
  note?: string;
  people: { id: string; name: string }[];
};

/** One step of a multi-part answer, named before the work starts. */
/**
 * One part of a multi-part answer.
 *
 * `ask` is the clause of the user's own question that this part answers, quoted
 * rather than paraphrased. It is what lets three sections on screen say which
 * question each of them is answering -- "it should be clearly separated out so
 * the user can say: okay, this is the answer to that question."
 */
export type PlanStep = { key: string; label: string; ask?: string };

export type ChatEvent =
  | { type: 'meta'; conversationId: string }
  // WHERE THE RECORDING OF WHAT WAS JUST SAID GOES.
  //
  // A spoken follow-up is uploaded after the turn is already under way, and the
  // clip attaches to the MESSAGE. The row's id is a bigserial the client cannot
  // guess, so the server hands it back the moment it exists rather than making
  // the app re-read the thread to work out which row is its own.
  | { type: 'user_message'; conversationId: string; messageId: string }
  // WHETHER THE ANSWER IS IN THE DATABASE, said out loud at the end of a turn.
  //
  // An answer that rendered and then vanished on reopen is the worst failure
  // this app has: the server's write failed and the client had already dropped
  // its copy. `saved: false` tells the client to trust its own copy instead of
  // going back to a server that has nothing. Sent on every turn, because "no
  // news" is indistinguishable from a dropped frame.
  | { type: 'persisted'; conversationId: string; messageId: string | null; saved: boolean }
  // WHAT THIS ANSWER IS MADE OF, sent before any of it is done. Only on a
  // question with more than one retrieval in it -- "coffee shops, who I know
  // nearby, and VPs of engineering to email" is three, and it used to arrive as
  // one long silence.
  | { type: 'plan'; steps: PlanStep[]; note?: string }
  // A step starting or finishing, or a plain note about the wait. This is what
  // lets the UI show a checklist and a bar instead of a spinner.
  | { type: 'stage'; key: string; label?: string; state: 'start' | 'done' | 'note'; note?: string }
  | { type: 'intent'; intent: ChatIntent }
  | { type: 'token'; text: string }
  // `total` is how many contacts MATCHED, which is not how many were sent: the
  // server pages. Without it the UI cannot honestly say "3 of 47".
  | { type: 'people'; people: unknown[]; citations: unknown[]; total?: number }
  | { type: 'sources'; sources: WebSource[] }
  | { type: 'web_people'; people: WebPerson[] }
  | { type: 'suggestions'; suggestions: Suggestion[] }
  | { type: 'places'; places: Place[] }
  // People split into the labeled sections the answer itself uses. Absent on
  // most turns; the flat list is the correct rendering when it is.
  | { type: 'groups'; groups: AnswerGroup[] }
  | { type: 'complete'; conversationId?: string; intent?: ChatIntent; tookMs?: number }
  | { type: 'error'; error?: string; message?: string }
  | { type: 'clarify'; question: string; candidates: ClarifyCandidate[]; pendingId?: string }
  | {
      type: 'soft_confirm';
      question: string;
      contact: { id: string; name: string };
      pendingId?: string;
    }
  | { type: 'captured'; captured: CapturedItem[] };

// One thing Amber logged this turn: a fact/note/experience filed to a person.
export type CapturedItem = {
  contactId: string | null;
  name: string | null;
  text: string | null;
  route: string;
  participantNames: string[] | null;
  // Everyone this capture landed on. Used to drop them from the suggestion list
  // below, so a person shown as LOGGED is not also offered as a card.
  participantIds: string[];
  // A fact about the owner. Has no contact by design, and is labeled "You"
  // rather than falling back to "Someone".
  isSelf: boolean;
};

/**
 * One shape for a capture, wherever it arrives from.
 *
 * This lived inline in the `captured` stream event, which meant it only existed
 * for a LIVE turn. The same payload is also persisted on the announce message
 * (metadata.capturedOutcomes) so that reopening a note can show what was filed
 * -- and with no shared normalizer, the replay path had nothing to call and the
 * LOGGED cards simply did not come back. Exported so both paths produce
 * identical items.
 */
export function normalizeCaptured(raw: unknown): CapturedItem[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({
      contactId: c.contactId != null ? String(c.contactId) : null,
      name: c.name != null ? String(c.name) : null,
      text: c.text != null ? String(c.text) : null,
      route: String(c.route ?? ''),
      participantNames: Array.isArray(c.participantNames)
        ? c.participantNames.map((n) => String(n))
        : null,
      participantIds: Array.isArray(c.participantIds) ? c.participantIds.map((n) => String(n)) : [],
      isSelf: c.isSelf === true,
    }));
}

type StreamChatOptions = {
  // Pass the conversationId from a prior `meta`/`complete` to continue the same
  // server-side thread (multi-turn memory). Omit to start a fresh conversation.
  conversationId?: string;
  // When the user taps a clarify candidate card, send its id so the backend
  // resolves the ambiguity directly instead of re-running contact matching.
  clarifyContactId?: string;
  // The pendingId from the clarify/soft_confirm event — pins the resolve to the
  // exact pending item rather than the backend's most-recent fallback.
  pendingId?: string;
  // "soundboard" tells the backend this came from the voice surface, so it
  // replies short and action-first instead of in long conversational prose.
  source?: 'soundboard';
  // Answer this from the open web. Set when the user taps the "Search the web"
  // chip, and it bypasses the server's intent router entirely — the question is
  // not in doubt, and skipping that hop is roughly 400ms off the reply.
  forceWeb?: boolean;
  /**
   * TRUE WHEN THIS IS A FOLLOW-UP INSIDE SOMETHING ALREADY OPEN.
   *
   * "Follow-ups inside of chats do not need to be logged. If it's typed
   * directly on the homepage or directly on the profile page, or if it's
   * voiced, then those should show up." A follow-up is a question, and the
   * server's capture pipeline spends about three seconds of the answer's
   * latency proving that a question contains no facts -- and occasionally
   * decides it does, filing something invented against a real person.
   *
   * Set by ChatContext whenever the thread already has turns, so the first
   * thing said in a thread still captures and everything after it does not.
   */
  followUp?: boolean;
  signal?: AbortSignal;
  onEvent: (e: ChatEvent) => void;
};

// Guard against an upstream that streams without a frame delimiter: stop rather
// than letting the buffer grow unbounded.
const MAX_BUFFER_BYTES = 256 * 1024;

export async function streamChat(message: string, opts: StreamChatOptions): Promise<void> {

  if (opts.signal?.aborted) return;
  const token = await getFreshAccessToken();
  if (opts.signal?.aborted) return;
  if (!token) {
    opts.onEvent({ type: 'error', error: 'no_session', message: 'Sign in to continue.' });
    return;
  }

  if (!await ensureProcessingConsent('ai', opts.signal)) {
    opts.onEvent({ type: 'error', error: 'processing_consent_required', message: 'AI processing is not enabled. Your note is still saved.' });
    return;
  }

  if (opts.signal?.aborted) return;
  let res: Awaited<ReturnType<typeof expoFetch>>;
  try {
    res = await expoFetch(`${config.medhaIdBaseUrl}/v1/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        message,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
        ...(opts.clarifyContactId ? { clarifyContactId: opts.clarifyContactId } : {}),
        ...(opts.pendingId ? { pendingId: opts.pendingId } : {}),
        ...(opts.source ? { source: opts.source } : {}),
        ...(opts.forceWeb ? { forceWeb: true } : {}),
        ...(opts.followUp ? { followUp: true } : {}),
      }),
      signal: opts.signal,
    });
  } catch (e: unknown) {
    // A caller-initiated abort (new submit, new chat, unmount) is a clean
    // cancel, never an error bubble.
    const aborted =
      (e instanceof Error && e.name === 'AbortError') || opts.signal?.aborted === true;
    if (!aborted) opts.onEvent({ type: 'error', error: 'network_error' });
    return;
  }

  if (!res.ok || !res.body) {
    let errBody: { error?: string; message?: string } = {};
    try {
      errBody = (await res.json()) as typeof errBody;
    } catch {
      /* non-JSON error body */
    }
    opts.onEvent({
      type: 'error',
      error: errBody.error ?? `http_${res.status}`,
      message: errBody.message,
    });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Inactivity watchdog: if the stream goes silent (no frame) for too long, the
  // UI would otherwise sit on "Thinking…" forever. Cancel the reader so the loop
  // ends and we surface a retryable error instead of wedging.
  const IDLE_MS = 30000;
  let idledOut = false;
  // WHETHER THE TURN WAS EVER TERMINATED, and this is the whole of the
  // "Thinking… forever" bug.
  //
  // `if (done) break;` treated EOF-without-`complete` as a normal ending and
  // emitted NOTHING, so the caller's turn stayed `status: 'loading'` for the
  // rest of the app's life. That is not a rare path: the heartbeat keeps the
  // socket alive so the idle watchdog never fires, and every real-world way a
  // phone loses a long stream — backgrounded app, a lift change, a carrier
  // hiccup, the server ending after its own hard deadline with the client
  // already gone — arrives here as a clean EOF.
  //
  // Every exit from the loop below now terminates the turn exactly once.
  let sawComplete = false;
  let sawToken = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const bumpIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idledOut = true;
      reader.cancel().catch(() => {});
    }, IDLE_MS);
  };

  // Wrapped so the two flags are set wherever a frame is parsed, rather than
  // being maintained in two places in the parser below.
  const emit = (e: ChatEvent) => {
    if (e.type === 'complete') sawComplete = true;
    if (e.type === 'token' && e.text) sawToken = true;
    if (e.type === 'error') sawComplete = true; // terminated, just not happily
    opts.onEvent(e);
  };

  try {
    bumpIdle();
    while (true) {
      const { value, done } = await reader.read();
      // Our endpoint sends an explicit `complete` frame; EOF without one just
      // means the stream tailed off. Either way we stop.
      if (done) break;
      bumpIdle();
      buffer += decoder.decode(value, { stream: true });

      let frameEnd = buffer.indexOf('\n\n');
      while (frameEnd !== -1) {
        handleFrame(buffer.slice(0, frameEnd), emit);
        buffer = buffer.slice(frameEnd + 2);
        frameEnd = buffer.indexOf('\n\n');
      }

      if (buffer.length > MAX_BUFFER_BYTES) {
        opts.onEvent({
          type: 'error',
          error: 'stream_overflow',
          message: 'The response stream was malformed.',
        });
        break;
      }
    }
    if (idledOut) {
      opts.onEvent({
        type: 'error',
        error: 'timeout',
        message: 'That took too long. Tap to try again.',
      });
    } else if (!sawComplete) {
      // THE STREAM ENDED WITHOUT SAYING SO.
      //
      // Two different situations, and they need different endings:
      //
      //   text already on screen  -> the answer is there and only the closing
      //       frame was lost. Synthesising `complete` settles the turn with what
      //       the user can already read, instead of throwing an error bubble over
      //       a perfectly good answer.
      //
      //   nothing on screen       -> a real failure, and the caller gets a
      //       retryable error rather than an eternal spinner. `stream_ended` is
      //       its own code so ChatContext can try to recover the reply the server
      //       may well have finished writing without us.
      if (sawToken) {
        opts.onEvent({ type: 'complete' });
      } else {
        opts.onEvent({
          type: 'error',
          error: 'stream_ended',
          message: 'That answer did not come back. Tap to try again.',
        });
      }
    }
  } catch (e: unknown) {
    const aborted =
      (e instanceof Error && e.name === 'AbortError') || opts.signal?.aborted === true;
    if (!aborted && !idledOut) opts.onEvent({ type: 'error', error: 'network_error' });
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
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

// Parse one SSE frame (`event:` + one or more `data:` lines) into a typed
// ChatEvent. Mirrors lib/agent.ts's handleFrame: multiple data lines join with
// newlines per the SSE spec; comment lines (`:`) are ignored.
function handleFrame(frame: string, emit: (e: ChatEvent) => void): void {
  const lines = frame.split('\n');
  let eventName = '';
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5));
  }
  const dataRaw = dataLines.join('\n').trim();
  if (!eventName) return;

  let payload: Record<string, unknown> = {};
  if (dataRaw) {
    try {
      payload = JSON.parse(dataRaw) as Record<string, unknown>;
    } catch {
      return; // ignore an unparseable frame rather than crash the stream
    }
  }

  switch (eventName) {
    case 'meta':
      emit({ type: 'meta', conversationId: String(payload.conversationId ?? '') });
      return;
    case 'user_message': {
      const messageId = String(payload.messageId ?? '');
      if (!messageId) return;
      emit({
        type: 'user_message',
        conversationId: String(payload.conversationId ?? ''),
        messageId,
      });
      return;
    }
    case 'persisted':
      emit({
        type: 'persisted',
        conversationId: String(payload.conversationId ?? ''),
        messageId: payload.messageId == null ? null : String(payload.messageId),
        saved: payload.saved === true,
      });
      return;
    case 'intent':
      emit({ type: 'intent', intent: (payload.intent as ChatIntent) ?? 'chat' });
      return;
    case 'token':
      // Prefer `text`; tolerate `delta` for forward-compat with the agent shape.
      emit({ type: 'token', text: String(payload.text ?? payload.delta ?? '') });
      return;
    case 'people':
      emit({
        type: 'people',
        people: Array.isArray(payload.people) ? payload.people : [],
        citations: Array.isArray(payload.citations) ? payload.citations : [],
        total: typeof payload.total === 'number' ? payload.total : undefined,
      });
      return;
    case 'captured': {
      emit({ type: 'captured', captured: normalizeCaptured(payload.captured) });
      return;
    }
    case 'sources':
      emit({ type: 'sources', sources: normalizeSources(payload.sources) });
      return;
    case 'web_people':
      emit({ type: 'web_people', people: normalizeWebPeople(payload.people) });
      return;
    case 'plan': {
      const steps = Array.isArray(payload.steps)
        ? payload.steps
            .map((raw) => {
              const st = (raw ?? {}) as Record<string, unknown>;
              const key = typeof st.key === 'string' ? st.key : '';
              const label = typeof st.label === 'string' ? st.label : '';
              const ask = typeof st.ask === 'string' && st.ask.trim() ? st.ask.trim() : undefined;
              if (!key || !label) return null;
              const step: PlanStep = ask ? { key, label, ask } : { key, label };
              return step;
            })
            .filter((s): s is PlanStep => !!s)
        : [];
      if (steps.length > 0) {
        emit({
          type: 'plan',
          steps,
          note: typeof payload.note === 'string' ? payload.note : undefined,
        });
      }
      return;
    }
    case 'stage': {
      const key = typeof payload.key === 'string' ? payload.key : '';
      const state = payload.state === 'done' || payload.state === 'note' ? payload.state : 'start';
      if (!key) return;
      emit({
        type: 'stage',
        key,
        state,
        label: typeof payload.label === 'string' ? payload.label : undefined,
        note: typeof payload.note === 'string' ? payload.note : undefined,
      });
      return;
    }
    case 'places':
      emit({ type: 'places', places: normalizePlaces(payload.places) });
      break;
    case 'groups': {
      const groups = normalizeGroups(payload.groups);
      if (groups.length > 0) emit({ type: 'groups', groups });
      return;
    }
    case 'suggestions':
      emit({ type: 'suggestions', suggestions: normalizeSuggestions(payload.suggestions) });
      return;
    case 'complete':
      emit({
        type: 'complete',
        conversationId: payload.conversationId ? String(payload.conversationId) : undefined,
        intent: payload.intent as ChatIntent | undefined,
        tookMs: typeof payload.tookMs === 'number' ? payload.tookMs : undefined,
      });
      return;
    case 'error':
      emit({
        type: 'error',
        error: payload.error ? String(payload.error) : undefined,
        message: payload.message ? String(payload.message) : undefined,
      });
      return;
    case 'clarify': {
      const rawCandidates = Array.isArray(payload.candidates) ? payload.candidates : [];
      const candidates: ClarifyCandidate[] = rawCandidates
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map((c) => ({ id: String(c.id ?? ''), name: String(c.name ?? '') }))
        .filter((c) => c.id);
      const pendingId = payload.pendingId != null ? String(payload.pendingId) : undefined;
      emit({ type: 'clarify', question: String(payload.question ?? ''), candidates, pendingId });
      return;
    }
    case 'soft_confirm': {
      const raw = payload.contact;
      const contact =
        raw && typeof raw === 'object'
          ? {
              id: String((raw as Record<string, unknown>).id ?? ''),
              name: String((raw as Record<string, unknown>).name ?? ''),
            }
          : { id: '', name: '' };
      if (!contact.id) return; // drop malformed frame
      const pendingId = payload.pendingId != null ? String(payload.pendingId) : undefined;
      emit({ type: 'soft_confirm', question: String(payload.question ?? ''), contact, pendingId });
      return;
    }
  }
}

// Coerce the raw `sources` payload into WebSource[], dropping anything without a
// usable url (the title falls back to the url so a chip is never blank).
function normalizeSources(raw: unknown): WebSource[] {
  if (!Array.isArray(raw)) return [];
  const out: WebSource[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const s = item as { title?: unknown; url?: unknown };
    const url = typeof s.url === 'string' ? s.url.trim() : '';
    if (!url) continue;
    const title = typeof s.title === 'string' && s.title.trim() ? s.title.trim() : url;
    out.push({ title, url });
  }
  return out;
}

// Coerce the raw `web_people` payload. A card with no name or no link is not a card —
// the whole point is that it can be opened and checked — so both are required and
// anything else is dropped rather than rendered half-empty.
function normalizeWebPeople(raw: unknown): WebPerson[] {
  if (!Array.isArray(raw)) return [];
  const out: WebPerson[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    const url = typeof p.url === 'string' ? p.url.trim() : '';
    if (!name || !/^https?:\/\//i.test(url)) continue;
    const str = (k: string) =>
      typeof p[k] === 'string' && (p[k] as string).trim() ? (p[k] as string).trim() : null;
    out.push({
      name,
      url,
      title: str('title'),
      company: str('company'),
      snippet: str('snippet'),
      // Carried through so the card can be drawn as somebody he already has
      // rather than as a stranger to add.
      workEmail: str('workEmail'),
      personalEmail: str('personalEmail'),
      phone: str('phone'),
      existingContactId: str('existingContactId'),
      existingContactName: str('existingContactName'),
    });
  }
  return out;
}

// A place needs a name to be a card; everything else is optional and simply not
// rendered when missing. `url` is validated to http(s) here as well as on the server,
// because this value goes straight to Linking.openURL.
function normalizePlaces(raw: unknown): Place[] {
  if (!Array.isArray(raw)) return [];
  const out: Place[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    if (!name) continue;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const url = str(p.url);
    out.push({
      name,
      category: str(p.category) ?? str(p.cuisine),
      cuisine: str(p.cuisine),
      neighborhood: str(p.neighborhood),
      address: str(p.address),
      url: url && /^https?:\/\//i.test(url) ? url : null,
      blurb: str(p.blurb),
      rating: typeof p.rating === 'number' ? p.rating : null,
      reviewCount: typeof p.reviewCount === 'number' ? p.reviewCount : null,
      hours: str(p.hours),
    });
    if (out.length >= 6) break;
  }
  return out;
}

// Coerce the raw `suggestions` payload into Suggestion[], keeping only the known
// types with their required fields present (drop malformed entries).
/**
 * Trust nothing: a group with no label or no real people is not renderable, and
 * a section list with fewer than two sections is the flat list with extra steps.
 * Returns [] rather than a partial, so the caller keeps the flat list.
 */
export function normalizeGroups(raw: unknown): AnswerGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: AnswerGroup[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const g = item as Record<string, unknown>;
    const label = typeof g.label === 'string' ? g.label.trim() : '';
    if (!label) continue;
    const people: { id: string; name: string }[] = [];
    for (const p of Array.isArray(g.people) ? g.people : []) {
      if (!p || typeof p !== 'object') continue;
      const person = p as Record<string, unknown>;
      const id = person.id != null ? String(person.id).trim() : '';
      const name = typeof person.name === 'string' ? person.name.trim() : '';
      // A person shown under two headings reads as two people.
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      people.push({ id, name });
    }
    if (people.length === 0) continue;
    const note = typeof g.note === 'string' && g.note.trim() ? g.note.trim() : undefined;
    out.push(note ? { label, note, people } : { label, people });
  }
  return out.length > 1 ? out : [];
}

function normalizeSuggestions(raw: unknown): Suggestion[] {
  if (!Array.isArray(raw)) return [];
  const out: Suggestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    const label = typeof s.label === 'string' ? s.label.trim() : '';
    if (!label) continue;
    if (s.type === 'connect_people' && typeof s.query === 'string' && s.query.trim()) {
      out.push({ type: 'connect_people', label, query: s.query.trim() });
    } else if (
      s.type === 'draft_message' &&
      typeof s.contactId === 'string' &&
      s.contactId.trim() &&
      typeof s.name === 'string' &&
      s.name.trim()
    ) {
      out.push({
        type: 'draft_message',
        label,
        contactId: s.contactId.trim(),
        name: s.name.trim(),
      });
    } else if (s.type === 'follow_up' && typeof s.prompt === 'string' && s.prompt.trim()) {
      out.push({ type: 'follow_up', label, prompt: s.prompt.trim() });
    } else if (s.type === 'web_search' && typeof s.query === 'string' && s.query.trim()) {
      out.push({ type: 'web_search', label, query: s.query.trim() });
    } else if (s.type === 'share_note') {
      out.push({ type: 'share_note', label });
    } else if (s.type === 'create_circle' && Array.isArray(s.contactIds)) {
      const ids = s.contactIds.map((v) => String(v)).filter(Boolean);
      // Two or more, or it is not a circle — one person is a conversation. Enforced
      // on both sides so a malformed payload cannot render a dead chip.
      if (ids.length >= 2) {
        out.push({
          type: 'create_circle',
          label,
          contactIds: ids,
          name: typeof s.name === 'string' ? s.name.trim() : undefined,
        });
      }
    } else if (s.type === 'add_note' && typeof s.contactId === 'string' && s.contactId.trim()) {
      out.push({
        type: 'add_note',
        label,
        contactId: s.contactId.trim(),
        name: typeof s.name === 'string' ? s.name.trim() : undefined,
      });
    } else if (s.type === 'draft_outreach' && typeof s.prompt === 'string' && s.prompt.trim()) {
      out.push({
        type: 'draft_outreach',
        label,
        prompt: s.prompt.trim(),
        name: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : undefined,
      });
    } else if (s.type === 'research_web' && typeof s.prompt === 'string' && s.prompt.trim()) {
      out.push({ type: 'research_web', label, prompt: s.prompt.trim() });
    }
  }
  return out;
}
