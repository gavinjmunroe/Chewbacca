import { callMedhaId, type MedhaIdResult } from './medhaId';

// Audio, tapbacks and comments for voice notes — the client half of
// medha-id's /v1/me/notes/:id/audio and /v1/notes/:ownerId/:id/* routes.
//
// A note is addressed by (ownerId, noteId). The ownerId is the SHARER's amber id,
// which the feed already hands us as `item.sharedBy.amberId`; it names whose note
// this is and grants nothing on its own. Every one of these endpoints re-checks
// the caller's live circle membership server-side, so nothing here is a
// permission boundary — it is just plumbing.

// The five tapbacks, in the order they are offered. Stored as SEMANTIC KEYS, not
// glyphs — the glyph is a rendering choice the client can restyle without a data
// migration, and a key is something PeopleRank can reason about later ("whose
// notes does this person actually agree with?").
//
// `like` was added after the other four had already shipped, so medha-id's
// note_reactions_kind_chk CHECK constraint must accept it BEFORE this list does —
// see db/migrations/20260818_reactions_add_like.sql. Adding a kind here without
// running that migration makes every tap on it fail with a 400 and roll back.
//
// `heart` was added later still (migration 045, which widens all three reaction
// tables at once). See lib/reaction-kinds.js on the server: the same list lives
// there, and a test compares the two so a sixth kind cannot land on one side.
export const REACTION_KINDS = [
  'emphasis',
  'like',
  'dislike',
  'laugh',
  'question',
  'heart',
] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

/**
 * The text glyph for each tapback, or null where it is drawn as an ICON instead
 * (thumbs up / thumbs down). Emoji were deliberately not used: this feed is
 * monochrome ink and terracotta line-work, and a full-color 👍 in that row reads
 * as a paste from a different app.
 *
 * The laugh is stacked "HA / HA" on two lines. The newline is meaningful:
 * TapbackPill detects it and tightens the line height, so a stacked glyph occupies
 * exactly the same pill height as a single-line one and the row stays even.
 */
export const REACTION_GLYPH: Record<ReactionKind, string | null> = {
  emphasis: '!!',
  like: null, // ThumbsUp
  dislike: null, // ThumbsDown
  laugh: 'HA\nHA',
  question: '?',
  heart: null, // Heart
};

/**
 * THE SAME KINDS, AS EMOJI, FOR THE FEED.
 *
 * "It should be a clean set of emojis that look exactly like the Apple emojis."
 *
 * Two renderings of one vocabulary, and that is deliberate rather than a fork.
 * The DM thread is monochrome ink and terracotta line-work at the scale of a
 * message corner, and a full-color emoji stamped on a bubble there reads as a
 * paste from another app -- which is why REACTION_GLYPH exists and why it stays.
 * The feed is a page of warm cards with faces on them, it is what the design
 * draws with a heart, and it is what this was asked for.
 *
 * WHAT MUST NOT FORK IS THE KEY. Both tables are `Record<ReactionKind, ...>`, so
 * a kind added to the list above has to be given a glyph AND an emoji or the
 * build fails -- which is the only thing standing between two renderings and two
 * vocabularies.
 *
 * The emoji themselves are the system font's, so on iOS they ARE the Apple ones.
 */
export const REACTION_EMOJI: Record<ReactionKind, string> = {
  heart: '❤️',
  laugh: '😂',
  like: '👍',
  dislike: '👎',
  emphasis: '‼️',
  question: '❓',
};

/**
 * THE ORDER A PICKER SHOWS THEM IN, which is not the order the API declares them.
 *
 * REACTION_KINDS is the wire enum and its order is historical -- changing it
 * would mean changing what the server validates. This is the reading order, and
 * it is iMessage's: the heart first, then the two thumbs, then the laugh, then
 * the two that are punctuation.
 *
 * THE HEART WAS MISSING UNTIL NOW, and the previous version of this comment said
 * so and left it: "Apple leads with a heart, which this app has no kind for;
 * adding one is a schema change." It was, and migration 045 is that change --
 * it widens all three reaction tables at once. A feed you can answer with a
 * thumbs-up and not a heart is not the set anybody means.
 */
export const REACTION_ORDER: readonly ReactionKind[] = [
  'heart',
  'like',
  'dislike',
  'laugh',
  'emphasis',
  'question',
];

export const REACTION_LABEL: Record<ReactionKind, string> = {
  emphasis: 'Emphasize',
  like: 'Thumbs up',
  dislike: 'Thumbs down',
  laugh: 'Laugh',
  question: 'Question',
  heart: 'Love',
};

export type ReactionSummary = {
  counts: Record<ReactionKind, number>;
  /** The caller's own reaction, or null. */
  mine: ReactionKind | null;
  total: number;
  people?: {
    amberId: string;
    kind: ReactionKind;
    name: string | null;
    username: string | null;
    avatarUrl: string | null;
  }[];
};

export type NoteComment = {
  id: string;
  body: string;
  createdAt: string;
  author: {
    amberId: string;
    name: string | null;
    username: string | null;
    avatarUrl: string | null;
  };
};

export type NoteAudio = {
  playbackUrl: string;
  /** Seconds until the signed URL dies. Re-fetch rather than caching the URL. */
  expiresIn: number;
  contentType: string;
  durationMs: number;
  byteSize: number;
  /** The SENDER's waveform, 0..100 per sample. */
  peaks: number[];
};

const enc = encodeURIComponent;

// ── Playback ──────────────────────────────────────────────────────────────────

/**
 * A short-lived signed URL for a note's audio, plus the sender's waveform.
 *
 * DO NOT CACHE THE URL. It expires in minutes by design — that is the whole
 * point of signing per request — so the player asks for a fresh one each time it
 * loads a note rather than holding one and failing mysteriously later.
 */
export function getNoteAudio(ownerId: string, noteId: string): Promise<MedhaIdResult<NoteAudio>> {
  return callMedhaId<NoteAudio>({
    path: `/v1/notes/${enc(ownerId)}/${enc(noteId)}/audio`,
    method: 'GET',
    requireAuth: true,
    tag: 'GET note audio',
  });
}

// ── Recording upload (owner only) ─────────────────────────────────────────────

type UploadTicket = {
  uploadUrl: string;
  contentType: string;
  expiresIn: number;
  maxBytes: number;
  maxDurationMs: number;
};

/**
 * Attach a recording to one of your own notes.
 *
 * Three legs, in this order, because the server refuses to take the client's
 * word for any of it:
 *   1. ask for a signed PUT (the server mints and remembers the object key)
 *   2. PUT the bytes straight to Google — they never pass through medha-id, so a
 *      5-minute clip is not a 2.5MB request body through our API
 *   3. finalize, at which point the server HEADs the object and records the real
 *      size, the duration and the waveform
 *
 * Returns true only if all three legs succeeded. A failure anywhere leaves the
 * note without audio rather than with a half-uploaded clip: the row stays
 * 'pending' and is never served.
 */
export async function uploadNoteAudio(
  noteId: string,
  fileUri: string,
  { durationMs, peaks }: { durationMs: number; peaks: number[] },
): Promise<boolean> {
  return uploadAudioTo(`/v1/me/notes/${enc(noteId)}/audio`, fileUri, { durationMs, peaks });
}

/**
 * Attach a recording to ONE MESSAGE of one of your own notes.
 *
 * A spoken follow-up inside an expanded card. The transcript is already the
 * message -- it is what was said and what Amber answered -- and this is the
 * recording of it, kept beside the words rather than instead of them.
 *
 * `messageId` comes from the chat stream's `user_message` event, which fires as
 * soon as the row exists. It is a bigserial, so there is nothing to guess: an
 * id that is not the caller's own message, or not in this thread, is refused by
 * the server before a key is minted.
 */
export async function uploadMessageAudio(
  noteId: string,
  messageId: string,
  fileUri: string,
  { durationMs, peaks }: { durationMs: number; peaks: number[] },
): Promise<boolean> {
  if (!messageId) return false;
  return uploadAudioTo(
    `/v1/me/notes/${enc(noteId)}/messages/${enc(messageId)}/audio`,
    fileUri,
    { durationMs, peaks },
  );
}

/**
 * The three legs, shared. ONE implementation on purpose: a second copy of this
 * is a second place for "PUT the bytes and call it done" to be written, and the
 * whole point of the sequence is that the server verifies the object itself.
 *
 * `basePath` is the audio endpoint; the ticket comes from `${basePath}/upload-url`
 * and finalize POSTs to `basePath`.
 */
async function uploadAudioTo(
  basePath: string,
  fileUri: string,
  meta: { durationMs: number; peaks: number[] },
): Promise<boolean> {
  return (await uploadAudioSequence(basePath, fileUri, meta)) !== null;
}

/**
 * THE SAME THREE LEGS, returning what the server said rather than a boolean.
 *
 * Voice comments need two things back that a boolean cannot carry: the id of
 * the clip that was reserved (so the comment can be written against it) and the
 * transcript the server produced. Splitting a second implementation out for
 * that would have meant a second place for "PUT the bytes and call it done" to
 * be written, and the whole point of the sequence is that the server verifies
 * the object itself.
 *
 * So the boolean version above is now a thin wrapper on this one.
 */
export async function uploadAudioSequence<T = { ok: boolean; byteSize: number }>(
  basePath: string,
  fileUri: string,
  { durationMs, peaks }: { durationMs: number; peaks: number[] },
): Promise<(T & { mediaId?: string }) | null> {
  const ticket = await callMedhaId<UploadTicket & { mediaId?: string }>({
    path: `${basePath}/upload-url`,
    method: 'POST',
    requireAuth: true,
    tag: 'POST audio upload-url',
    timeoutMs: 30_000,
    retries: 0,
  });
  if (!ticket.ok) return null;

  let body: Blob;
  try {
    const res = await fetch(fileUri);
    const raw = await res.blob();
    // Re-type the blob rather than only setting the header. React Native sends a
    // Blob's own `type` as Content-Type, which would override our header and
    // break the signature — the server pins content-type INTO the signature, so a
    // mismatch is a 403 rather than a silent wrong-type upload.
    body = raw.slice(0, raw.size, ticket.data.contentType);
  } catch {
    return null;
  }
  if (!body.size || body.size > ticket.data.maxBytes || durationMs > ticket.data.maxDurationMs) return null;

  const uploadController = new AbortController();
  const uploadTimer = setTimeout(() => uploadController.abort(), 90_000);
  try {
    const put = await fetch(ticket.data.uploadUrl, {
      signal: uploadController.signal,
      method: 'PUT',
      headers: { 'content-type': ticket.data.contentType },
      body,
    });
    if (!put.ok) return null;
  } catch {
    return null;
  } finally {
    clearTimeout(uploadTimer);
  }

  const done = await callMedhaId<T>({
    path: basePath,
    method: 'POST',
    requireAuth: true,
    body: {
      durationMs: Math.max(0, Math.min(ticket.data.maxDurationMs, Math.round(durationMs))),
      peaks,
      // Only the comment flow reserves an id up front; the note endpoints
      // identify the clip by the note in the path and ignore this.
      ...(ticket.data.mediaId ? { mediaId: ticket.data.mediaId } : {}),
    },
    tag: 'POST audio finalize',
    timeoutMs: 30_000,
    retries: 0,
  });
  if (!done.ok || !done.data || (done.data as { ok?: boolean }).ok === false) return null;
  return { ...(done.data as T), mediaId: ticket.data.mediaId };
}

/**
 * A short-lived signed URL for a clip on one of YOUR OWN messages.
 *
 * Separate from getMessageAudio below so the app does not need to know its own
 * amber id to play back audio in its own thread -- the owner is the caller, by
 * construction, which is a narrower check than naming an owner and proving reach
 * to them.
 *
 * DO NOT CACHE THE URL. It dies in minutes, which is the point of signing it.
 */
export function getMyMessageAudio(
  noteId: string,
  messageId: string,
): Promise<MedhaIdResult<NoteAudio>> {
  return callMedhaId<NoteAudio>({
    path: `/v1/me/notes/${enc(noteId)}/messages/${enc(messageId)}/audio`,
    method: 'GET',
    requireAuth: true,
    tag: 'GET my message audio',
  });
}

/**
 * A short-lived signed URL for ONE MESSAGE's clip in somebody else's shared
 * note, plus the speaker's waveform.
 *
 * DO NOT CACHE THE URL -- same rule as the note's own audio.
 */
export function getMessageAudio(
  ownerId: string,
  noteId: string,
  messageId: string,
): Promise<MedhaIdResult<NoteAudio>> {
  return callMedhaId<NoteAudio>({
    path: `/v1/notes/${enc(ownerId)}/${enc(noteId)}/messages/${enc(messageId)}/audio`,
    method: 'GET',
    requireAuth: true,
    tag: 'GET message audio',
  });
}

export function deleteNoteAudio(noteId: string): Promise<MedhaIdResult<{ ok: boolean }>> {
  return callMedhaId<{ ok: boolean }>({
    path: `/v1/me/notes/${enc(noteId)}/audio`,
    method: 'DELETE',
    requireAuth: true,
    tag: 'DELETE note audio',
  });
}

// ── Tapbacks ──────────────────────────────────────────────────────────────────

export function getReactions(
  ownerId: string,
  noteId: string,
): Promise<MedhaIdResult<ReactionSummary>> {
  return callMedhaId<ReactionSummary>({
    path: `/v1/notes/${enc(ownerId)}/${enc(noteId)}/reactions`,
    method: 'GET',
    requireAuth: true,
    tag: 'GET note reactions',
  });
}

/** Set or change your single reaction. Returns the whole updated summary. */
export function setReaction(
  ownerId: string,
  noteId: string,
  kind: ReactionKind,
): Promise<MedhaIdResult<ReactionSummary>> {
  return callMedhaId<ReactionSummary>({
    path: `/v1/notes/${enc(ownerId)}/${enc(noteId)}/reactions`,
    method: 'PUT',
    requireAuth: true,
    body: { kind },
    tag: 'PUT note reaction',
  });
}

export function clearReaction(
  ownerId: string,
  noteId: string,
): Promise<MedhaIdResult<ReactionSummary>> {
  return callMedhaId<ReactionSummary>({
    path: `/v1/notes/${enc(ownerId)}/${enc(noteId)}/reactions`,
    method: 'DELETE',
    requireAuth: true,
    tag: 'DELETE note reaction',
  });
}

// ── Comments ──────────────────────────────────────────────────────────────────

export function getComments(
  ownerId: string,
  noteId: string,
): Promise<MedhaIdResult<{ comments: NoteComment[] }>> {
  return callMedhaId<{ comments: NoteComment[] }>({
    path: `/v1/notes/${enc(ownerId)}/${enc(noteId)}/comments`,
    method: 'GET',
    requireAuth: true,
    tag: 'GET note comments',
  });
}

export function addComment(
  ownerId: string,
  noteId: string,
  body: string,
): Promise<MedhaIdResult<{ ok: boolean; id: string; comments: NoteComment[] }>> {
  return callMedhaId<{ ok: boolean; id: string; comments: NoteComment[] }>({
    path: `/v1/notes/${enc(ownerId)}/${enc(noteId)}/comments`,
    method: 'POST',
    requireAuth: true,
    body: { body },
    tag: 'POST note comment',
  });
}

export function deleteComment(
  ownerId: string,
  noteId: string,
  commentId: string,
): Promise<MedhaIdResult<{ ok: boolean; comments: NoteComment[] }>> {
  return callMedhaId<{ ok: boolean; comments: NoteComment[] }>({
    path: `/v1/notes/${enc(ownerId)}/${enc(noteId)}/comments/${enc(commentId)}`,
    method: 'DELETE',
    requireAuth: true,
    tag: 'DELETE note comment',
  });
}
