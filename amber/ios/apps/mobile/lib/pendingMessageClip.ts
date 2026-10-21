/**
 * THE RECORDING OF A SPOKEN FOLLOW-UP, HELD FOR THE ONE MESSAGE IT BELONGS TO.
 *
 * A follow-up said out loud inside an expanded card is transcribed on the
 * device, and the transcript is what gets sent -- it is the message, and it is
 * what Amber answers. The audio has to wait: it attaches to a `conversation_messages`
 * row that does not exist until the request is already in flight, and its id is
 * a bigserial nobody can guess. The chat stream emits `user_message` the moment
 * that row exists, and this module is where the clip waits in between.
 *
 * WHY A MODULE AND NOT A PARAMETER. The recorder lives in AskOverlay and the
 * send goes through lib/askBridge, which carries a string, into AskChat's
 * submitter, into ChatContext -- three hops that have no business knowing about
 * audio. Threading a media object through all of them (and through every other
 * caller of askBridge) to serve one surface is worse than one small staging
 * point, which is the same shape lib/pendingNote and lib/pendingRecord already
 * use for the same reason.
 *
 * IT IS MATCHED ON THE TRANSCRIPT, NOT JUST TAKEN. If the clip were handed to
 * whatever message happened to come next, a follow-up typed while a recording
 * was being transcribed would get somebody else's audio bolted onto it. The
 * staged clip is only released to a message whose text is the text that was
 * transcribed. It also expires: an abandoned clip must never surface on a
 * message sent ten minutes later.
 */

export type StagedClip = {
  uri: string;
  durationMs: number;
  peaks: number[];
  /** What was transcribed. The key that lets exactly one message claim it. */
  transcript: string;
  stagedAt: number;
};

// Two minutes. Long enough to cover a slow first token on a bad connection,
// short enough that a clip whose send never happened cannot come back later.
const MAX_AGE_MS = 2 * 60 * 1000;

let staged: StagedClip | null = null;

const norm = (s: string) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Hold a recording for the message about to be sent. Replaces any earlier one. */
export function stageMessageClip(clip: {
  uri: string;
  durationMs: number;
  peaks: number[];
  transcript: string;
}): void {
  if (!clip?.uri || !norm(clip.transcript)) return;
  staged = {
    uri: clip.uri,
    durationMs: Math.max(0, Math.round(clip.durationMs || 0)),
    peaks: Array.isArray(clip.peaks) ? clip.peaks : [],
    transcript: clip.transcript,
    stagedAt: Date.now(),
  };
}

/**
 * Claim the staged clip for a message with this text, or get null.
 *
 * Consumes it either way when it matches, so a retried turn cannot upload the
 * same recording onto two messages.
 */
export function takeMessageClip(messageText: string): StagedClip | null {
  if (!staged) return null;
  if (Date.now() - staged.stagedAt > MAX_AGE_MS) {
    staged = null;
    return null;
  }
  if (norm(staged.transcript) !== norm(messageText)) return null;
  const clip = staged;
  staged = null;
  return clip;
}

/** Drop whatever is staged — a cancelled recorder, a reset chat. */
export function clearMessageClip(): void {
  staged = null;
}

/** Tests and diagnostics. */
export function hasStagedMessageClip(): boolean {
  return staged != null;
}
