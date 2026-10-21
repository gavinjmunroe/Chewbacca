/**
 * ANSWERING SOMETHING IN THE FEED: a small set of reactions, and comments.
 *
 * "The only kind of functionality change you're making is the ability to react
 * to people's feed information."
 *
 * THE VOCABULARY IS THE ONE DMs ALREADY USE -- five kinds, the same five,
 * checked by the same CHECK constraint in the database (migration 017 for DMs,
 * 044 for posts). Two different reaction alphabets in one app would mean the
 * heart you put on a message and the heart you put on a post were different
 * things, and every screen that showed both would have to know which was which.
 *
 * WHY A `kind` AND NOT AN EMOJI STRING. The server stores 'laugh', not '😂'.
 * An emoji is a rendering of a reaction, and renderings change -- a redesign
 * that picked warmer faces would otherwise have to migrate a table. It also
 * makes the set closed, which is what makes "who laughed at this" answerable.
 *
 * The pure half of this file is the table below and the three functions under
 * it; everything after the transport rule is a network call. Only the pure half
 * is tested, and it is the half that can be wrong in a way you would not see.
 */
import { callMedhaId } from './medhaId';
import {
  REACTION_EMOJI,
  REACTION_LABEL,
  REACTION_ORDER,
  type ReactionKind,
} from './noteMedia';

export type { ReactionKind };

/**
 * THE VOCABULARY IS NOT DECLARED HERE, and the first version of this file got
 * that wrong.
 *
 * It shipped with its own five kinds, its own emoji and its own labels -- a
 * second copy of something lib/noteMedia.ts has owned since voice notes got
 * tapbacks, and which the DM thread and the circle feed already draw from. Two
 * copies of a closed set is how a reaction ends up meaning one thing on a post
 * and another on the note directly below it, and it was already drifting: this
 * file called `like` a heart, and everywhere else in the app `like` is a
 * thumbs-up.
 *
 * So the list, the emoji, the labels and the order all come from there now. What
 * this file owns is the arithmetic -- what a tap does to the counts -- which is
 * genuinely its own and is what the tests below are about.
 */
export const REACTIONS: { kind: ReactionKind; emoji: string; label: string }[] =
  REACTION_ORDER.map((kind) => ({
    kind,
    emoji: REACTION_EMOJI[kind],
    label: REACTION_LABEL[kind],
  }));

/** The emoji for a kind, or null when the server sent one we do not render. */
export function reactionEmoji(kind: string | null | undefined): string | null {
  if (!kind) return null;
  return (REACTION_EMOJI as Record<string, string | undefined>)[kind] ?? null;
}

/** Counts per kind, plus whichever one is yours. Mirrors the server's shape. */
export type PostReactions = {
  counts: Partial<Record<ReactionKind, number>>;
  mine: ReactionKind | null;
};

export type PostSocial = {
  reactions: PostReactions;
  commentCount: number;
  /**
   * The first two comments, carried with the feed page so the card can draw
   * them without a round trip. See socialForPosts on the server for why they
   * are the two most RECENT rather than the two oldest.
   */
  comments?: PostComment[];
};

/** What an empty post looks like, so nothing has to check for undefined. */
export const NO_SOCIAL: PostSocial = {
  reactions: { counts: {}, mine: null },
  commentCount: 0,
  comments: [],
};

/**
 * The reaction row as the card draws it: only kinds anybody actually used, in
 * the offered order, with a total.
 *
 * A ZERO IS DROPPED RATHER THAN DRAWN. Clearing your reaction leaves the key
 * behind with a 0 in the local copy, and a row reading "😂 0" is worse than no
 * row at all -- it says somebody laughed and then says nobody did.
 *
 * Unknown kinds are dropped too. A newer client could react with something this
 * build has no emoji for, and a blank chip with a number beside it is a bug
 * everybody reports.
 */
export function summarizeReactions(
  reactions: PostReactions | null | undefined,
): { kind: ReactionKind; emoji: string; count: number; mine: boolean }[] {
  const counts = reactions?.counts ?? {};
  const mine = reactions?.mine ?? null;
  const out: { kind: ReactionKind; emoji: string; count: number; mine: boolean }[] = [];
  for (const r of REACTIONS) {
    const n = Number(counts[r.kind] ?? 0);
    if (!Number.isFinite(n) || n <= 0) continue;
    out.push({ kind: r.kind, emoji: r.emoji, count: n, mine: mine === r.kind });
  }
  return out;
}

/** The total across every kind, for the "3 reactions" line. */
export function totalReactions(reactions: PostReactions | null | undefined): number {
  return summarizeReactions(reactions).reduce((n, r) => n + r.count, 0);
}

/**
 * WHAT THE ROW LOOKS LIKE THE INSTANT YOU TAP, before the server has answered.
 *
 * Three moves, and tapping is the only input:
 *   nothing → laugh    add one laugh
 *   laugh   → laugh    take it back, because tapping the thing you already
 *                      chose is how every messaging app un-chooses it
 *   laugh   → like     move: one off laugh, one onto like. NOT one of each --
 *                      the primary key is (post, person), so the server can
 *                      only ever hold one, and a client that showed two would
 *                      correct itself on the next refresh and look broken.
 *
 * Pure, and it returns the NEXT reactions rather than mutating, so the caller
 * can keep the previous value to roll back to when the write fails.
 */
export function applyReaction(
  reactions: PostReactions | null | undefined,
  tapped: ReactionKind,
): PostReactions {
  const counts: Partial<Record<ReactionKind, number>> = { ...(reactions?.counts ?? {}) };
  const mine = reactions?.mine ?? null;
  const drop = (k: ReactionKind) => {
    const n = (counts[k] ?? 0) - 1;
    if (n > 0) counts[k] = n;
    else delete counts[k];
  };
  if (mine) drop(mine);
  if (mine === tapped) return { counts, mine: null };
  counts[tapped] = (counts[tapped] ?? 0) + 1;
  return { counts, mine: tapped };
}

/** What to send for a tap: the kind, or null when it is being taken back. */
export function nextKind(
  reactions: PostReactions | null | undefined,
  tapped: ReactionKind,
): ReactionKind | null {
  return (reactions?.mine ?? null) === tapped ? null : tapped;
}

// ── the network ─────────────────────────────────────────────────────────────

export type PostComment = {
  commentId: string;
  /** The transcript, for a voice comment. Empty when there were no words. */
  text: string;
  createdAt: string;
  mine: boolean;
  /** The clip, when this comment is a recording. Peaks, never a URL. */
  audio?: { mediaId: string; durationMs: number; peaks: number[] } | null;
  author: {
    amberId: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
  };
};

/** The longest a comment may be. The server enforces the same number. */
export const COMMENT_MAX = 2000;

/**
 * Set or clear your reaction. PUT, because there is one per person per post and
 * doing it twice is the same as doing it once.
 *
 * Returns the server's counts on success and null on any failure, so the caller
 * knows to roll its optimistic copy back rather than leaving a reaction on
 * screen that nobody else will ever see.
 */
export async function setPostReaction(
  postId: string,
  kind: ReactionKind | null,
): Promise<PostReactions | null> {
  const res = await callMedhaId<{ reactions: PostReactions }>({
    path: `/v1/me/connect/feed/${encodeURIComponent(postId)}/reaction`,
    method: 'PUT',
    body: { kind },
    requireAuth: true,
    retries: 0,
  });
  return res.ok && res.data?.reactions ? res.data.reactions : null;
}

/** Every comment on a post, oldest first. null means the post is not visible. */
export async function listPostComments(postId: string): Promise<PostComment[] | null> {
  const res = await callMedhaId<{ comments: PostComment[] }>({
    path: `/v1/me/connect/feed/${encodeURIComponent(postId)}/comments`,
    method: 'GET',
    requireAuth: true,
  });
  return res.ok && Array.isArray(res.data?.comments) ? res.data.comments : null;
}

/** Say something. Returns the created row, or null if it did not save. */
export async function addPostComment(
  postId: string,
  text: string,
  mediaId?: string,
): Promise<PostComment | null> {
  const body = text.trim();
  // A VOICE COMMENT MAY HAVE NO WORDS -- a failed transcription, or two seconds
  // of laughing. What is never a comment is neither words nor a clip.
  if (body.length === 0 && !mediaId) return null;
  if (body.length > COMMENT_MAX) return null;
  const res = await callMedhaId<{ comment: PostComment }>({
    path: `/v1/me/connect/feed/${encodeURIComponent(postId)}/comments`,
    method: 'POST',
    body: mediaId ? { text: body, mediaId } : { text: body },
    requireAuth: true,
    retries: 0,
  });
  return res.ok && res.data?.comment ? res.data.comment : null;
}

/** Delete your own comment. */
export async function deletePostComment(commentId: string): Promise<boolean> {
  const res = await callMedhaId<{ deleted: boolean }>({
    path: `/v1/me/connect/feed/comments/${encodeURIComponent(commentId)}`,
    method: 'DELETE',
    requireAuth: true,
    retries: 0,
  });
  return res.ok;
}

/** Somebody who reacted to a post, for the long press on the reaction row. */
export type PostReactor = {
  kind: ReactionKind;
  reactedAt: string;
  mine: boolean;
  person: {
    amberId: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
  };
};

/**
 * Who reacted, and with what.
 *
 * A READ OF ITS OWN, not a field on the feed. Every card needs the counts and
 * one card at a time needs the names, so shipping every reactor with every page
 * would make a busy feed pay for a gesture almost nobody performs on almost
 * every post. null means the post is not visible (or the read failed), and the
 * sheet says so rather than drawing an empty list that reads as "nobody".
 */
export async function listPostReactors(postId: string): Promise<PostReactor[] | null> {
  const res = await callMedhaId<{ reactors: PostReactor[] }>({
    path: `/v1/me/connect/feed/${encodeURIComponent(postId)}/reactions`,
    method: 'GET',
    requireAuth: true,
  });
  return res.ok && Array.isArray(res.data?.reactors) ? res.data.reactors : null;
}
