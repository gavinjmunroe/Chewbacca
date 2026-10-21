/**
 * WHICH COPY OF THE SESSION IS THE LIVE ONE. The decision half of
 * lib/secureStorage.ts, split out so a test can run it (secureStorage needs the
 * native keychain).
 *
 * The session lives in two keychain items: the app's private one and the group
 * shared with Kyber, the keyboard. Both processes rotate the refresh token, and
 * it is single-use, so exactly one copy is current at any moment and presenting
 * the other is a replay that revokes every session.
 *
 * "Shared first" alone is wrong. A tester who installs the default build over
 * the Kyber build keeps rotating only the private copy (that build cannot touch
 * the shared group); reinstalling Kyber then finds a shared token rotated away
 * weeks ago, presents it, and is signed out. Or worse, signed in as whoever used
 * the phone before an account switch. So every save stamps the time, in both
 * places, and the newer stamp wins. A missing stamp counts as 0, which keeps
 * sessions from before the stamp existed working: they have no shared copy
 * yet, so the private one wins and is copied across.
 */
export type SessionCopy = {
  token: string | null;
  phone: string | null;
  refreshToken: string | null;
  /** Epoch ms of the last save into this copy, or null when never stamped. */
  savedAt: number | null;
};

export type SessionChoice = {
  source: 'shared' | 'legacy' | 'none';
  copy: SessionCopy;
  /** The private copy won while a shared group exists: write it across. */
  copyToShared: boolean;
};

const EMPTY: SessionCopy = { token: null, phone: null, refreshToken: null, savedAt: null };

export function parseSavedAt(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function pickSession(shared: SessionCopy | null, legacy: SessionCopy): SessionChoice {
  const sharedLive = !!shared?.token;
  const legacyLive = !!legacy.token;
  if (!sharedLive && !legacyLive) return { source: 'none', copy: EMPTY, copyToShared: false };
  if (sharedLive && (!legacyLive || (shared!.savedAt ?? 0) >= (legacy.savedAt ?? 0))) {
    return { source: 'shared', copy: shared!, copyToShared: false };
  }
  return { source: 'legacy', copy: legacy, copyToShared: shared !== null };
}
