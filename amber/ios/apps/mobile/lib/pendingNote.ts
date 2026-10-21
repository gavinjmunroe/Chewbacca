import { useEffect, useState } from 'react';

// THE NOTE YOU JUST FINISHED SAYING, on the feed before the server knows about it.
//
// Recording ends and the card used to take anywhere from one to nine seconds to
// appear. The refresh was a single timer 600ms after the recorder closed — often
// before the server had created the conversation row at all — and the only other
// refresh ran when the whole reply finished generating. Miss the first, wait for
// the second. That is why leaving the tab and coming back "fixed" it: the slow
// refresh had landed while you were away.
//
// The transcript exists on the device the instant recording stops, so the card can
// too. This holds it until the real row arrives, at which point the real one takes
// over — same position, same content, so the swap is invisible.
//
// A module store rather than state on HomePage for the same reason as todayFocus:
// the recorder renders in home.tsx's root, outside the pager, and HomePage is a
// memoized element specifically so tab changes do not rebuild it. Threading a prop
// down would undo that.

export type PendingNote = {
  /** Stands in until `meta` supplies the real one. Prefixed so a tap can tell. */
  conversationId: string;
  text: string;
  at: number;
  /** False until the server has issued the real conversation id. */
  real: boolean;
  /** Chips to show on the card. Only the scripted demo path sets this. */
  people?: { contactId: string; name: string }[];
};

/** A card still holding a local id cannot be opened — there is nothing to open. */
export const LOCAL_NOTE_PREFIX = 'local:';

let current: PendingNote | null = null;
const listeners = new Set<(v: PendingNote | null) => void>();

function emit() {
  for (const fn of listeners) fn(current);
}

/** Called the moment the recorder returns a transcript. */
export function publishPendingNote(text: string): void {
  const clean = text.trim();
  if (!clean) return;
  current = {
    conversationId: `${LOCAL_NOTE_PREFIX}${Date.now()}`,
    text: clean,
    at: Date.now(),
    real: false,
  };
  emit();
}

/**
 * Called when the stream's `meta` event supplies the real conversation id, which
 * happens before the first token. Upgrading in place rather than replacing keeps
 * the card exactly where it is and makes it tappable — and tapping it lands on the
 * overlay, which mirrors the still-streaming answer.
 */
export function attachPendingNoteConversation(conversationId: string): void {
  if (!current || current.real || !conversationId) return;
  current = { ...current, conversationId, real: true };
  emit();
}

/** Called once the real row is in the fetched list. */
export function clearPendingNote(): void {
  if (!current) return;
  current = null;
  emit();
}

/** The scripted path tags the card itself; see lib/demoScript. */
export function setPendingNotePeople(people: { contactId: string; name: string }[]): void {
  if (!current) return;
  current = { ...current, people };
  emit();
}

/** The id the card is currently carrying, local or real. */
export function pendingNoteId(): string | null {
  return current?.conversationId ?? null;
}

export function usePendingNote(): PendingNote | null {
  const [value, setValue] = useState<PendingNote | null>(current);
  useEffect(() => {
    setValue(current);
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
