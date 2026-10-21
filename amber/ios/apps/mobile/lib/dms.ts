import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { callMedhaId, type MedhaIdResult } from './medhaId';
import type { ReactionKind } from './noteMedia';
import { mergeMessages } from './dmsMerge';

// Direct messages. One thread per pair of Amber users; text and voice memos with
// a transcript underneath, reactions on every message.
//
// DELIVERY IS POLL-WHILE-OPEN PLUS PUSH-WHEN-CLOSED. There is no socket: an open
// thread polls, and a message arriving while the app is backgrounded comes
// through the push token you already have. That is the same shape
// usePendingResolutions already uses, and it needs no new infrastructure.

const enc = encodeURIComponent;

export type DmPerson = {
  amberId: string;
  username: string | null;
  name: string | null;
  avatarUrl: string | null;
  /**
   * The VIEWER'S own contact card for this account, when they have one.
   *
   * A thread knows the account; everything else in the app is keyed by contact
   * -- their card, their facts, their rank -- so without this the Info tab could
   * show a name and nothing else. Null when nobody in the address book is linked
   * to them (you can be messaged by someone you have never saved).
   */
  contactId?: string | null;
};

export type DmMessage = {
  id: string;
  /** True when the signed-in user sent it. Drives which side the bubble sits on. */
  mine: boolean;
  kind: 'text' | 'voice';
  /** The text, or a voice memo's transcript. Null while a transcript is pending. */
  body: string | null;
  durationMs: number;
  byteSize: number;
  /** The SENDER's waveform, 0..100 per sample. */
  peaks: number[];
  audioStatus: 'none' | 'pending' | 'ready';
  createdAt: string;
  reactions: { counts: Partial<Record<ReactionKind, number>>; mine: ReactionKind | null };
  /**
   * When this message was pinned, null or absent otherwise. A pin is SHARED --
   * one bookmark on the thread, the way it works in every messenger people
   * already use -- and `pinnedByMe` says whose it is.
   */
  pinnedAt?: string | null;
  pinnedByMe?: boolean;
};

export type DmThread = {
  threadId: string;
  other: DmPerson;
  unread: number;
  blocked: boolean;
  last: {
    id: string;
    kind: 'text' | 'voice';
    body: string | null;
    durationMs: number;
    mine: boolean;
    createdAt: string;
  };
};

/** A contact who is on Amber, so a real thread can exist. */
export type DmCandidate = {
  contactId: string;
  name: string | null;
  amberId: string;
  username: string | null;
  avatarUrl: string | null;
};

/** A contact who is NOT on Amber. Carries the number for the iMessage hand-off. */
export type DmInvitee = {
  contactId: string;
  name: string | null;
  phone: string | null;
};

// ── Reads ─────────────────────────────────────────────────────────────────────

export function listDmThreads(): Promise<MedhaIdResult<{ threads: DmThread[] }>> {
  return callMedhaId<{ threads: DmThread[] }>({
    path: '/v1/me/dms',
    method: 'GET',
    requireAuth: true,
    tag: 'GET dm threads',
  });
}

/**
 * Who you can message, and who you would have to invite.
 *
 * IT USED TO SEND THE IDS. Up to 200 contact uuids in the query string —
 * roughly 7KB of URL — and the server then did two sequential lookups per id,
 * so a full address book meant four hundred round trips on every keystroke.
 * That request either timed out or took long enough to look like a hang, which
 * is what "direct messages isn't working" turned out to be.
 *
 * The server answers the question itself now. No `q` means "everyone I can
 * actually message" — the people whose contact card resolves to an account,
 * which is a short and genuinely useful list. A `q` searches the whole address
 * book server-side and splits the results into the two groups.
 */
export function dmCandidates(
  opts: { q?: string; limit?: number } = {},
): Promise<MedhaIdResult<{ messageable: DmCandidate[]; invite: DmInvitee[] }>> {
  const parts: string[] = [];
  const q = opts.q?.trim();
  if (q) parts.push(`q=${enc(q)}`);
  if (opts.limit) parts.push(`limit=${enc(String(opts.limit))}`);
  return callMedhaId<{ messageable: DmCandidate[]; invite: DmInvitee[] }>({
    path: `/v1/me/dms/candidates${parts.length ? `?${parts.join('&')}` : ''}`,
    method: 'GET',
    requireAuth: true,
    tag: 'GET dm candidates',
  });
}

export function listDmMessages(
  threadId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<MedhaIdResult<{ messages: DmMessage[] }>> {
  const q = new URLSearchParams();
  if (opts.before) q.set('before', opts.before);
  if (opts.limit) q.set('limit', String(opts.limit));
  const qs = q.toString();
  return callMedhaId<{ messages: DmMessage[] }>({
    path: `/v1/me/dms/${enc(threadId)}/messages${qs ? `?${qs}` : ''}`,
    method: 'GET',
    requireAuth: true,
    tag: 'GET dm messages',
  });
}

export function searchDmThread(
  threadId: string,
  q: string,
): Promise<MedhaIdResult<{ query: string; messages: DmMessage[] }>> {
  return callMedhaId<{ query: string; messages: DmMessage[] }>({
    path: `/v1/me/dms/${enc(threadId)}/search?q=${enc(q)}`,
    method: 'GET',
    requireAuth: true,
    tag: 'GET dm search',
  });
}

export type DmExportRow = {
  id: string;
  mine: boolean;
  author: string;
  kind: 'text' | 'voice';
  body: string | null;
  durationMs: number;
  createdAt: string;
};

export function exportDmThread(
  threadId: string,
): Promise<MedhaIdResult<{ threadId: string; count: number; messages: DmExportRow[] }>> {
  return callMedhaId<{ threadId: string; count: number; messages: DmExportRow[] }>({
    path: `/v1/me/dms/${enc(threadId)}/export`,
    method: 'GET',
    requireAuth: true,
    tag: 'GET dm export',
  });
}

// ── Writes ────────────────────────────────────────────────────────────────────

/**
 * Open (or create) a thread. Pass a contactId — the server resolves it to an
 * Amber account, so you can only open a thread with someone in your own address
 * book. A 409 means they are not on Amber and carries the invite details.
 */
export function openDmThread(
  args: { contactId?: string; amberId?: string },
): Promise<MedhaIdResult<{ threadId: string; otherAmberId: string }>> {
  return callMedhaId<{ threadId: string; otherAmberId: string }>({
    path: '/v1/me/dms/open',
    method: 'POST',
    requireAuth: true,
    body: args,
    tag: 'POST dm open',
  });
}

export function sendDmText(
  threadId: string,
  body: string,
): Promise<MedhaIdResult<{ message: DmMessage }>> {
  return callMedhaId<{ message: DmMessage }>({
    path: `/v1/me/dms/${enc(threadId)}/messages`,
    method: 'POST',
    requireAuth: true,
    body: { body },
    tag: 'POST dm message',
  });
}

export function setDmReaction(
  messageId: string,
  kind: ReactionKind | null,
): Promise<MedhaIdResult<{ reactions: DmMessage['reactions'] }>> {
  return callMedhaId<{ reactions: DmMessage['reactions'] }>({
    path: `/v1/me/dms/messages/${enc(messageId)}/reaction`,
    method: 'POST',
    requireAuth: true,
    body: { kind },
    tag: 'POST dm reaction',
  });
}

export function markDmRead(
  threadId: string,
  messageId: string,
): Promise<MedhaIdResult<{ ok: boolean }>> {
  return callMedhaId<{ ok: boolean }>({
    path: `/v1/me/dms/${enc(threadId)}/read`,
    method: 'POST',
    requireAuth: true,
    body: { messageId },
    tag: 'POST dm read',
  });
}

/** Clears YOUR copy. The other person keeps theirs — see the server's dm_clears. */
export function clearDmThread(
  threadId: string,
): Promise<MedhaIdResult<{ ok: boolean; cleared: boolean }>> {
  return callMedhaId<{ ok: boolean; cleared: boolean }>({
    path: `/v1/me/dms/${enc(threadId)}`,
    method: 'DELETE',
    requireAuth: true,
    tag: 'DELETE dm thread',
  });
}

export function setDmBlock(
  threadId: string,
  blocked: boolean,
): Promise<MedhaIdResult<{ ok: boolean; blocked: boolean }>> {
  return callMedhaId<{ ok: boolean; blocked: boolean }>({
    path: `/v1/me/dms/${enc(threadId)}/block`,
    method: 'POST',
    requireAuth: true,
    body: { blocked },
    tag: 'POST dm block',
  });
}

// ── Pins ──────────────────────────────────────────────────────────────────────

/**
 * Pin or unpin one message.
 *
 * What people pin in a chat is the voice memo, or the one line with the address
 * in it -- and in a thread that has run for months, scrolling is not a way back
 * to it. Membership of the thread is the permission server-side, so pinning what
 * THEY said works, which is the common case.
 */
export function pinDmMessage(
  messageId: string,
  pinned: boolean,
): Promise<MedhaIdResult<{ message: DmMessage; pinned: boolean }>> {
  return callMedhaId<{ message: DmMessage; pinned: boolean }>({
    path: `/v1/me/dms/messages/${enc(messageId)}/pin`,
    method: 'POST',
    requireAuth: true,
    body: { pinned },
    retries: 0,
    tag: 'POST dm pin',
  });
}

/** This thread's pinned messages, newest pin first. */
export function listPinnedDmMessages(
  threadId: string,
): Promise<MedhaIdResult<{ messages: DmMessage[] }>> {
  return callMedhaId<{ messages: DmMessage[] }>({
    path: `/v1/me/dms/${enc(threadId)}/pinned`,
    method: 'GET',
    requireAuth: true,
    tag: 'GET dm pinned',
  });
}

// ── Voice ─────────────────────────────────────────────────────────────────────

export type DmAudio = {
  playbackUrl: string;
  /** Seconds until the signed URL dies. Re-fetch rather than caching the URL. */
  expiresIn: number;
  contentType: string;
  durationMs: number;
  byteSize: number;
  peaks: number[];
};

export function getDmAudio(messageId: string): Promise<MedhaIdResult<DmAudio>> {
  return callMedhaId<DmAudio>({
    path: `/v1/me/dms/voice/${enc(messageId)}`,
    method: 'GET',
    requireAuth: true,
    tag: 'GET dm audio',
  });
}

type UploadTicket = {
  messageId: string;
  uploadUrl: string;
  contentType: string;
  expiresIn: number;
  maxBytes: number;
  maxDurationMs: number;
};

/**
 * Send a voice memo. Three legs, same as note audio, because the server refuses
 * to take the client's word for any of it:
 *   1. reserve the message and get a signed PUT (the server mints the key)
 *   2. PUT the bytes straight to Google — they never pass through medha-id
 *   3. finalize, at which point the server HEADs the object for the real size
 *
 * The transcript rides along on leg 3. A clip whose upload dies leaves a pending
 * row that is never served, so a half-uploaded memo is invisible rather than
 * broken.
 */
export async function sendDmVoice(
  threadId: string,
  fileUri: string,
  { durationMs, peaks, transcript }: { durationMs: number; peaks: number[]; transcript?: string },
): Promise<DmMessage | null> {
  const ticket = await callMedhaId<UploadTicket>({
    path: `/v1/me/dms/${enc(threadId)}/voice/upload-url`,
    method: 'POST',
    requireAuth: true,
    body: { contentType: 'audio/m4a' },
    tag: 'POST dm voice upload-url',
  });
  if (!ticket.ok) return null;

  let blob: Blob;
  try {
    const res = await fetch(fileUri);
    const raw = await res.blob();
    // Re-type the blob rather than only setting the header: React Native sends a
    // Blob's own `type` as Content-Type, which would override ours and break the
    // signature — content-type is signed INTO the URL, so a mismatch is a 403.
    blob = raw.slice(0, raw.size, ticket.data.contentType);
  } catch {
    return null;
  }
  if (blob.size > ticket.data.maxBytes) return null;

  try {
    const put = await fetch(ticket.data.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': ticket.data.contentType },
      body: blob,
    });
    if (!put.ok) return null;
  } catch {
    return null;
  }

  const done = await callMedhaId<{ message: DmMessage }>({
    path: `/v1/me/dms/voice/${enc(ticket.data.messageId)}`,
    method: 'POST',
    requireAuth: true,
    body: {
      durationMs: Math.max(0, Math.min(ticket.data.maxDurationMs, Math.round(durationMs))),
      peaks: peaks.slice(0, 400),
      ...(transcript?.trim() ? { transcript: transcript.trim() } : {}),
    },
    tag: 'POST dm voice finalize',
  });
  return done.ok ? done.data.message : null;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * The thread list for the People-tab section. Refetches on focus and on a slow
 * timer — this is a summary strip, not an open conversation, so it does not need
 * conversation-grade polling.
 */
export function useDmThreads(pollMs = 20_000) {
  const [threads, setThreads] = useState<DmThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    const res = await listDmThreads();
    if (res.ok) {
      setThreads(res.data?.threads ?? []);
      setError(false);
    } else {
      // A FAILED LOAD IS NOT AN EMPTY LIST. Keep whatever we already have and
      // say so, rather than rendering "no messages yet" over a network blip.
      setError(true);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      const t = setInterval(() => void load(), pollMs);
      return () => clearInterval(t);
    }, [load, pollMs]),
  );

  return { threads, loading, error, reload: load };
}

/**
 * One open conversation: a page of messages, a poll for new ones, and paging
 * back through history.
 *
 * The poll asks only for what is NEWER than the newest message it holds, so a
 * long thread costs one small request every few seconds rather than re-fetching
 * the page. New messages are merged by id, so a message that arrives both from
 * the poll and from our own send cannot appear twice.
 */
export function useDmConversation(threadId: string | null, pollMs = 4000) {
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Held in a ref as well as state: the poll closure needs the current newest id
  // without re-subscribing the interval on every message.
  const newestRef = useRef<string | null>(null);
  const alive = useRef(true);

  /**
   * A POLL THAT BROUGHT BACK THE SAME ROWS MUST NOT LOOK LIKE A CHANGE.
   *
   * This used to unconditionally rebuild the array and replace every message
   * OBJECT with the freshly parsed one, whether or not a single field differed.
   * The values were always right and nothing on screen was ever wrong -- but
   * React compares by identity, so every visible bubble re-rendered every four
   * seconds forever, a voice row rebuilding its waveform and player with it,
   * and the mark-read effect keyed on `messages` fired a write on every tick.
   * A hitch every four seconds while you are typing into that screen is not a
   * separate bug from "typing is laggy"; it is most of it.
   *
   * lib/dmsMerge returns THIS ARRAY when nothing changed, and keeps the existing
   * object for every row that did not. See the tests there -- they assert
   * identity, which is the only way to catch a merge that reports a change that
   * did not happen.
   */
  const merge = useCallback((incoming: DmMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const next = mergeMessages(prev, incoming);
      if (next === prev) return prev;
      newestRef.current = next[0]?.id ?? null;
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    if (!threadId) return;
    const res = await listDmMessages(threadId, { limit: 40 });
    if (!alive.current) return;
    if (res.ok) {
      const list = res.data?.messages ?? [];
      setMessages(list);
      newestRef.current = list[0]?.id ?? null;
      setHasMore(list.length >= 40);
    }
    setLoading(false);
  }, [threadId]);

  const loadMore = useCallback(async () => {
    if (!threadId || loadingMore || !hasMore) return;
    const oldest = messages[messages.length - 1]?.id;
    if (!oldest) return;
    setLoadingMore(true);
    const res = await listDmMessages(threadId, { before: oldest, limit: 40 });
    if (res.ok) {
      const list = res.data?.messages ?? [];
      merge(list);
      setHasMore(list.length >= 40);
    }
    setLoadingMore(false);
  }, [threadId, messages, loadingMore, hasMore, merge]);

  useEffect(() => {
    alive.current = true;
    setMessages([]);
    setLoading(true);
    setHasMore(true);
    newestRef.current = null;
    void load();
    return () => {
      alive.current = false;
    };
  }, [threadId, load]);

  // The poll. Deliberately re-reads the newest page rather than a "since" cursor
  // the server does not offer: 40 rows on an indexed (thread_id, id DESC) scan is
  // cheap, and merging by id makes a repeat harmless.
  useEffect(() => {
    if (!threadId) return;
    const t = setInterval(async () => {
      const res = await listDmMessages(threadId, { limit: 20 });
      if (res.ok) merge(res.data?.messages ?? []);
    }, pollMs);
    return () => clearInterval(t);
  }, [threadId, pollMs, merge]);

  // Mark read whenever the newest message changes, so the unread badge on the
  // section clears by looking at the thread rather than by a separate gesture.
  useEffect(() => {
    const newest = messages[0];
    if (!threadId || !newest) return;
    void markDmRead(threadId, newest.id);
  }, [threadId, messages]);

  return { messages, loading, hasMore, loadingMore, loadMore, merge, reload: load };
}
