import { useEffect, useState } from 'react';
import type { Turn } from './ChatContext';

// THE TURN THAT IS STREAMING RIGHT NOW, readable from another React tree.
//
// Recording a voice note on Home runs the chat stream through the ChatProvider
// mounted in home.tsx. Tapping the resulting note card opens HomeAskOverlay, which
// mounts its OWN nested ChatProvider on purpose — so loading a note there never
// disturbs the Ask tab in People. The cost of that deliberate choice was that the
// overlay could not see the stream at all: it rebuilt the thread from the server,
// and the server does not have the answer until generation finishes. So the overlay
// showed a spinner over an empty page while the tokens it was waiting for were
// already arriving one tree away, and the only way to see them was to close the
// sheet and reopen it once the row had landed in Postgres.
//
// This is the same pattern as todayFocus and askBridge, for the same reason: a
// module store beats a prop when the prop would have to cross something expensive —
// here, a provider boundary that exists to keep two chats independent.
//
// It is READ-ONLY from the overlay's side. Nothing here aborts, retries or mutates
// the stream; the overlay only mirrors what the owner has already put on screen.
// That matters, because an earlier attempt to fix this by re-pulling the thread
// killed in-flight answers.

type Live = { conversationId: string; turn: Turn } | null;

let current: Live = null;
const listeners = new Set<(v: Live) => void>();

/**
 * Called by the provider that owns a stream, on every turn update. `undefined`
 * conversationId is ignored rather than cleared: the id arrives on the `meta`
 * event, which precedes the first token, so a turn without one has nothing an
 * overlay could match against yet.
 *
 * There is deliberately no way to clear this. A finished turn is the most complete
 * version of itself — answer, people, chips, places — so keeping it makes reopening
 * that note instant rather than a round trip, and it is scoped to one conversation
 * so it can never stand in for a different one. Precedence belongs to the consumer:
 * ChatContext.adoptLiveTurn lets stored history win as soon as history has content,
 * which is what keeps a corrected name from being shadowed by the copy here.
 */
export function publishLiveTurn(conversationId: string | undefined, turn: Turn | null): void {
  if (!conversationId || !turn) return;
  current = { conversationId, turn };
  for (const fn of listeners) fn(current);
}

/** The live turn for THIS conversation, or null. Never another conversation's. */
export function useLiveTurn(conversationId: string | null): Turn | null {
  const [value, setValue] = useState<Live>(current);
  useEffect(() => {
    // Re-sync on mount: the stream may have advanced between render and subscribe.
    setValue(current);
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  if (!conversationId || !value || value.conversationId !== conversationId) return null;
  return value.turn;
}
