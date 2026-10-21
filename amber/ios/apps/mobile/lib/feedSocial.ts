/**
 * ONE FEED, TWO KINDS OF THING IN IT, ONE WAY TO ANSWER THEM.
 *
 * The home feed holds two genuinely different rows:
 *
 *   A SHARED NOTE   somebody's voice note, shared to the network or to a
 *                   circle. Reactions and comments live under
 *                   /v1/notes/:ownerId/:noteId/* and have since voice notes
 *                   got tapbacks.
 *   A NETWORK POST  a wall post from a connection. Reactions and comments live
 *                   under /v1/me/connect/feed/:postId/* and are new.
 *
 * Two stores, two id shapes, two sets of routes -- and one card, because to the
 * person reading the page they are both "something somebody said". Without this
 * file the card would have to know which kind it is drawing and branch on it in
 * five places, which is how the two drift into looking different.
 *
 * SO THE CARD TAKES ACTIONS, NOT IDS. Each row builds the four calls its own
 * store needs and hands them over; the card knows how to draw a reaction row and
 * nothing about where reactions are kept. The adapters are the only place either
 * API is named.
 */
import {
  addComment as addNoteComment,
  clearReaction as clearNoteReaction,
  deleteComment as deleteNoteComment,
  getComments as getNoteComments,
  getReactions as getNoteReactions,
  setReaction as setNoteReaction,
  type ReactionKind,
  type ReactionSummary,
} from './noteMedia';
import {
  addPostComment,
  deletePostComment,
  listPostComments,
  listPostReactors,
  setPostReaction,
  type PostComment,
  type PostReactions,
  type PostReactor,
} from './postSocial';

/** A comment as the card draws it, whichever store it came from. */
export type FeedComment = {
  id: string;
  text: string;
  createdAt: string;
  mine: boolean;
  author: { name: string | null; avatarUrl: string | null };
  /**
   * A VOICE COMMENT'S CLIP: enough to draw the waveform, and no URL.
   *
   * The peaks are the SPEAKER'S, sampled while they talked, so two people
   * looking at the same comment see the same shape. The playback URL is signed
   * and dies in minutes, so it is fetched on the first play rather than baked
   * into a list that can sit in a cache -- see commentAudioUrl.
   */
  audio: { mediaId: string; durationMs: number; peaks: number[] } | null;
};

/** Somebody who reacted, for the long press. */
export type FeedReactor = {
  kind: ReactionKind;
  name: string | null;
  avatarUrl: string | null;
  mine: boolean;
};

/** What the card needs to draw the bar, whichever store it came from. */
export type FeedSocial = {
  reactions: PostReactions;
  commentCount: number;
  /** The first two, carried with the feed so the card draws them immediately. */
  comments: FeedComment[];
};

/** What the card needs to CHANGE any of it. Every one may fail and say so. */
export type FeedActions = {
  react: (kind: ReactionKind | null) => Promise<PostReactions | null>;
  loadComments: () => Promise<FeedComment[] | null>;
  /** `mediaId` attaches a recorded clip; the text is then its transcript. */
  addComment: (text: string, mediaId?: string) => Promise<FeedComment | null>;
  deleteComment: (id: string) => Promise<boolean>;
  loadReactors: () => Promise<FeedReactor[] | null>;
};

export const EMPTY_SOCIAL: FeedSocial = {
  reactions: { counts: {}, mine: null },
  commentCount: 0,
  comments: [],
};

/** A name for somebody, from whichever of the three fields is filled in. */
function personName(p: {
  fullName?: string | null;
  name?: string | null;
  username?: string | null;
}): string | null {
  return p?.fullName?.trim() || p?.name?.trim() || p?.username?.trim() || null;
}

function fromPostComment(c: PostComment): FeedComment {
  return {
    id: c.commentId,
    text: c.text,
    createdAt: c.createdAt,
    mine: c.mine,
    author: { name: personName(c.author), avatarUrl: c.author.avatarUrl ?? null },
    audio: c.audio ?? null,
  };
}

/**
 * THE NOTE STORE'S REACTION SHAPE IS NOT THE POST STORE'S, and this is where
 * that stops mattering.
 *
 * `ReactionSummary` carries counts for every kind including the zeroes, a
 * total, and sometimes the people. `PostReactions` carries only the kinds
 * anybody used. The card reads the second, so the first is narrowed here --
 * dropping the zeroes rather than passing them through, because a zero drawn as
 * a chip is the "😂 0" that says somebody laughed and then says nobody did.
 */
export function narrowSummary(s: ReactionSummary | null | undefined): PostReactions {
  const counts: PostReactions['counts'] = {};
  for (const [kind, n] of Object.entries(s?.counts ?? {})) {
    if (Number.isFinite(n) && Number(n) > 0) counts[kind as ReactionKind] = Number(n);
  }
  return { counts, mine: s?.mine ?? null };
}

/** Everything the card can do to a NETWORK POST. */
export function postActions(postId: string): FeedActions {
  return {
    react: (kind) => setPostReaction(postId, kind),
    loadComments: async () => {
      const rows = await listPostComments(postId);
      return rows === null ? null : rows.map(fromPostComment);
    },
    addComment: async (text, mediaId) => {
      const c = await addPostComment(postId, text, mediaId);
      return c ? fromPostComment(c) : null;
    },
    deleteComment: (id) => deletePostComment(id),
    loadReactors: async () => {
      const rows = await listPostReactors(postId);
      return rows === null
        ? null
        : rows.map((r: PostReactor) => ({
            kind: r.kind,
            name: personName(r.person),
            avatarUrl: r.person.avatarUrl ?? null,
            mine: r.mine,
          }));
    },
  };
}

/** Everything the card can do to a SHARED NOTE. */
export function noteActions(ownerId: string, noteId: string, meAmberId?: string | null): FeedActions {
  const mineOf = (amberId: string | null | undefined) =>
    !!meAmberId && String(amberId) === String(meAmberId);
  return {
    react: async (kind) => {
      const res = kind
        ? await setNoteReaction(ownerId, noteId, kind)
        : await clearNoteReaction(ownerId, noteId);
      return res.ok ? narrowSummary(res.data) : null;
    },
    loadComments: async () => {
      const res = await getNoteComments(ownerId, noteId);
      if (!res.ok) return null;
      return (res.data?.comments ?? []).map((c) => ({
        id: c.id,
        text: c.body,
        createdAt: c.createdAt,
        mine: mineOf(c.author?.amberId),
        author: { name: personName(c.author ?? {}), avatarUrl: c.author?.avatarUrl ?? null },
        /**
         * THE NOTE STORE HAS NO COMMENT AUDIO. Voice comments are a post_comments
         * feature (migration 047); note comments are text-only and their route
         * carries no clip. `null` is the truthful answer, not a gap to fill in
         * later with something invented.
         */
        audio: null,
      }));
    },
    /**
     * THE NOTE STORE ANSWERS WITH THE WHOLE LIST, not with the row it just
     * wrote -- `{ ok, id, comments }`. So the created comment is found by the
     * id it returned rather than assumed to be the last element: "last" is only
     * true while the list is sorted the way this expects, and a sort order is
     * exactly the kind of thing that changes on the server without anybody
     * thinking about this call site.
     */
    addComment: async (text) => {
      const res = await addNoteComment(ownerId, noteId, text);
      if (!res.ok || !res.data?.id) return null;
      const made = (res.data.comments ?? []).find((c) => String(c.id) === String(res.data!.id));
      if (!made) return null;
      return {
        id: made.id,
        text: made.body,
        createdAt: made.createdAt,
        // Freshly written by whoever is holding the phone.
        mine: true,
        author: { name: personName(made.author ?? {}), avatarUrl: made.author?.avatarUrl ?? null },
        audio: null,
      };
    },
    deleteComment: async (id) => (await deleteNoteComment(ownerId, noteId, id)).ok,
    /**
     * THE NOTE STORE ALREADY ANSWERS THIS, and it does it in the summary rather
     * than on a route of its own: `ReactionSummary.people` is the list. So a
     * long press re-reads the summary instead of calling a second endpoint that
     * does not exist on this side.
     */
    loadReactors: async () => {
      const res = await getNoteReactions(ownerId, noteId);
      if (!res.ok) return null;
      return (res.data?.people ?? []).map((p) => ({
        kind: p.kind,
        name: personName(p),
        avatarUrl: p.avatarUrl ?? null,
        mine: mineOf(p.amberId),
      }));
    },
  };
}
