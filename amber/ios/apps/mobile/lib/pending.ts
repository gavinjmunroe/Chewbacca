import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { callMedhaId, type MedhaIdResult } from './medhaId';

// Persistent "who did you mean" confirmations. These live server-side (pending
// resolution rows), so a note recorded and then abandoned still has its
// confirmations waiting on the Today feed — the resolution never depends on
// catching a live modal.

export type PendingCandidate = { id: string; name: string };

export type PendingResolution = {
  pendingId: number;
  kind: 'clarify' | 'soft';
  rawName: string;
  question: string;
  guess: PendingCandidate | null;
  candidates: PendingCandidate[];
};

export function listPendingResolutions(): Promise<MedhaIdResult<{ pending: PendingResolution[] }>> {
  return callMedhaId<{ pending: PendingResolution[] }>({
    path: '/v1/me/pending-resolutions',
    method: 'GET',
    requireAuth: true,
  });
}

// contactId is a real id, or the sentinel "__new__" (create a contact from the
// spoken name) or "__skip__" (leave unlinked). Backend handles all three.
export type NewContactFields = {
  fullName: string;
  phone?: string;
  email?: string;
  company?: string;
  title?: string;
  city?: string;
};

export function resolvePending(
  pendingId: number,
  contactId: string,
  /** Only for the "__new__" sentinel: the form the user just filled in. */
  newContact?: NewContactFields,
): Promise<MedhaIdResult<{ ok: boolean; resolved: boolean; createdContactId?: string }>> {
  // createdContactId comes back only for "__new__". The card that offered to add
  // the person should be able to open them afterwards, since a contact created
  // from a spoken name has nothing on it but that name.
  return callMedhaId<{ ok: boolean; resolved: boolean; createdContactId?: string }>({
    path: '/v1/chat/resolve',
    method: 'POST',
    body: { pendingId, contactId, ...(newContact ? { newContact } : {}) },
    requireAuth: true,
  });
}

/**
 * "No, not them" on a soft-confirm. The endpoint takes a decision rather than a
 * contact id and downgrades the row to a full clarify, so the next thing the
 * user sees is the candidate list instead of the same yes/no question again.
 * Deliberately NOT a resolve: refusing a guess is not choosing a person.
 */
export function declinePending(
  pendingId: number,
): Promise<MedhaIdResult<{ ok: boolean; resolved: boolean }>> {
  return callMedhaId<{ ok: boolean; resolved: boolean }>({
    path: '/v1/chat/resolve',
    method: 'POST',
    body: { pendingId, decision: 'no' },
    requireAuth: true,
  });
}

// Search the caller's own contacts by name (typeahead for the "choose another
// contact" field on a reconciliation card).
export function searchMyContacts(
  q: string,
): Promise<MedhaIdResult<{ contacts: PendingCandidate[] }>> {
  return callMedhaId<{ contacts: PendingCandidate[] }>({
    path: `/v1/me/contacts/search?q=${encodeURIComponent(q)}`,
    method: 'GET',
    requireAuth: true,
  });
}

/**
 * ONE LIST OF OPEN QUESTIONS, SHARED BY EVERY SURFACE THAT ASKS THEM.
 *
 * This was per-component state: `useState` inside the hook, plus a `suppressed`
 * ref, both created fresh for each caller. Two surfaces call it -- the Today
 * feed and the Ask transcript -- so there were two independent copies of the
 * same list, two independent fetches, and two independent suppression maps.
 *
 * That is the whole "it asked me the same thing twice, and answering it in one
 * place left it standing in the other". Resolving on Today removed the row from
 * Today's copy; the Ask copy had never heard about it and went on asking. And
 * because each copy refetched on its own focus and its own version bump, the
 * two could disagree about what was still open at any moment.
 *
 * So the list lives in the react-query cache under one key, and the suppression
 * map is module scope. Both are process-wide: one fetch, one answer, and a
 * resolution anywhere is a resolution everywhere, in the same frame.
 */
const PENDING_KEY = ['pendingResolutions'] as const;

// Names answered recently, each held until a deadline. A reload can briefly
// re-fetch a row before the server finishes sweeping it, which caused the
// "confirm, card flashes back, then vanishes" glitch and the mis-taps with it.
//
// SUPPRESSION EXPIRES ON A CLOCK, NOT ON A VERSION BUMP. It used to be cleared
// wholesale every time a new note was recorded -- so recording anything re-armed
// every name the user had already answered. Recording a note is not evidence
// that an earlier answer was wrong; only time is, and a few seconds of it is
// enough for the sweep to land.
//
// Module scope, not a ref, for the same reason the list is: a hold taken on the
// Today feed has to be honored by the Ask transcript.
/**
 * ANSWERED HERE MEANS ANSWERED EVERYWHERE, INCLUDING IN THE TRANSCRIPT.
 *
 * The shared list above covers the two surfaces that render the pending LIST
 * (the Today feed and Ask's "STILL TO CONFIRM"). It does not cover the third
 * place the same question appears: inline in a turn, as the clarify /
 * soft-confirm rows the stream put on it. Those live in ChatContext's turns,
 * which no amount of query-cache sharing can reach.
 *
 * So every answered pendingId is recorded here, once, by whoever answered it --
 * a card on Today, the strip in Ask, or a chip inside the turn itself -- and the
 * transcript filters its own rows against it. Answering in any one place
 * silences all three.
 *
 * A plain Set with subscribers rather than context: it is read during render by
 * components in two different provider trees (Home's, and the overlay's nested
 * one), and it must outlive the unmount of whichever surface took the answer.
 */
const answered = new Set<number>();
const answeredListeners = new Set<() => void>();
let answeredSnapshot: ReadonlySet<number> = new Set();

function publishAnswered() {
  // A NEW SET EVERY TIME, because useSyncExternalStore compares snapshots by
  // identity -- handing back the same mutated Set would report "no change" and
  // nothing would re-render.
  answeredSnapshot = new Set(answered);
  for (const fn of answeredListeners) fn();
}

/** Every pendingId answered this session, for render-time filtering. */
export function useAnsweredPendings(): ReadonlySet<number> {
  return useSyncExternalStore(
    (fn) => {
      answeredListeners.add(fn);
      return () => answeredListeners.delete(fn);
    },
    () => answeredSnapshot,
    () => answeredSnapshot,
  );
}

/**
 * Record an answer and drop the question from every surface at once.
 *
 * Call this from wherever the user actually answered -- the caller still does
 * its own POST; this is only the bookkeeping that keeps the other two surfaces
 * from asking again.
 */
export function markPendingAnswered(qc: QueryClient, pendingId: number) {
  const current = qc.getQueryData<PendingResolution[]>(PENDING_KEY) ?? [];
  const it = current.find((x) => x.pendingId === pendingId);
  if (it?.rawName) suppressed.set(_key(it.rawName), Date.now() + SUPPRESS_MS);
  qc.setQueryData<PendingResolution[]>(
    PENDING_KEY,
    current.filter((x) => x.pendingId !== pendingId),
  );
  if (!answered.has(pendingId)) {
    answered.add(pendingId);
    publishAnswered();
  }
}

const suppressed = new Map<string, number>();
const SUPPRESS_MS = 90_000;
const _key = (n: string) => (n || '').toLowerCase().trim();

function unsuppressed(rows: PendingResolution[]): PendingResolution[] {
  const now = Date.now();
  for (const [k, exp] of suppressed) if (exp <= now) suppressed.delete(k);
  return rows.filter((p) => {
    const exp = suppressed.get(_key(p.rawName));
    return !(exp && exp > now);
  });
}

/** Fetches on focus and whenever `version` bumps (e.g. after a note is captured). */
export function usePendingResolutions(version: number) {
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: PENDING_KEY,
    queryFn: async () => {
      const res = await listPendingResolutions();
      if (!res.ok) throw new Error('pending fetch failed');
      return res.data?.pending ?? [];
    },
    // A question the user has already answered must not reappear while the
    // server sweep is still in flight, so the hold is applied on the way out of
    // the cache rather than on the way in -- that way a hold taken after the
    // fetch resolved still counts.
    select: unsuppressed,
    staleTime: 2000,
  });
  const items = data ?? [];

  const load = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: PENDING_KEY });
  }, [qc]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // On a version bump (a note was just recorded), the pending rows are written
  // a few seconds later when Sonnet finishes extracting. Reload now and again
  // after a beat so the confirmation card lands on its own, no manual refresh.
  useEffect(() => {
    void load();
    const t1 = setTimeout(() => void load(), 3500);
    const t2 = setTimeout(() => void load(), 7000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [version, load]);

  // Optimistically drop a resolved item AND remember its name so a reload can't
  // flash it back before the server has finished clearing it. Writing to the
  // shared cache is what makes the card disappear from the OTHER surface too.
  const remove = useCallback((pendingId: number) => markPendingAnswered(qc, pendingId), [qc]);

  // Put a card back after a failed resolve. The optimistic remove used to be
  // permanent for the session even when the server rejected the call, so a
  // resolution that silently 500ed looked exactly like one that worked -- until
  // the next launch brought the question back.
  const restore = useCallback(
    (rawName: string) => {
      suppressed.delete(_key(rawName));
      // Un-answer it as well. Without this a resolve that the server rejected
      // would clear the hold on the list while the transcript went on hiding
      // the same question -- restored in one surface, gone from another, which
      // is the exact disagreement this store exists to prevent.
      const key = _key(rawName);
      const current = qc.getQueryData<PendingResolution[]>(PENDING_KEY) ?? [];
      let changed = false;
      for (const id of [...answered]) {
        const row = current.find((x) => x.pendingId === id);
        if (row && _key(row.rawName) === key) {
          answered.delete(id);
          changed = true;
        }
      }
      if (changed) publishAnswered();
      void load();
    },
    [load, qc],
  );

  return { items, reload: load, remove, restore };
}
