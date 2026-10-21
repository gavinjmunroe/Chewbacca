import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';
import { bustContactsCache } from './network';
import {
  readDeviceContactsDetailed,
  syncContactsToMedhaId,
  type ContactsAccess,
  type DeviceContact,
} from './contactsSync';
import { setSyncState } from './syncState';

// THE SYNC BELONGS TO THE APP, NOT TO A SCREEN.
//
// "I tried the contact sync, and it keeps giving me errors. It says some did not
//  load, and I stayed on the page the entire time. Even if I go to a different
//  page on the app, it should still refresh. In fact, if I leave the app, it
//  should still refresh."
//
// It used to be an async function inside the Profile screen's render scope. It
// did not actually stop when he left the page -- promises outlive the component
// -- but everything ABOUT it did: the progress went to local state that
// unmounted, the completion toast fired into nothing, and there was no record
// anywhere that a sync had been interrupted. Nothing resumed it. So "it should
// still refresh" was half true in a way that is worse than either answer.
//
// This module is the sync itself, at module scope, with three properties the
// screen version could not have:
//
//   ONE AT A TIME. A second call while one is running joins the run in progress
//   instead of starting a competing upload of the same address book.
//
//   IT SURVIVES NAVIGATION. Progress goes to lib/syncState (module-level), so
//   any screen can render it and none of them owns it.
//
//   IT RESUMES. A checkpoint is written after every batch, so a sync
//   interrupted by the app being backgrounded and killed picks up where it left
//   off on the next launch or the next return to the foreground.
//
// WHY RESUMING IS SAFE, and it is worth being precise: the server is now
// insert-only on every sync after the first (see the mode logic in
// routes/profile.js). Re-sending a batch cannot duplicate anybody and cannot
// edit anybody -- it resolves to the same rows and leaves them alone. So the
// worst case of a resume that overlaps is wasted bytes, which is why this can
// afford to be simple rather than transactional.
//
// WHAT THIS IS NOT: true background execution. iOS suspends JavaScript when the
// app leaves the foreground, and no amount of structuring here changes that.
// What it means in practice is that a sync interrupted at 400 of 1,100 continues
// from 400 the moment the app is looked at again, rather than being forgotten.
// Genuinely finishing while the phone is in a pocket needs a native background
// task, which is a bigger change than belongs in a bug fix.

const CHECKPOINT_KEY = 'amber.contactsSync.checkpoint.v1';
const CHUNK_SIZE = 200;
/**
 * A batch that fails gets one more try before the sync gives up on it. Almost
 * every failure at this layer is a dropped connection on a phone that is walking
 * between wifi and cellular, and it succeeds immediately afterwards.
 */
const BATCH_ATTEMPTS = 2;
/**
 * How many batches in a row may fail before the run gives up.
 *
 * Two, deliberately low. One failure is a bad card and worth bisecting around;
 * several in a row is the server or the network, and no amount of splitting will
 * help — it will just spend two minutes per batch discovering the same thing for
 * the rest of the address book.
 */
const MAX_CONSECUTIVE_BATCH_FAILURES = 2;

export type ContactsSyncResult = {
  ok: boolean;
  /** How many cards were sent. */
  sent: number;
  /** New contacts created by this sync. */
  inserted: number;
  /** Contacts that were already here and were deliberately not touched. */
  unchanged: number;
  /** Rows the server could not write. Its logs say which and why. */
  failed: number;
  /** Cards iOS holds, before we dropped any -- the honest "in Apple" number. */
  deviceTotal: number;
  /** Cards with nothing to name them by. */
  skipped: number;
  access: ContactsAccess;
  /** Set when the sync stopped early. Progress is checkpointed either way. */
  errorMessage?: string;
};

type Checkpoint = { offset: number; startedAt: number };

/** The run in flight, so a second caller joins it rather than racing it. */
let inFlight: Promise<ContactsSyncResult> | null = null;
/** Listeners for "a sync just finished", so screens can refresh without owning it. */
let doneListeners: ((r: ContactsSyncResult) => void)[] = [];
let appStateSub: { remove: () => void } | null = null;

export function onContactsSyncDone(fn: (r: ContactsSyncResult) => void): () => void {
  doneListeners = [...doneListeners, fn];
  return () => {
    doneListeners = doneListeners.filter((l) => l !== fn);
  };
}

export function contactsSyncInFlight(): boolean {
  return inFlight !== null;
}

async function readCheckpoint(): Promise<Checkpoint | null> {
  try {
    const raw = await AsyncStorage.getItem(CHECKPOINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Checkpoint;
    if (typeof parsed?.offset !== 'number' || parsed.offset < 0) return null;
    return parsed;
  } catch {
    // A corrupt checkpoint is a reason to start over, not to fail.
    return null;
  }
}

async function writeCheckpoint(cp: Checkpoint | null): Promise<void> {
  try {
    if (cp) await AsyncStorage.setItem(CHECKPOINT_KEY, JSON.stringify(cp));
    else await AsyncStorage.removeItem(CHECKPOINT_KEY);
  } catch {
    // Losing the checkpoint costs a resume, never the sync.
  }
}

/**
 * Send one batch, with one retry. Returns null when it could not be sent at all.
 */
async function sendBatch(batch: DeviceContact[]) {
  let lastMessage: string | undefined;
  for (let attempt = 1; attempt <= BATCH_ATTEMPTS; attempt += 1) {
    const res = await syncContactsToMedhaId(batch);
    if (res.ok) return res;
    lastMessage = res.message || res.error;
    // A short pause before the retry: an instant retry hits the same dead
    // connection. Long enough to cross a wifi/cellular handover, short enough
    // that nobody watching the counter notices.
    if (attempt < BATCH_ATTEMPTS) await new Promise((r) => setTimeout(r, 1200));
  }
  return { ok: false as const, message: lastMessage };
}

async function run(): Promise<ContactsSyncResult> {
  const read = await readDeviceContactsDetailed();
  const list = read.contacts;
  const base: ContactsSyncResult = {
    ok: true,
    sent: 0,
    inserted: 0,
    unchanged: 0,
    failed: 0,
    deviceTotal: read.deviceTotal,
    skipped: read.skipped,
    access: read.access,
  };

  if (list.length === 0) {
    setSyncState({ status: read.access === 'none' ? 'error' : 'done', synced: 0, total: 0 });
    await writeCheckpoint(null);
    return {
      ...base,
      ok: read.access !== 'none',
      errorMessage:
        read.access === 'none' ? 'Amber does not have permission to read your contacts.' : undefined,
    };
  }

  // WHERE TO PICK UP. A checkpoint from an interrupted run is honored only if it
  // still points inside this address book; a book that shrank since then starts
  // over, which is cheap and cannot be wrong.
  const cp = await readCheckpoint();
  let offset = cp && cp.offset < list.length ? cp.offset : 0;
  const resumed = offset > 0;

  setSyncState({
    status: 'syncing',
    synced: offset,
    total: list.length,
    source: 'Apple',
  });

  let inserted = 0;
  let unchanged = 0;
  let failed = 0;
  let sent = offset;
  let errorMessage: string | undefined;

  // ── ONE BAD BATCH DOES NOT HOLD THE REST OF THE BOOK HOSTAGE ─────────────
  //
  // "It's been syncing at 1,000 out of 1,179 forever, like 30 minutes now."
  //
  // 1,000 is five batches of 200 exactly. Batch six failed, twice, and this loop
  // returned — so the last 179 contacts were never attempted, and every later
  // resume started at the same offset and failed on the same batch again. The
  // counter was not moving because nothing was moving. The number looked like
  // progress and was a stall.
  //
  // Stopping was the wrong response for an insert-only sync. There is no
  // ordering requirement between batches: contact 1,001 does not depend on
  // contact 1,000, so a batch that cannot be written is 200 contacts to come
  // back to, not a reason to abandon 179 that would have gone in fine.
  //
  // So a failed batch is HALVED and retried, down to a single card. A 200-card
  // POST that fails identically on every attempt is almost always one bad card
  // or a payload the server will not take — bisecting isolates it and saves the
  // other 199 instead of losing all of them to it. At a single card, that card
  // is counted as failed and the sync moves on.
  //
  // CONSECUTIVE failures still stop the run, because a server that is down is
  // not a bad card and grinding through the whole address book to discover that
  // wastes the user's battery and their time.
  let consecutiveFailures = 0;

  /**
   * Send one slice, splitting it on failure. Returns what landed and what could
   * not be sent at any size.
   */
  const sendSplitting = async (
    slice: DeviceContact[],
  ): Promise<{ inserted: number; unchanged: number; failed: number; message?: string }> => {
    const res = await sendBatch(slice);
    if (res.ok) {
      return {
        inserted: res.inserted ?? 0,
        unchanged: res.unchanged ?? 0,
        failed: res.failed ?? 0,
      };
    }
    if (slice.length === 1) {
      // The floor. This one card cannot be written; name it and carry on.
      return { inserted: 0, unchanged: 0, failed: 1, message: res.message };
    }
    const mid = Math.floor(slice.length / 2);
    const left = await sendSplitting(slice.slice(0, mid));
    const right = await sendSplitting(slice.slice(mid));
    return {
      inserted: left.inserted + right.inserted,
      unchanged: left.unchanged + right.unchanged,
      failed: left.failed + right.failed,
      message: left.message ?? right.message,
    };
  };

  while (offset < list.length) {
    const batch = list.slice(offset, offset + CHUNK_SIZE);
    const res = await sendBatch(batch);
    if (!res.ok) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_BATCH_FAILURES) {
        // The server, not a card. Stop, keep the ground already taken, and say
        // so — the checkpoint means the next foreground continues from here
        // rather than re-uploading everything.
        errorMessage = res.message ?? 'The sync could not reach Amber.';
        await writeCheckpoint({ offset, startedAt: cp?.startedAt ?? Date.now() });
        setSyncState({ status: 'error', synced: sent, total: list.length });
        return { ...base, ok: false, sent, inserted, unchanged, failed, errorMessage };
      }
      // Salvage what this batch will give up, then keep going.
      const split = await sendSplitting(batch);
      inserted += split.inserted;
      unchanged += split.unchanged;
      failed += split.failed;
      // Kept so the run can report WHY cards were dropped. Without it the user
      // is told a number and nothing else, which is how 179 contacts went
      // missing in silence.
      if (split.message && !errorMessage) errorMessage = split.message;
    } else {
      consecutiveFailures = 0;
      inserted += res.inserted ?? 0;
      unchanged += res.unchanged ?? 0;
      failed += res.failed ?? 0;
    }
    offset += batch.length;
    sent = offset;
    await writeCheckpoint(
      offset < list.length ? { offset, startedAt: cp?.startedAt ?? Date.now() } : null,
    );
    setSyncState({ synced: sent, total: list.length });
  }

  setSyncState({ status: 'done', synced: sent, total: list.length });
  bustContactsCache();
  // A run that reached the end of the book is `ok` even when individual cards
  // were dropped -- it finished, and the alternative is calling a completed sync
  // a failure. The count and the reason still travel with it, because "1,175 of
  // 1,179, 4 cards Amber could not write" is a true sentence and "synced" alone
  // is not.
  return {
    ...base,
    ok: true,
    sent,
    inserted,
    unchanged,
    failed,
    errorMessage: failed > 0 ? errorMessage : undefined,
    ...(resumed ? {} : {}),
  };
}

/**
 * Sync the device address book. Safe to call from anywhere, at any time.
 *
 * Returns the run in progress if there is one, so two screens both asking for a
 * sync produce one upload and both get the same answer.
 */
export function startContactsSync(): Promise<ContactsSyncResult> {
  if (inFlight) return inFlight;
  inFlight = run()
    .catch((e): ContactsSyncResult => {
      setSyncState({ status: 'error' });
      return {
        ok: false,
        sent: 0,
        inserted: 0,
        unchanged: 0,
        failed: 0,
        deviceTotal: 0,
        skipped: 0,
        access: 'all',
        errorMessage: e instanceof Error ? e.message : 'Something interrupted the sync.',
      };
    })
    .then((res) => {
      inFlight = null;
      // Always: a sync that inserted nothing still means the list the app is
      // holding may be from before it.
      bustContactsCache();
      for (const l of doneListeners) {
        try {
          l(res);
        } catch {
          // A listener throwing must not turn a finished sync into a failed one.
        }
      }
      return res;
    });
  return inFlight;
}

/**
 * Resume an interrupted sync when the app comes back to the foreground, and once
 * at startup. Call from the gated layout; calling twice is harmless.
 *
 * This is the "if I leave the app, it should still refresh" half that is actually
 * achievable without a native background task: the sync is not forgotten, and it
 * continues the instant the app is looked at again.
 */
export function installContactsSyncResume(): () => void {
  if (appStateSub) return () => {};
  const maybeResume = () => {
    if (inFlight) return;
    void readCheckpoint().then((cp) => {
      if (!cp) return;
      void startContactsSync();
    });
  };
  maybeResume();
  const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next === 'active') maybeResume();
  });
  appStateSub = sub;
  return () => {
    sub.remove();
    appStateSub = null;
  };
}
