import { callMedhaId, type MedhaIdResult } from './medhaId';
import { type ReactionSummary } from './noteMedia';

// Voice-note sharing + the shared-note feeds on medha-id. Distinct from
// lib/shares.ts (the general privacy-ledger engine for experiences/posts): this
// surface is note-scoped and drives the record-box share control, the 3-dots
// "Sharing" modal, the "From your network" feed, and each circle's Feed tab.
//
// Same authed transport + typed {ok} envelope as the rest of the app; callers
// branch on `res.ok`.

// A note's audience. 'private' un-shares it. 'network' = the whole connected
// network. 'circle'/'contact' require a targetId (the circle id / contact id).
export type NoteVisibility = 'private' | 'network' | 'circle' | 'contact';

// The scope chosen in the record box / sharing modal. targetId is required for
// 'circle' and 'contact'; targetName is display-only (never sent).
export type NoteShareScope = {
  visibility: NoteVisibility;
  targetId?: string | null;
  targetName?: string | null;
};

export type NoteShareState = {
  noteId: string;
  visibility: NoteVisibility;
  targetId: string | null;
  targetName: string | null;
};

// Read a note's current audience. Used by the 3-dots "Sharing" modal to
// pre-select what it's shared with today.
export function getNoteShare(id: string): Promise<MedhaIdResult<NoteShareState>> {
  return callMedhaId<NoteShareState>({
    path: `/v1/me/notes/${encodeURIComponent(id)}/share`,
    method: 'GET',
    requireAuth: true,
  });
}

// Set (or clear, via 'private') a note's audience. targetId is only sent for
// circle/contact scopes.
export function setNoteShare(
  id: string,
  scope: NoteShareScope,
): Promise<MedhaIdResult<{ noteId: string; visibility: NoteVisibility; targetId: string | null }>> {
  const needsTarget = scope.visibility === 'circle' || scope.visibility === 'contact';
  return callMedhaId<{ noteId: string; visibility: NoteVisibility; targetId: string | null }>({
    path: `/v1/me/notes/${encodeURIComponent(id)}/share`,
    method: 'PUT',
    body: {
      visibility: scope.visibility,
      ...(needsTarget && scope.targetId ? { targetId: scope.targetId } : {}),
    },
    requireAuth: true,
  });
}

// ── Feeds ────────────────────────────────────────────────────────

export type FeedShareType = 'network' | 'circle' | 'contact';

export type FeedSharedBy = {
  amberId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
};

export type FeedItem = {
  noteId: string;
  shareType: FeedShareType;
  transcript: string;
  sharedAt: string;
  sharedBy: FeedSharedBy;
  circleId?: string | null;
  circleName?: string | null;
  /**
   * Audio, reactions and comment count come back WITH the feed — three queries
   * for the page rather than three per note. `audio` is null for transcript-only
   * notes, which is every note whose sender never recorded one.
   */
  audio?: { durationMs: number; byteSize: number; peaks: number[] } | null;
  /**
   * Reuses ReactionSummary rather than re-declaring the reaction union inline. The
   * union WAS spelled out here, so adding a fifth tapback silently left this type
   * describing four while every other file described five — the compiler then
   * rejected passing a feed item's reactions into the component that renders them,
   * which is the good outcome; the bad one would have been a runtime `undefined`
   * count. One source of truth, in lib/noteMedia.ts.
   */
  reactions?: ReactionSummary | null;
  commentCount?: number;
};

// The "From your network" feed: every note shared with the caller (network-wide
// or via a circle they're in), newest first.
export function getNetworkFeed(
  limit = 30,
  window?: { from: Date; to: Date },
  transport: { signal?: AbortSignal; timeoutMs?: number; retries?: number } = {},
): Promise<MedhaIdResult<{ items: FeedItem[] }>> {
  return callMedhaId<{ items: FeedItem[] }>({
    path: `/v1/me/feed?limit=${encodeURIComponent(String(limit))}${window ? `&from=${encodeURIComponent(window.from.toISOString())}&to=${encodeURIComponent(window.to.toISOString())}` : ''}`,
    method: 'GET',
    requireAuth: true,
    ...transport,
  });
}

// One circle's shared-note feed. The plain feed (no `q`) auto-marks these notes
// seen on this GET, so callers should refetch the circles list afterward to drop
// the unseen dot. Passing `q` turns this into a transcript SEARCH — the same
// member-scoped feed, filtered server-side to notes whose transcript contains
// the keyword (case-insensitive) — and does NOT mark the circle seen.
export function getCircleFeed(
  id: string,
  opts: { limit?: number; q?: string } = {},
): Promise<MedhaIdResult<{ circleId: string; items: FeedItem[] }>> {
  const limit = opts.limit ?? 30;
  const parts = [`limit=${encodeURIComponent(String(limit))}`];
  const q = opts.q?.trim();
  if (q) parts.push(`q=${encodeURIComponent(q)}`);
  return callMedhaId<{ circleId: string; items: FeedItem[] }>({
    path: `/v1/me/circles/${encodeURIComponent(id)}/feed?${parts.join('&')}`,
    method: 'GET',
    requireAuth: true,
  });
}
