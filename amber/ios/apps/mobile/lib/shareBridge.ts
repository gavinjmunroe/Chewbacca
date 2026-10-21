// WHO CAN ACTUALLY OPEN A SHARE SHEET.
//
// The server appends a "Send this to a circle" chip to nearly every answer — it is
// the whole argument for answering inside Amber rather than in a browser. Tapping it
// has to present a sheet, and a chat CONTEXT cannot present anything; only the screen
// rendering the conversation can.
//
// AskChat knew that and overrode the suggestion handler entirely. Every other surface
// that renders a conversation — ChatSurface, the voice-call overlay — passed the
// context's handler straight through, and the context had no branch for share_note at
// all. So on those screens the most-offered chip in the app did nothing, silently,
// with no error and no feedback.
//
// Same pattern and same reasoning as askBridge: a module store beats a prop when the
// prop would have to cross several unrelated components to reach the one thing that
// can act on it. Two variables; nothing grows per user or per row.

type Opener = (conversationId: string) => void;

let opener: Opener | null = null;

/** Called by a screen that owns a share sheet. Returns its own unregister. */
export function registerShareOpener(fn: Opener): () => void {
  opener = fn;
  return () => {
    // Only clear if this instance still owns the wire — two screens mounting and
    // unmounting in the wrong order must not leave it null while one is still up.
    if (opener === fn) opener = null;
  };
}

/**
 * Ask whoever can share to open the sheet for this note.
 * @returns false when no screen is currently able to, so the caller can say so
 *          instead of appearing to have ignored the tap.
 */
export function openShareForNote(conversationId: string | null | undefined): boolean {
  if (!opener || !conversationId) return false;
  opener(String(conversationId));
  return true;
}
