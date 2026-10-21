import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as Haptics from 'expo-haptics';
import {
  streamChat,
  normalizeGroups,
  type AnswerGroup,
  type ChatIntent,
  type ClarifyCandidate,
  type Suggestion,
  type Place,
  type PlanStep,
  type WebSource,
  type WebPerson,
  normalizeCaptured,
  type CapturedItem,
} from './chat';
import {
  ingestPeople,
  prefetchTopPeople,
  type PeopleRankResult,
} from './peoplerank';
import { useQueryClient } from '@tanstack/react-query';
import { getConversation } from './conversations';
import { resolvePending, declinePending, markPendingAnswered } from './pending';
import { medhaIdErrorCopy } from './medhaId';
import { toast } from './toast';
import { openShareForNote } from './shareBridge';
import { publishLiveTurn } from './liveTurn';
import { attachPendingNoteConversation } from './pendingNote';
import { useReducedMotion } from '../components/useReducedMotion';
import { takeMessageClip } from './pendingMessageClip';
import { cacheTurn, cachedAnswerFor } from './turnCache';
import { uploadMessageAudio } from './noteMedia';

export type Turn = {
  id: string;
  query: string;
  /**
   * THIS TURN'S QUESTION WAS SPOKEN, AND HERE IS THE RECORDING.
   *
   * A spoken follow-up keeps its audio alongside its transcript: the words are
   * the message, the clip is what was actually said. `messageId` is the
   * conversation_messages row the clip hangs off -- the player mints its own
   * short-lived signed URL from it, which is why no URL is held here.
   *
   * durationMs and peaks are known locally the instant the recording stops, so
   * the player draws immediately rather than after a round trip.
   */
  audio?: { messageId: string; durationMs: number; peaks: number[] };
  result: PeopleRankResult | null;
  status: 'loading' | 'done' | 'error';
  errorMsg?: string;
  sources?: WebSource[];
  /** Venue cards on a planning turn. See components/PlaceCard for why ratings and
   *  hours are absent today. */
  places?: Place[];
  /**
   * People split into LABELED SECTIONS instead of one flat list.
   *
   * An answer that says "these two for the raise, these four to catch up with"
   * needs the cards to sit under the sentence they belong to; one undifferentiated
   * list makes the prose above it a lie. Rendered in order, in place of the flat
   * list, with the section text between the heading and its cards.
   */
  groups?: {
    label: string;
    note?: string;
    people: { id: string; name: string }[];
    /** Actions belonging to THIS section, shown under its cards. */
    chips?: Suggestion[];
  }[];
  /** One line above the venue cards, explaining what they are. */
  placesNote?: string;
  webPeople?: WebPerson[];
  suggestions?: Suggestion[];
  // True only for turns rebuilt from server history (openConversation). Those
  // arrive complete, so the renderer may animate them in; a turn that streamed
  // live must NOT animate, because its reveal was already paced by the
  // typewriter and re-animating it would blank the finished text.
  replayed?: boolean;
  clarify?: { question: string; candidates: ClarifyCandidate[]; pendingId?: string }[];
  softConfirm?: { question: string; contact: { id: string; name: string }; pendingId?: string }[];
  // What Amber logged this turn — one confirmation card per person.
  captured?: CapturedItem[];
  /** Contacts that matched in total. May exceed result.people.length — the server pages. */
  peopleTotal?: number;
  // True for turns that originated from a Home voice note (or a resolution of
  // one). The dim disambiguation overlay on Home only surfaces clarify /
  // soft-confirm for these, so it never fights the inline cards in the Ask view.
  fromHome?: boolean;
  /**
   * WHAT THIS ANSWER IS MADE OF, and how far along each part is.
   *
   * Only on a question with more than one retrieval in it. `plan` names the
   * steps before any of them run; `stages` is each step's state as the server
   * reports it; `stageNote` is the current line about the wait ("multi-step
   * answer, working through it in parts").
   *
   * This exists because the honest answer to "why is it still thinking" is a
   * list of what it is doing, and the app had no way to say it.
   */
  plan?: PlanStep[];
  planNote?: string;
  stages?: Record<string, 'start' | 'done'>;
  stageNote?: string;
};

// One reveal tick. Was 12ms at 1 char/tick (~83 chars/s), which read as
// sluggish next to Claude/ChatGPT. 8ms at 3 chars/tick is ~375 chars/s — fast
// and clean, while still a visible left-to-right reveal rather than a wipe.
// Kept as a timer rather than dropping the typewriter entirely because the
// ranker arrives in ~3 coarse bursts, which would otherwise read as 3 jumps.
const DRAIN_TICK_MS = 8;

// Characters per tick at an empty backlog. The adaptive scaling below raises it
// when the buffer builds, so this is the floor, not the rate.
const DRAIN_CHARS_MIN = 3;

// Ceiling on chars per tick. Raised with the faster base so a long answer still
// catches up without the reveal degrading into an instant paste.
const DRAIN_CHARS_MAX = 24;

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// What the transcript should do when a scroll is requested.
//
// 'anchorLastTurn' pins the newest turn's question to the TOP of the viewport so
// it stays readable with its answer growing beneath it. 'end' jumps to the
// bottom, which is only right when restoring a finished conversation.
//
// The distinction is the whole fix for "my query jumps off the top": every
// request used to mean scrollToEnd, so the moment a long answer finished it
// scrolled past the question that produced it.
export type ScrollIntent = 'anchorLastTurn' | 'end';

export type ScrollRequest = {
  /** Increments on every request so the consumer's effect re-fires. */
  tick: number;
  intent: ScrollIntent;
};

type ChatContextValue = {
  turns: Turn[];
  query: string;
  setQuery: (q: string) => void;
  streaming: boolean;
  scrollRequest: ScrollRequest;
  runSearch: (
    override?: string,
    clarifyContactId?: string,
    pendingId?: string,
    source?: 'soundboard',
    fromHome?: boolean,
    /** Answer from the open web instead of the user's own people. */
    forceWeb?: boolean,
  ) => Promise<void>;
  resetChat: () => void;
  onStop: () => void;
  openConversation: (conversationId: string) => Promise<void>;
  /** Show a turn that streamed in ANOTHER provider. See lib/liveTurn. */
  adoptLiveTurn: (turn: Turn) => void;
  onSuggestion: (s: Suggestion) => void;
  onClarify: (turnId: string, candidate: ClarifyCandidate, pendingId?: string) => void;
  onSoftConfirmYes: (turnId: string, contact: { id: string; name: string }, pendingId?: string) => void;
  onSoftConfirmNo: (turnId: string, pendingId?: string) => void;
  overlayOpen: boolean;
  openOverlay: () => void;
  closeOverlay: () => void;
  // Bumped after a home voice note is captured, so the Today feed refetches and
  // the new note shows without a remount.
  homeNoteVersion: number;
  notifyHomeNote: () => void;
  // The conversation/note id of the stream that most recently ran. Available
  // after runSearch()'s promise resolves, so a caller (e.g. the home voice
  // capture) can apply a share scope to the note it just created.
  getConversationId: () => string | undefined;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({
  children,
  // OPT IN, because publishing is only useful from the tree that owns voice-note
  // capture. Home sets it. If every provider published, the overlay's own provider
  // would announce the turn it is already rendering and re-render itself once per
  // token for nothing — and worse, two providers would take turns overwriting one
  // slot with the same conversation's state.
  publishLive = false,
  searchMode = false,
}: {
  children: ReactNode;
  publishLive?: boolean;
  searchMode?: boolean;
}) {
  const reduceMotion = useReducedMotion();

  const [query, setQuery] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest>({ tick: 0, intent: 'end' });
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [homeNoteVersion, setHomeNoteVersion] = useState(0);
  const notifyHomeNote = useCallback(() => setHomeNoteVersion((n) => n + 1), []);
  // Used on `captured` to invalidate everything a capture makes stale. Without it,
  // a new voice memo only showed up in Recently mentioned after a force-quit.
  const qc = useQueryClient();

  const requestId = useRef(0);
  // How many turns this thread holds, kept in a ref so `runSearch` can read it
  // without being re-created on every turn (see the followUp note below).
  const turnCountRef = useRef(0);
  // The newest turns, readable from inside the stream callbacks without making
  // them depend on `turns` (which changes on every token). Used by the turn
  // cache, which has to snapshot what the finished turn actually holds.
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;
  // The conversation_messages id of the user message for the turn in flight, as
  // soon as the server hands it back. Null until then, and for a turn whose row
  // never got written.
  const userMessageIdRef = useRef<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  // Drain-buffer typewriter. Tokens land in `pending`; a timer moves characters
  // into `revealed` at a steady cadence, and only `revealed` is ever written to
  // the turn. The ranker emits coarse deltas (~3 chunks of ~40 chars over ~2s),
  // so rendering raw token text reads as three jumps rather than typing — this
  // turns bursty arrival into an even stream.
  const tw = useRef({
    turnId: '',
    query: '',
    pending: '',
    revealed: '',
    timer: null as ReturnType<typeof setInterval> | null,
  });
  const lastSubmitAt = useRef(0);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const intentRef = useRef<ChatIntent | undefined>(undefined);

  const requestScroll = useCallback(
    (intent: ScrollIntent) => setScrollRequest((p) => ({ tick: p.tick + 1, intent })),
    [],
  );

  const updateTurn = useCallback((turnId: string, updater: (t: Turn) => Partial<Turn>) => {
    setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, ...updater(t) } : t)));
  }, []);

  /**
   * GO AND GET THE ANSWER THE SERVER FINISHED WITHOUT US.
   *
   * Called when a stream dies with nothing on screen. The chat route keeps
   * generating and writes the assistant turn to the conversation whether or not
   * the client is still listening, so the reply usually lands a second or two
   * after the pipe broke — and the difference between "Amber lost your answer"
   * and "here it is" is one GET.
   *
   * Two tries, 1.5s and 5s, because the write happens when generation ENDS and
   * the drop can happen at any point before that. Silent on failure: the error
   * bubble is already on screen and this only ever upgrades it.
   */
  const recoverTurn = useCallback(
    async (turnId: string, conversationId: string, forRequest: number) => {
      for (const delay of [1500, 3500]) {
        await new Promise((r) => setTimeout(r, delay));
        // A newer question was asked, or the user closed the surface: stop.
        if (forRequest !== requestId.current) return;
        const res = await getConversation(conversationId).catch(() => null);
        if (!res?.ok) continue;
        const msgs = res.data?.messages ?? [];
        // The newest Amber turn, and only if it has words. 'amber' is the
        // column's own spelling -- see ConversationMessage.
        const reply = [...msgs]
          .reverse()
          .find(
            (m) =>
              (m.role === 'assistant' || m.role === 'amber') &&
              typeof m.content === 'string' &&
              m.content.trim().length > 0,
          );
        if (!reply) continue;
        if (forRequest !== requestId.current) return;
        const meta = (reply.metadata ?? {}) as Record<string, unknown>;
        updateTurn(turnId, (t) => ({
          status: 'done',
          errorMsg: undefined,
          // Whatever the turn also produced survives the recovery: the cards
          // are in the persisted metadata for exactly this reason.
          sources: (meta.sources as Turn['sources']) ?? t.sources,
          places: (meta.places as Turn['places']) ?? t.places,
          webPeople: (meta.webPeople as Turn['webPeople']) ?? t.webPeople,
          groups: (normalizeGroups(meta.groups) as Turn['groups']) ?? t.groups,
          result: {
            ...(t.result ?? { people: [], citations: [], query: t.query }),
            answer: reply.content.trim(),
            answerStatus: 'done',
          } as Turn['result'],
        }));
        return;
      }
    },
    [updateTurn],
  );

  // The ref that `runSearch` reads to decide capture-vs-follow-up. One effect
  // rather than a write at each setTurns call site, so it cannot drift.
  useEffect(() => {
    turnCountRef.current = turns.length;
  }, [turns.length]);

  // ANNOUNCE THE STREAMING TURN so a surface in another tree can mirror it.
  //
  // Keyed on `turns` and reading the conversation id from a ref, which is safe
  // because the id arrives on the `meta` event — before the first token, so before
  // any turn update worth publishing. A replayed turn is never announced: it came
  // FROM the server, and re-publishing it would let one surface's history overwrite
  // another's live stream.
  useEffect(() => {
    if (!publishLive) return;
    const cid = conversationIdRef.current;
    if (!cid) return;
    const last = turns[turns.length - 1];
    if (!last || last.replayed) return;
    publishLiveTurn(cid, last);
  }, [turns, publishLive]);

  // SHOW A TURN THAT IS STREAMING SOMEWHERE ELSE.
  //
  // Used by the Home overlay: the note it opens may still be generating in the
  // provider that owns the recording, and the server has nothing to replay until
  // that finishes. Rather than poll, the overlay mirrors the live turn.
  //
  // The three cases, in order:
  //   - Same turn, later state. Always take it — this is the streaming update, and
  //     bailing here once an answer existed would freeze the text mid-sentence.
  //     The persisted question is kept, because a resolution may have corrected a
  //     name in the transcript and the live copy predates that.
  //   - Nothing replayed yet (the user message has not landed either). Adopt it
  //     whole, so an overlay opened a half-second after recording is not blank.
  //   - Replayed history that already has content. Leave it alone: stored history
  //     is authoritative precisely because it reflects corrections.
  const adoptLiveTurn = useCallback((incoming: Turn) => {
    setTurns((prev) => {
      if (prev.length === 0) return [incoming];
      const last = prev[prev.length - 1];
      if (last.id === incoming.id) {
        return [...prev.slice(0, -1), { ...incoming, query: last.query || incoming.query }];
      }
      const lastHasContent =
        !!last.result?.answer ||
        (last.captured?.length ?? 0) > 0 ||
        (last.clarify?.length ?? 0) > 0 ||
        (last.softConfirm?.length ?? 0) > 0;
      if (lastHasContent) return prev;
      return [...prev.slice(0, -1), { ...incoming, query: last.query || incoming.query }];
    });
  }, []);

  // Write the currently-revealed text onto the turn, preserving whatever people /
  // citations the `people` events have already put there.
  const commitRevealed = useCallback(
    (answerStatus: 'streaming' | 'done') => {
      const { turnId, revealed, query: q } = tw.current;
      if (!turnId) return;
      updateTurn(turnId, (t) => ({
        status: 'done',
        result: {
          people: t.result?.people ?? [],
          citations: t.result?.citations ?? [],
          answer: revealed,
          answerStatus,
          query: q,
        },
      }));
    },
    [updateTurn],
  );

  const stopDrain = useCallback(() => {
    if (tw.current.timer) {
      clearInterval(tw.current.timer);
      tw.current.timer = null;
    }
  }, []);

  // Reveal everything still buffered, at once. Used on `complete` and on Stop —
  // the user has been told the answer is finished, so withholding characters
  // behind an animation would be a lie.
  const flushDrain = useCallback(() => {
    stopDrain();
    const c = tw.current;
    if (c.pending) {
      c.revealed += c.pending;
      c.pending = '';
    }
  }, [stopDrain]);

  const startDrain = useCallback(() => {
    if (tw.current.timer) return;
    tw.current.timer = setInterval(() => {
      const c = tw.current;
      if (!c.pending) {
        stopDrain();
        return;
      }
      // Base cadence is DRAIN_CHARS_MIN per tick (~375 chars/s), far ahead of the
      // ranker's ~60 chars/s arrival so the queue always drains. It scales up
      // with the backlog so a long or fast answer never falls behind and starts
      // trailing the stream.
      const n = Math.min(
        DRAIN_CHARS_MAX,
        Math.max(DRAIN_CHARS_MIN, Math.ceil(c.pending.length / 12)),
      );
      c.revealed += c.pending.slice(0, n);
      c.pending = c.pending.slice(n);
      commitRevealed('streaming');
      if (!c.pending) stopDrain();
    }, DRAIN_TICK_MS);
  }, [commitRevealed, stopDrain]);

  const runSearch = useCallback(
    async (
      override?: string,
      clarifyContactId?: string,
      pendingId?: string,
      source?: 'soundboard',
      fromHome?: boolean,
      // Answer from the open web rather than from the user's own people. Only set
      // by the "Search the web" chip — every other path lets the server route.
      forceWeb?: boolean,
    ) => {
      const q = (override ?? query).trim();
      if (!q) return;
      const now = Date.now();
      if (now - lastSubmitAt.current < 250) return;
      lastSubmitAt.current = now;

      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      const id = ++requestId.current;

      const turnId = newId();
      // A new stream owns the typewriter: kill any drain still running for the
      // previous turn and start from empty.
      stopDrain();
      tw.current = { turnId, query: q, pending: '', revealed: '', timer: null };
      setTurns((prev) => [
        // Drop turns that errored out. An error bubble used to sit in the thread
        // permanently, stacked above later successful answers, with no way to
        // dismiss it — a transient network blip left a scar on the conversation.
        ...prev.filter((t) => t.status !== 'error'),
        { id: turnId, query: q, result: null, status: 'loading', fromHome: source === 'soundboard' || !!fromHome },
      ]);
      setQuery('');
      if (!reduceMotion) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      // Pin the question the user just sent to the top of the viewport. The
      // answer then fills in underneath it, so what they asked stays on screen.
      requestScroll('anchorLastTurn');

      await streamChat(searchMode ? `${q}\n\nKeep the answer to 1–3 short sentences, followed by relevant contact cards and two useful follow-up questions. This is a search, not a request to save facts.` : q, {
        conversationId: conversationIdRef.current,
        clarifyContactId,
        pendingId,
        source,
        forceWeb,
        // A FOLLOW-UP, not a capture. Decided by whether this thread already
        // has anything in it: the first thing said in a thread is the voice
        // note or the line typed on Home / on a profile, and that is what
        // belongs on Today. Everything after it in the same thread is a
        // question about what is already there.
        //
        // Read from the ref rather than from `turns`, because this callback is
        // memoized on `query` and would otherwise close over a stale list --
        // which would make the very first follow-up look like a capture.
        followUp: searchMode || turnCountRef.current > 0,
        signal: controller.signal,
        onEvent: (e) => {
          if (id !== requestId.current) return;

          switch (e.type) {
            case 'meta':
              if (e.conversationId) {
                conversationIdRef.current = e.conversationId;
                // Upgrade the optimistic Today card to the real thread as soon as
                // there is one, which is before the first token. Until this lands
                // the card is on screen but not tappable; after it, tapping opens
                // the overlay onto the answer still being written.
                attachPendingNoteConversation(e.conversationId);
              }
              return;
            case 'persisted': {
              // The server says whether the answer is in the database. A `false`
              // here is not an error the user needs to see -- the answer is on
              // screen and the local copy above is what makes it survive -- but
              // it is worth one line in the console when it happens.
              if (!e.saved) {
                console.warn(
                  '[chat] the server did not save this answer; keeping the local copy',
                );
              }
              return;
            }
            case 'user_message': {
              // THE ROW THE RECORDING ATTACHES TO NOW EXISTS.
              //
              // A follow-up said out loud was transcribed on the device and the
              // transcript was sent as the message; the clip has been waiting in
              // lib/pendingMessageClip for the id of the row it belongs to. It is
              // claimed by TEXT, so a question typed while a recording was being
              // transcribed cannot pick up somebody else's audio.
              // Held for the turn cache as well as for the audio upload: the
              // cached copy is keyed to the user message when there is one.
              userMessageIdRef.current = e.messageId;
              const clip = takeMessageClip(q);
              if (!clip) return;
              const cid = e.conversationId || conversationIdRef.current;
              if (!cid) return;
              // Drawn straight away from what the recorder measured, so the
              // player appears with the message rather than after the upload.
              const audio = {
                messageId: e.messageId,
                durationMs: clip.durationMs,
                peaks: clip.peaks,
              };
              setTurns((prev) =>
                prev.map((t) => (t.id === turnId ? { ...t, audio } : t)),
              );
              void uploadMessageAudio(cid, e.messageId, clip.uri, {
                durationMs: clip.durationMs,
                peaks: clip.peaks,
              })
                .then((ok) => {
                  if (ok) return;
                  // THE PLAYER COMES BACK OFF IF THE UPLOAD FAILED. Leaving it
                  // there offers a play button for bytes that are not stored --
                  // the transcript is still the message, which is the part that
                  // matters, so this degrades to exactly what a typed follow-up
                  // looks like rather than to a broken control.
                  setTurns((prev) =>
                    prev.map((t) => (t.id === turnId ? { ...t, audio: undefined } : t)),
                  );
                })
                .catch(() => {});
              return;
            }
            case 'intent':
              intentRef.current = e.intent;
              return;
            case 'token': {
              if (!e.text) return;
              if (reduceMotion) {
                // Animated typing is motion; honor the setting by revealing as
                // the tokens land, with no drain.
                tw.current.revealed += e.text;
                commitRevealed('streaming');
                return;
              }
              tw.current.pending += e.text;
              startDrain();
              return;
            }
            case 'people': {
              const { people, citations } = ingestPeople(e.people, e.citations);
              prefetchTopPeople(people);
              // REPLACE, never append: `people` now fires twice (an early ranked
              // list, then the final done-order with citations), so accumulating
              // would double the list.
              //
              // WITH ONE EXCEPTION, AND IT IS THE ONE THE USER SAW.
              //
              // "A bunch of random contacts flashed and then disappeared…
              //  it missed some contact cards."
              //
              // The first `people` event is the address-book fast-tag: the people
              // this sentence actually NAMED, on screen in a millisecond. The
              // second is the ranked or recalled set, computed from what the turn
              // turned out to be about — and it is allowed to be a different set
              // entirely. Replacing wholesale means a person the user watched
              // appear, because they had just said their name, is deleted a second
              // later by a list that was answering a different question.
              //
              // So a `mentioned` person survives the replace. Everything else is
              // still replaced exactly as before, and a name that comes back in
              // the new list keeps its new position rather than being duplicated.
              updateTurn(turnId, (t) => {
                const incomingIds = new Set(people.map((p) => String(p.id)));
                const keptMentions = (t.result?.people ?? []).filter(
                  (p) => p.kind === 'mentioned' && !incomingIds.has(String(p.id)),
                );
                const merged = keptMentions.length > 0 ? [...people, ...keptMentions] : people;
                return {
                status: 'done',
                // How many matched in total, vs how many were sent. Kept next to
                // the list so the card row can say "3 of 47" and offer the rest
                // instead of presenting a page as the whole answer.
                peopleTotal: e.total ?? merged.length,
                result: {
                  people: merged,
                  citations,
                  answer: t.result?.answer ?? tw.current.revealed,
                  answerStatus: t.result?.answerStatus ?? 'streaming',
                  query: q,
                },
                };
              });
              return;
            }
            case 'plan':
              updateTurn(turnId, () => ({
                plan: e.steps,
                planNote: e.note,
                // Every named step starts as pending, so the checklist is the
                // full shape of the answer from the first frame rather than
                // growing as steps report in.
                stages: Object.fromEntries(e.steps.map((st) => [st.key, 'start' as const])),
              }));
              return;
            case 'stage':
              if (e.state === 'note') {
                updateTurn(turnId, () => ({ stageNote: e.note }));
                return;
              }
              {
                // Narrowed for the compiler and for the reader: 'note' was
                // handled above, so only the two step states reach here.
                const state: 'start' | 'done' = e.state === 'done' ? 'done' : 'start';
                updateTurn(turnId, (t) => ({
                  stages: { ...(t.stages ?? {}), [e.key]: state },
                }));
              }
              return;
            case 'places':
              updateTurn(turnId, () => ({ places: e.places }));
              break;
            case 'groups':
              // Arrives AFTER the flat list and after the answer text, because it
              // is derived from both. The renderer prefers groups when present, so
              // this is the one moment the cards re-lay-out — late enough that the
              // answer is readable, which is the whole point of the sections.
              updateTurn(turnId, () => ({ groups: e.groups }));
              return;
            case 'sources':
              updateTurn(turnId, () => ({ sources: e.sources }));
              return;
            case 'web_people':
              updateTurn(turnId, () => ({ webPeople: e.people }));
              return;
            case 'suggestions':
              updateTurn(turnId, () => ({ suggestions: e.suggestions }));
              return;
            case 'clarify':
              updateTurn(turnId, (t) => ({
                clarify: [
                  ...(t.clarify ?? []),
                  { question: e.question, candidates: e.candidates, pendingId: e.pendingId },
                ],
              }));
              return;
            case 'soft_confirm':
              updateTurn(turnId, (t) => ({
                softConfirm: [
                  ...(t.softConfirm ?? []),
                  { question: e.question, contact: e.contact, pendingId: e.pendingId },
                ],
              }));
              return;
            case 'captured':
              updateTurn(turnId, (t) => ({ captured: [...(t.captured ?? []), ...e.captured] }));
              // EVERYTHING DERIVED FROM A CAPTURE IS NOW STALE, and nothing was
              // telling it so — which is why a new voice memo only appeared in
              // Recently mentioned after force-quitting the app. The capture event
              // is the one moment we know for certain that something was written,
              // so it is the right place to invalidate: the mentions strip, and the
              // card of every person the capture landed on.
              qc.invalidateQueries({ queryKey: ['recentlyMentioned'] });
              for (const c of e.captured) {
                if (!c.contactId) continue;
                qc.invalidateQueries({ queryKey: ['contactFacts', c.contactId] });
                qc.invalidateQueries({ queryKey: ['contact', c.contactId] });
                qc.invalidateQueries({ queryKey: ['contactLive', c.contactId] });
              }
              // And the Today feed, whose card text can change when a capture
              // resolves a name.
              notifyHomeNote();
              return;
            case 'complete': {
              // TODAY REFRESHES WHEN A TURN FINISHES, not only when it captures.
              //
              // "It didn't show up immediately, and they had to reload the page a
              //  couple of times for it to show up."
              //
              // notifyHomeNote() lived only in the `captured` case, so a note that
              // captured nothing — a follow-up, a journal entry, anything the
              // extractor declined — never told the feed it existed. The feed is
              // fetched on homeNoteVersion, so the only way to see the note was to
              // leave the screen and come back. A completed turn is the honest
              // signal that there is a new row to read: it fires once per turn,
              // and the fetch below it does not blank the list.
              notifyHomeNote();
              if (e.conversationId) conversationIdRef.current = e.conversationId;
              if (e.intent) intentRef.current = e.intent;
              // Reveal anything still queued before settling, so `complete` never
              // truncates the answer mid-word.
              flushDrain();
              if (tw.current.revealed) commitRevealed('done');
              else {
                updateTurn(turnId, (t) => ({
                  status: 'done',
                  result: t.result ? { ...t.result, answerStatus: 'done' } : t.result,
                }));
              }
              // KEEP OUR OWN COPY. An answer that rendered has to still be
              // there when the thread is reopened, and "the server saved it"
              // cannot be the only reason it survives -- that write failed once
              // and took a 26-second answer with it. See lib/turnCache.ts.
              {
                const cid = e.conversationId || conversationIdRef.current;
                const finished = tw.current.revealed || '';
                if (cid && finished.trim()) {
                  const t = turnsRef.current.find((x) => x.id === turnId);
                  void cacheTurn(cid, {
                    messageId: userMessageIdRef.current,
                    query: q,
                    answer: finished,
                    // Enough to redraw the turn, in the same shape the server's
                    // own metadata uses, so the replay path needs no second
                    // vocabulary for "a turn from the cache".
                    metadata: {
                      people: t?.result?.people ?? [],
                      citations: t?.result?.citations ?? [],
                      sources: t?.sources ?? [],
                      webPeople: t?.webPeople ?? [],
                      places: t?.places ?? [],
                      groups: t?.groups ?? [],
                      suggestions: t?.suggestions ?? [],
                    },
                  });
                }
              }
              // Deliberately NO scroll here. This used to fire scrollToEnd, and
              // on any answer taller than the viewport that scrolled straight
              // past the question — the exact "my query jumps off the top"
              // complaint. The anchor set at send time already has the question
              // pinned; the finished answer simply extends below it, and the
              // user scrolls at their own pace.
              return;
            }
            case 'error':
              flushDrain();
              // ── THE SERVER MAY HAVE FINISHED WITHOUT US ────────────────────
              //
              // A dropped stream is not a failed answer. The chat route keeps
              // generating and PERSISTS the assistant turn even when the client
              // is gone (that is what CHAT_CAP's clientGone flag is about), so
              // for a stream that died with nothing on screen the reply is very
              // often sitting in the conversation a second later. Ask for it
              // before showing an error: recovering the answer beats offering a
              // retry that regenerates something the user already paid for.
              //
              // Only for the codes that mean "the pipe broke", never for a real
              // refusal or a 4xx, and only when there is a conversation to read.
              if (
                (e.error === 'stream_ended' ||
                  e.error === 'timeout' ||
                  e.error === 'network_error') &&
                conversationIdRef.current &&
                !tw.current.revealed
              ) {
                void recoverTurn(turnId, conversationIdRef.current, id);
              }
              updateTurn(turnId, () => ({
                status: 'error',
                // Mapped copy only. This used to be `e.message ?? fallback`, which
                // rendered whatever the backend put in `message` — a forced 404
                // showed "Route POST:/v1/chat not found" verbatim in the thread.
                // medhaIdErrorCopy only echoes a backend message for the handful
                // of error codes whose copy we author (USER_SAFE_ERRORS); anything
                // else, including every http_* and any unknown code, maps to
                // friendly copy.
                errorMsg: medhaIdErrorCopy(
                  { ok: false, error: e.error ?? 'unknown', message: e.message },
                  'Amber',
                ),
              }));
              return;
          }
        },
      });
    },
    [
      query,
      searchMode,
      reduceMotion,
      requestScroll,
      updateTurn,
      commitRevealed,
      flushDrain,
      startDrain,
      stopDrain,
      notifyHomeNote,
      qc,
      recoverTurn,
    ],
  );

  useEffect(
    () => () => {
      inFlight.current?.abort();
      if (tw.current.timer) clearInterval(tw.current.timer);
    },
    [],
  );

  const resetChat = useCallback(() => {
    inFlight.current?.abort();
    stopDrain();
    tw.current = { turnId: '', query: '', pending: '', revealed: '', timer: null };
    requestId.current += 1;
    conversationIdRef.current = undefined;
    intentRef.current = undefined;
    setTurns([]);
    setQuery('');
    Haptics.selectionAsync().catch(() => {});
  }, [stopDrain]);

  const onStop = useCallback(() => {
    inFlight.current?.abort();
    // Stop means "show me what you have", so surface the buffer rather than
    // discarding characters the server already sent.
    flushDrain();
    const revealed = tw.current.revealed;
    requestId.current += 1;
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const lastIdx = prev.length - 1;
      return prev.map((t, i) =>
        i === lastIdx
          ? {
              ...t,
              status: 'done',
              result: t.result
                ? { ...t.result, answer: revealed || t.result.answer, answerStatus: 'done' }
                : t.result,
            }
          : t,
      );
    });
    Haptics.selectionAsync().catch(() => {});
  }, [flushDrain]);

  const openOverlay = useCallback(() => {
    resetChat();
    setOverlayOpen(true);
  }, [resetChat]);
  const closeOverlay = useCallback(() => setOverlayOpen(false), []);

  const lastTurn = turns[turns.length - 1];
  const streaming =
    !!lastTurn && (lastTurn.status === 'loading' || lastTurn.result?.answerStatus === 'streaming');

  const openConversation = useCallback(
    async (conversationId: string) => {
      inFlight.current?.abort();
      stopDrain();
      tw.current = { turnId: '', query: '', pending: '', revealed: '', timer: null };
      requestId.current += 1;

      const res = await getConversation(conversationId);
      if (!res.ok) {
        toast.error('Could not open that chat', medhaIdErrorCopy(res, 'Amber'));
        return;
      }

      const messages = res.data?.messages ?? [];
      const mapped: Turn[] = [];
      // A TURN IS ONE USER MESSAGE AND EVERYTHING AMBER SAID BEFORE THE NEXT ONE.
      //
      // This used to be `messages[i + 1]`, which assumes strict alternation. A
      // capture turn does not alternate: Amber writes the answer AND a short
      // announce row ("Got it, I'll write that down for Victor Udobong"), so the
      // second reply fell outside the pair and was picked up on the next pass as
      // if the user had said it.
      //
      // `isUser` decides where a turn starts, and nothing here asks "is this
      // Amber" -- the column's word for that is 'amber', the API's is
      // 'assistant', and a client that recognized only one of them is precisely
      // how every reply came back as a gold user bubble with a spinner under it.
      const isUser = (msg: { role: string } | undefined) => msg?.role === 'user';
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (!isUser(m)) continue;
        const replies = [];
        for (let j = i + 1; j < messages.length && !isUser(messages[j]); j++) {
          replies.push(messages[j]);
        }
        // The announce row is persisted for what it CARRIES, not for what it
        // says: metadata.capturedOutcomes is the only record of what a note
        // filed and to whom. Replay it as LOGGED cards; drop its prose, which
        // would otherwise repeat those cards back in a sentence.
        const announces = replies.filter(
          (r) => Array.isArray(r.metadata?.capturedOutcomes) && r.metadata!.capturedOutcomes!.length > 0,
        );
        const prose = replies.filter((r) => !announces.includes(r));
        const answer = prose.map((r) => r.content).join('\n\n');
        // The rich metadata (people, sections, sources, chips) rides on the
        // answer row. Fall back to any reply so a turn that produced only an
        // announce still keeps whatever it recorded.
        const next = prose[prose.length - 1] ?? replies[replies.length - 1];
        const captured = announces.flatMap((r) => normalizeCaptured(r.metadata?.capturedOutcomes));
        const ingested = ingestPeople(next?.metadata?.people, next?.metadata?.citations);
        mapped.push({
          // THE MESSAGE'S OWN ID, NOT A FRESH ONE.
          //
          // This was newId(), so every call to openConversation produced turns
          // React had never seen before and remounted the entire transcript.
          // The Home overlay polls this every 1.5s while it waits for a reply,
          // which meant the whole thread was torn down and rebuilt twice a
          // second: the cards visibly flashed, and CapturedCard's "filed"
          // haptic fired again on every tick. A turn is identified by the
          // message that started it, so re-reading the same thread reconciles
          // in place instead.
          id: `m${m.id}`,
          query: m.content,
          // The recording of a spoken follow-up, replayed with its message. The
          // thread read carries duration and waveform for every message that has
          // a clip, in the same request -- so the players draw with the words
          // instead of popping in underneath them one at a time.
          audio: m.audio
            ? {
                messageId: String(m.id),
                durationMs: Number(m.audio.durationMs) || 0,
                peaks: Array.isArray(m.audio.peaks) ? m.audio.peaks : [],
              }
            : undefined,
          captured: captured.length > 0 ? captured : undefined,
          result: {
            people: ingested.people,
            citations: ingested.citations,
            answer,
            answerStatus: 'done',
            query: m.content,
          },
          // Suggestion chips are persisted in the assistant message metadata, so
          // reopening a note still shows the tappable prompts, not just the text.
          suggestions: Array.isArray(next?.metadata?.suggestions)
            ? (next?.metadata?.suggestions as Suggestion[])
            : undefined,
          // Web sources are persisted the same way, so a reopened answer keeps its
          // source chips AND its inline [1] markers stay tappable. Without this the
          // citations in a stored answer pointed at nothing.
          // Place cards are persisted into metadata for the same reason sources are:
          // reopening a note that lost its restaurant cards reads as the app having
          // forgotten the plan.
          places: Array.isArray(next?.metadata?.places)
            ? (next?.metadata?.places as Place[])
            : undefined,
          // Sections replay too, or reopening a grouped answer flattens it and
          // the prose above the cards stops matching what is under it.
          groups: ((): AnswerGroup[] | undefined => {
            const g = normalizeGroups(next?.metadata?.groups);
            return g.length > 0 ? g : undefined;
          })(),
          sources: Array.isArray(next?.metadata?.sources)
            ? (next?.metadata?.sources as WebSource[])
            : undefined,
          // Same reason as sources: a reopened answer that lost its profile cards is an
          // answer you can no longer verify.
          webPeople: Array.isArray(next?.metadata?.webPeople)
            ? (next?.metadata?.webPeople as WebPerson[])
            : undefined,
          status: 'done',
          replayed: true,
        });
      }

      conversationIdRef.current = conversationId;
      intentRef.current = undefined;
      setTurns(mapped);
      setQuery('');

      // ── A TURN THE SERVER LOST, FILLED IN FROM THIS DEVICE ────────────────
      //
      // "After a response renders, it needs to stay there. Even if I check back
      //  10 years later."
      //
      // A turn whose reply is missing here is one of two things: still
      // generating (the overlay polls for that, and it lands within seconds), or
      // gone -- the assistant row failed to write and the answer exists nowhere
      // on the server. The second case used to leave a question with a spinner
      // under it forever.
      //
      // So: for any replayed turn with no answer, ask the local cache. If this
      // device has the answer it showed, it goes back on screen with its cards.
      // Server history always wins where it HAS the turn; this only fills holes,
      // which is why it runs after setTurns and patches rather than replacing.
      void (async () => {
        const holes = mapped.filter((t) => !t.result?.answer?.trim());
        if (holes.length === 0) return;
        for (const hole of holes) {
          const cached = await cachedAnswerFor(conversationId, hole.query).catch(() => null);
          if (!cached?.answer?.trim()) continue;
          const md = (cached.metadata ?? {}) as Record<string, unknown>;
          const ingestedCache = ingestPeople(md.people, md.citations);
          setTurns((prev) =>
            prev.map((t) =>
              t.id === hole.id
                ? {
                    ...t,
                    status: 'done',
                    result: {
                      people: ingestedCache.people,
                      citations: ingestedCache.citations,
                      answer: cached.answer,
                      answerStatus: 'done',
                      query: hole.query,
                    },
                    sources: Array.isArray(md.sources) ? (md.sources as WebSource[]) : t.sources,
                    webPeople: Array.isArray(md.webPeople)
                      ? (md.webPeople as WebPerson[])
                      : t.webPeople,
                    places: Array.isArray(md.places) ? (md.places as Place[]) : t.places,
                    groups: Array.isArray(md.groups) && md.groups.length > 0
                      ? (md.groups as Turn['groups'])
                      : t.groups,
                    suggestions: Array.isArray(md.suggestions)
                      ? (md.suggestions as Suggestion[])
                      : t.suggestions,
                  }
                : t,
            ),
          );
        }
      })();
      // Restoring a finished conversation: the newest answer is what the user
      // wants to see, so the bottom is the right resting place here.
      requestScroll('end');
      setOverlayOpen(true);
    },
    [requestScroll, stopDrain],
  );

  const onSuggestion = useCallback(
    (s: Suggestion) => {
      if (s.type === 'connect_people') void runSearch(s.query);
      else if (s.type === 'follow_up') void runSearch(s.prompt);
      else if (s.type === 'draft_message') void runSearch(`Draft an intro to ${s.name}`);
      // The original question, re-asked against the web. Positional args are
      // skipped rather than reordered so every existing caller is untouched.
      else if (s.type === 'web_search')
        void runSearch(s.query, undefined, undefined, undefined, undefined, true);
      // Writing a message is a normal turn — the drafting rules live in the server's
      // chat prompt, so this just sends the request.
      else if (s.type === 'draft_outreach') void runSearch(s.prompt);
      // A research pass MUST carry forceWeb. Without it, "find recent news on Dana
      // Reed and Lee Ortiz" reads like a people question and gets routed into the
      // user's own contacts, where by definition these names are not.
      else if (s.type === 'research_web')
        void runSearch(s.prompt, undefined, undefined, undefined, undefined, true);
      // share_note is handled by whoever can open a share sheet — AskChat overrides
      // this whole callback and does exactly that. Surfaces that pass THIS function
      // straight through (ChatSurface, the voice-call overlay) had no branch at all,
      // so the one chip the server appends to nearly every answer was a silent no-op
      // for them: the user taps "Send this to a circle" and the app does nothing.
      // Nothing here can present a sheet, so it defers to the registered opener and
      // is inert only when genuinely nobody can share.
      else if (s.type === 'share_note') {
        const opened = openShareForNote(conversationIdRef.current);
        if (!opened) {
          // Better than the silent no-op this replaced: the tap is acknowledged and
          // the user is told where the action lives, instead of the app appearing to
          // have ignored them.
          toast.info('Open this note to share it.');
        }
      }
    },
    [runSearch],
  );

  /**
   * ANSWERING A QUESTION IS NOT SENDING A MESSAGE.
   *
   * All three of these used to call runSearch() with the answer as the query --
   * runSearch('Yes', …), runSearch(candidate.name, …). That posts to the chat
   * endpoint, so tapping a confirmation chip created a REAL TURN whose user
   * bubble said "Yes", sat on "Thinking…" until the server replied, and
   * persisted a user/assistant pair into the conversation.
   *
   * Which is why reopening a note looked destroyed: the answer, the table and
   * the cards were still there, buried under "Yes" / "Caleb Newton" / "Got it,
   * I'll write that down for Caleb Newton." turns that replay faithfully
   * reconstructed. The transcript was not lost. It was diluted, permanently,
   * one tap at a time.
   *
   * POST /v1/chat/resolve is the endpoint for this, it is what the Today feed
   * has always used, and it writes nothing to the conversation. The question
   * disappears, the person is attached, and the transcript is untouched.
   */
  const resolveInPlace = useCallback(
    (turnId: string, pendingId: string | undefined, contactId: string, name: string) => {
      if (!pendingId) return;
      // Silence this question on the Today feed and in "STILL TO CONFIRM" as
      // well, in the same frame. Answering a chip inside the transcript used to
      // clear only the transcript's own copy, so the identical question was
      // still sitting on Home waiting to be answered a second time.
      markPendingAnswered(qc, Number(pendingId));
      void resolvePending(Number(pendingId), contactId).then((res) => {
        if (!res.ok) {
          toast.error('Could not save that', medhaIdErrorCopy(res, 'Amber'));
          return;
        }
        // Confirmation the user can see, in the section that already means
        // "filed" -- rather than a chat message saying so.
        if (contactId !== '__skip__') {
          updateTurn(turnId, (t) => ({
            captured: [
              ...(t.captured ?? []),
              {
                contactId: contactId === '__new__' ? (res.data?.createdContactId ?? null) : contactId,
                name,
                text: null,
                route: 'logged',
                participantNames: null,
                participantIds: [],
                isSelf: false,
              },
            ],
          }));
        }
        qc.invalidateQueries({ queryKey: ['recentlyMentioned'] });
        if (contactId !== '__new__' && contactId !== '__skip__') {
          qc.invalidateQueries({ queryKey: ['contact', contactId] });
          qc.invalidateQueries({ queryKey: ['contactFacts', contactId] });
        }
      });
    },
    [updateTurn, qc],
  );

  const onClarify = useCallback(
    (turnId: string, candidate: ClarifyCandidate, pendingId?: string) => {
      updateTurn(turnId, (t) => ({
        clarify: (t.clarify ?? []).filter((g) => g.pendingId !== pendingId),
      }));
      resolveInPlace(turnId, pendingId, candidate.id, candidate.name);
    },
    [updateTurn, resolveInPlace],
  );

  const onSoftConfirmYes = useCallback(
    (turnId: string, contact: { id: string; name: string }, pendingId?: string) => {
      updateTurn(turnId, (t) => ({
        softConfirm: (t.softConfirm ?? []).filter((g) => g.pendingId !== pendingId),
      }));
      resolveInPlace(turnId, pendingId, contact.id, contact.name);
    },
    [updateTurn, resolveInPlace],
  );

  // "No" is not a different contact, it is a refusal of the guess. The row is
  // left standing so the full candidate list can be asked instead -- the server
  // downgrades a declined soft-confirm to a clarify.
  const onSoftConfirmNo = useCallback(
    (turnId: string, pendingId?: string) => {
      updateTurn(turnId, (t) => ({
        softConfirm: (t.softConfirm ?? []).filter((g) => g.pendingId !== pendingId),
      }));
      // "No" ends THIS question everywhere too. The server downgrades the row to
      // a full clarify and re-issues it, which is a new pendingId -- so nothing
      // here suppresses the follow-up, only the guess that was refused.
      if (pendingId) {
        markPendingAnswered(qc, Number(pendingId));
        void declinePending(Number(pendingId));
      }
    },
    [updateTurn, qc],
  );

  // A READ OF conversationIdRef, NOT A FRESH ARROW PER RENDER. Inline, this was
  // `getConversationId: () => conversationIdRef.current` — a new function identity on
  // every render, which alone would invalidate the memo below and defeat the whole
  // point of it. A ref read is stable forever, so useCallback with no deps is exact.
  const getConversationId = useCallback(() => conversationIdRef.current, []);

  /**
   * THE MEMO THAT MAKES TAB TRANSITIONS SMOOTH. Do not inline this object.
   *
   * This was an object literal in the JSX, so it got a new identity on EVERY render of
   * ChatProvider — and ChatProvider re-renders whenever HomeScreen does, which is twice
   * per tab change (once synchronously in goToPage, once at onPageSelected).
   *
   * A new context value re-renders every consumer, and context propagation goes
   * STRAIGHT THROUGH React.memo and useMemo'd elements — that is the whole point of
   * context. So home.tsx memoizing its three pages, and ContactsPage being memo'd, and
   * the FlatList's props being stable, bought exactly nothing: this line pushed a
   * re-render past all of them into ContactsList, AskChat and ~100 mounted contact
   * rows, landing in the same frames as the native pager slide. Every "the transition
   * is still not quite right" report traced back here.
   *
   * The dependency list is every value actually read. The callbacks are all useCallback'd
   * above, so in practice this only produces a new value when something a consumer
   * genuinely needs to see has changed.
   */
  const value = useMemo(
    () => ({
      turns,
      query,
      setQuery,
      streaming,
      scrollRequest,
      runSearch,
      resetChat,
      onStop,
      openConversation,
      adoptLiveTurn,
      onSuggestion,
      onClarify,
      onSoftConfirmYes,
      onSoftConfirmNo,
      overlayOpen,
      openOverlay,
      closeOverlay,
      homeNoteVersion,
      notifyHomeNote,
      getConversationId,
    }),
    [
      turns,
      query,
      streaming,
      scrollRequest,
      runSearch,
      resetChat,
      onStop,
      openConversation,
      adoptLiveTurn,
      onSuggestion,
      onClarify,
      onSoftConfirmYes,
      onSoftConfirmNo,
      overlayOpen,
      openOverlay,
      closeOverlay,
      homeNoteVersion,
      notifyHomeNote,
      getConversationId,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
