import { callMedhaId, type MedhaIdResult } from './medhaId';

// Chat-history REST surface on medha-id. Read-only here: list past
// conversations for the sidebar, and load one conversation's messages to
// rehydrate the transcript. Both ride callMedhaId's authed transport (same
// bearer + typed {ok} envelope as lib/network.ts), so callers branch on
// `res.ok` exactly like the rest of the app.

export type ConversationSummary = {
  conversationId: string;
  kind?: 'note' | 'chat' | string | null;
  title: string;
  // A fuller preview of what was said, for the Today voice-note card.
  preview?: string;
  lastAt: string | null;
  createdAt?: string;
  messageCount: number;
  // How the note was ENTERED. true = something in it was spoken, false = it was
  // typed, null/undefined = unknown (the thread predates the field). The Today
  // card must not call a typed note a voice note, and must not relabel old
  // notes it has no information about — so unknown keeps the spoken styling.
  voice?: boolean | null;
  // Who this note/thread involves — drives the "filed to …" chips. contactId is
  // null for a mention that has not resolved to a contact yet; the chip then
  // renders name-only.
  people?: { contactId: string | null; name: string | null }[];
};

export type ConversationMessage = {
  id: string;
  /**
   * 'amber' is the column's own word for an assistant turn -- the CHECK on
   * conversation_messages is (user|amber|system), inherited from the older
   * spaces table. medha-id normalizes it to 'assistant' on the way out, but the
   * client accepts both, because a client that only understood one of them is
   * exactly how Amber's replies ended up rendering as the user's own messages.
   * Everything here branches on "is this the user", never on "is this Amber".
   */
  role: 'user' | 'assistant' | 'amber';
  content: string;
  intent?: string | null;
  metadata?: {
    model?: string;
    peopleIds?: string[];
    people?: { contactId: string; name: string }[];
    citations?: unknown[];
    suggestions?: unknown[];
    // Present only on a web-grounded turn: the pages the answer was built from,
    // so a reopened note keeps its source chips and its [1] markers stay live.
    sources?: unknown[];
    webPeople?: unknown[];
    // Labeled sections, when the turn produced them. See lib/chat.ts AnswerGroup.
    groups?: unknown[];
    // Venue cards on a planning turn, persisted so a reopened note keeps them.
    places?: unknown[];
    // Present ONLY on the announce message -- the short "Got it, I'll write that
    // down for …" row Amber writes after a capture. It carries what was filed,
    // which is what rebuilds the LOGGED cards when a note is reopened. Its prose
    // is deliberately not replayed as answer text: it would say in a sentence
    // what the cards right under it already say with a checkmark.
    capturedOutcomes?: unknown[];
  } | null;
  /**
   * The recording of a message that was SPOKEN, when it has one.
   *
   * Duration and waveform only -- enough to draw the player. The playback URL is
   * signed and short-lived, so it is minted when somebody actually presses play
   * rather than handed out with the thread and expiring in a listener's hand.
   */
  audio?: { durationMs: number; byteSize: number; peaks: number[] } | null;
  createdAt: string;
};

/**
 * THE THREAD LIST, OPTIONALLY FOR ONE DAY.
 *
 * "My notes and journals from yesterday are not showing up either."
 *
 * With no window this asks for the newest thirty threads, which is what a
 * preview wants. Home's Notes & Journal list is SINGLE-DAY, though, and it was
 * being fed by that same unwindowed call and then bucketing the results into
 * days itself -- so a day was visible only if it happened to land inside those
 * thirty. Every Ask conversation is a thread in the same table, so thirty is one
 * busy day; after that, yesterday's notes are still on the server, perfectly
 * intact, and unreachable. Which looks exactly like a note that did not save.
 *
 * No limit fixes that, because the question was wrong rather than the number. A
 * day view asks for a day.
 *
 * TWO INSTANTS, HALF-OPEN, AND THE TIMEZONE IS OURS TO DECIDE -- the same
 * contract /v1/me/agenda uses. This phone knows what "yesterday" means where
 * its owner is standing; the server does not, and one that guesses shows the
 * wrong day to anybody who has traveled.
 */
export function listConversations(
  window?: {
    from: Date;
    to: Date;
  },
  transport: { signal?: AbortSignal; timeoutMs?: number; retries?: number } = {},
): Promise<MedhaIdResult<{ conversations: ConversationSummary[] }>> {
  /**
   * THE QUERY STRING IS BUILT THE WAY THIS CODEBASE ALREADY BUILDS THEM, and
   * two gates in lib/apiContract.test.mts taught me the shape rather than the
   * other way round:
   *
   *   A pre-assembled `q` interpolated as `${q}` fails "EVERY VALUE
   *   INTERPOLATED INTO A PATH IS ENCODED". The values inside it were encoded,
   *   so the complaint is about the shape -- and it is right to be. A helper
   *   handing back a finished fragment is how an unencoded value gets into a URL
   *   later: somebody adds a field to it, the encoding is three lines away, and
   *   nothing fails.
   *
   *   A whole-path ternary fails "every path is an absolute route on a known
   *   prefix", because there is then no literal for the checker to read a prefix
   *   from -- so an endpoint could move off /v1 without anything noticing.
   *
   * A literal prefix plus `parts.join('&')` satisfies both by construction, and
   * is what lib/dms.ts does. Copied deliberately: one shape for query strings
   * across the app is the only version of this that stays true.
   */
  const parts: string[] = [];
  if (window) {
    parts.push(`from=${encodeURIComponent(window.from.toISOString())}`);
    parts.push(`to=${encodeURIComponent(window.to.toISOString())}`);
  }
  return callMedhaId<{ conversations: ConversationSummary[] }>({
    path: `/v1/conversations${parts.length ? `?${parts.join('&')}` : ''}`,
    method: 'GET',
    requireAuth: true,
    ...transport,
  });
}

export type ConversationDetail = {
  conversationId: string;
  ownerId?: string;
  messages: ConversationMessage[];
  audio?: { durationMs: number; byteSize: number; peaks: number[] } | null;
};

export function getConversation(
  conversationId: string,
): Promise<MedhaIdResult<ConversationDetail>> {
  return callMedhaId<ConversationDetail>({
    path: `/v1/conversations/${encodeURIComponent(conversationId)}`,
    method: 'GET',
    requireAuth: true,
  });
}

// Soft-delete a thread (a Today voice note). Removes it from the Today feed and,
// because the calendar underbars count conversations per day, from the calendar
// too. Backend filters by owner, so a bad id just deletes nothing.
export function deleteConversation(
  conversationId: string,
): Promise<MedhaIdResult<{ deleted: number }>> {
  return callMedhaId<{ deleted: number }>({
    path: `/v1/conversations/${encodeURIComponent(conversationId)}`,
    method: 'DELETE',
    requireAuth: true,
  });
}
