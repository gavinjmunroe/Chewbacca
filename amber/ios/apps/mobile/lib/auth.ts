import { requestOtpCode, type RequestCodeResult } from './otpRequest';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from './config';
import { callMedhaId, clearOfflineQueue, medhaIdErrorCopy } from './medhaId';
import { refreshSession } from './sessionRefresh';
import { clearCirclesCache } from './circles';
import { bustContactsCache } from './network';
import { resetPushRegistrationLatch } from './pushLatch';
import { clearPersonCache } from './peoplerank';
import { clearNotificationSettingsCache } from './notificationSettings';
import { clearContactsSummary } from './contactsSummary';
import { queryClient } from './queryClient';
import { normalizePhone } from './phone';
import {
  clearSession,
  getBiometricLock,
  hasBiometricPreference,
  loadSession,
  saveSession,
  setBiometricLock,
} from './secureStorage';

// The warm-OTP flow:
//   1. The iOS app shows a "Message Medha" button that opens iMessage
//      pre-filled with "What's my login code?".
//   2. The user hits Send. medha-platform receives the inbound, matches
//      the intent, and replies in-thread with a 6-digit code (no URL).
//   3. The user copies the code back into the app and we verify with
//      medha-id's /v1/auth/verify-code-only (no phone needed — the OTP
//      store reverse-indexes from code to phone).
//
// We never collect the user's phone in the app. The agent already knows
// the sender's phone from the iMessage inbound.

const VERIFY_ERRORS = [
  'code_required',
  'invalid_format',
  'expired',
  'not_found',
  'mismatch',
  'too_many_attempts',
] as const;

type VerifyError = (typeof VERIFY_ERRORS)[number];

export type VerifyCodeResult =
  | { ok: true; token: string; personId: string; phone: string }
  | {
      ok: false;
      error: VerifyError | 'network_error';
      message?: string;
      attemptsRemaining?: number;
    };

function narrow<T extends string>(allowed: readonly T[], raw: string): T | 'network_error' {
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : 'network_error';
}

export async function verifyCode(code: string): Promise<VerifyCodeResult> {
  const trimmed = code.replace(/\D/g, '').slice(0, 8);
  if (!trimmed) return { ok: false, error: 'code_required' };

  const res = await callMedhaId<{
    token: string;
    refreshToken?: string;
    person_id: string;
    phone: string;
  }>({
    path: '/v1/auth/verify-code-only',
    method: 'POST',
    body: { code: trimmed },
    unauthenticated: true,
  });

  if (res.ok) {
    if (!res.data?.token) {
      return { ok: false, error: 'network_error', message: 'invalid_response' };
    }
    await saveSession(res.data.token, res.data.phone, res.data.refreshToken);
    // Typing a fresh code IS a deliberate auth, so this launch is unlocked:
    // never double-prompt Face ID right after a successful sign-in.
    markUnlockedThisLaunch();
    // First successful sign-in on a biometric-capable device opts the user
    // into Face ID lock by default. Tab 7's Profile can later turn it off.
    await maybeEnableBiometricByDefault().catch(() => {});
    return {
      ok: true,
      token: res.data.token,
      personId: res.data.person_id,
      phone: res.data.phone,
    };
  }

  return {
    ok: false,
    error: narrow(VERIFY_ERRORS, res.error),
    message: res.message,
    attemptsRemaining: res.attemptsRemaining,
  };
}

// --- Phone + OTP sign-in (enter phone → get code → verify) ----------------
//
// The newer flow collects the user's phone in the app and asks the backend to
// mint a code for that number, then verifies { phone, code }. This is distinct
// from the legacy verifyCode() warm-OTP path (code-only, phone reverse-indexed
// server-side), which is kept in place above.

// Delivery outcomes for the Photon-delivered OTP. Nothing sensitive is ever
// returned: on success the code goes to the user's iMessage, so the app only
// learns whether the send succeeded, needs a one-time opt-in, or failed.
export type { RequestCodeResult } from './otpRequest';
export async function requestCode(phone: string): Promise<RequestCodeResult> {
  return requestOtpCode(config.medhaIdBaseUrl, normalizePhone(phone));
}

export type VerifyPhoneResult =
  | { ok: true; personId: string }
  | { ok: false; status: number; message: string };

// Verify { phone, code }. On success the session is persisted exactly like the
// legacy verifyCode() path (saveSession + unlock latch + default biometric
// opt-in), using the normalized phone so storage stays E.164-consistent.
export async function verifyPhoneCode(phone: string, code: string): Promise<VerifyPhoneResult> {
  const normalizedPhone = normalizePhone(phone);

  const res = await callMedhaId<{
    token: string;
    refreshToken?: string;
    person_id: string;
  }>({
    path: '/v1/auth/verify',
    method: 'POST',
    body: { phone: normalizedPhone, code },
    unauthenticated: true,
  });

  if (res.ok) {
    if (!res.data?.token) {
      return { ok: false, status: res.status, message: 'Something went wrong. Try again.' };
    }
    await saveSession(res.data.token, normalizedPhone, res.data.refreshToken);
    // Typing a fresh code IS a deliberate auth, so this launch is unlocked:
    // never double-prompt Face ID right after a successful sign-in.
    markUnlockedThisLaunch();
    // First successful sign-in on a biometric-capable device opts the user
    // into Face ID lock by default. Profile can later turn it off.
    await maybeEnableBiometricByDefault().catch(() => {});
    return { ok: true, personId: res.data.person_id };
  }

  return { ok: false, status: res.status, message: medhaIdErrorCopy(res, 'Amber') };
}

// Clear ALL device-local state tied to the signed-in account. This is the one
// choke point sign-out and account-deletion both go through, so no per-user
// state (session token, onboarding flag, biometric preference, the offline
// write queue, cached contacts summary) survives into the next account signing
// in on the same device.
//
// It deliberately lives here rather than in clearSession(): clearSession is in
// the low-level secureStorage module, which the offline queue (medhaId) already
// imports — clearing the queue from there would be an import cycle. Callers use
// this instead of clearSession directly.
// Per-account data that lives under GLOBAL (non-session) AsyncStorage keys and
// would otherwise leak into the next account signing in on the same device:
//   - `amber.chat.history.<agent>`  (lib/agent.ts)            — chat transcripts
//   - `person:*`                    (app/(gated)/person/[id]) — per-contact
//       snapshots, score history, private notes, and recently-viewed list
//   - `togari_cache_v1`             (lib/togari.ts)           — cached deals
//   - `amber.turn.cache.*`          (lib/turnCache.ts)        — the local copy
//       of finished answers, which is one person's conversations and must not be
//       readable by the next account on the device
// Enumerated + prefix-matched (not deleted by hard-coded key) so per-id suffixes
// like `person:notes:<id>` are all swept without knowing the ids ahead of time.
// Deliberately scoped to per-account caches only: truly global/app-level prefs
// (e.g. `amber_contacts_summary_v1`, biometric preference, session keys) are
// left to their own owners (clearContactsSummary / clearSession) or intentionally
// preserved.
const PER_ACCOUNT_KEY_PREFIXES = ['amber.chat.history.', 'person:', 'amber.turn.cache.'];
// `amber_onboarding_progress_v1` holds the half-finished onboarding form --
// including the previous user's REAL NAME and CITY -- and was hydrated
// unconditionally on mount, so it prefilled itself into the next account's
// onboarding. `amber_onboarding_events_v1` is the matching analytics buffer.
// Both are per-account and must not survive a sign-out.
const PER_ACCOUNT_KEY_EXACT = [
  'togari_cache_v1',
  'amber_onboarding_progress_v1',
  'amber_onboarding_events_v1',
];

async function clearPerAccountCaches(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const doomed = keys.filter(
      (k) =>
        PER_ACCOUNT_KEY_EXACT.includes(k) ||
        PER_ACCOUNT_KEY_PREFIXES.some((p) => k.startsWith(p)),
    );
    if (doomed.length > 0) await AsyncStorage.multiRemove(doomed);
  } catch {
    /* best-effort: a failed cache sweep must never block sign-out */
  }
}

export async function clearLocalUserData(): Promise<void> {
  resetUnlockState();
  clearContactsSummary();
  // Module-scope caches. These live OUTSIDE React Query, so queryClient.clear()
  // below does not reach them, and they survive for the lifetime of the JS
  // runtime -- which means across a sign-out/sign-in with no app restart. Each
  // one was previously observable by the next account:
  //   - circlesCache   -> previous user's circle names, counts, member avatars
  //   - contactsCache  -> previous user's entire address book (5-min TTL)
  //   - personCache    -> previous user's ranked people, unbounded
  //   - notification settings -> previous user's channel preferences
  // Synchronous and non-throwing by construction, so they run before the
  // awaited work below and cannot block sign-out.
  clearCirclesCache();
  bustContactsCache();
  clearPersonCache();
  clearNotificationSettingsCache();
  // Not a cache: a latch. Push-token registration runs once per session, and
  // without this reset the NEXT account to sign in on this process never registers
  // a token and silently receives no notifications at all.
  resetPushRegistrationLatch();
  // Drop the React Query cache so the next account can never paint the previous
  // user's profile / contacts / connections from cache while their own fetches
  // are still in flight. clearLocalUserData is the single choke point BOTH
  // sign-out and account-deletion go through, so clearing here covers every
  // logout path — including the AuthGate "Sign in another way" and AgentChat
  // session-expired sites that call signOut() without their own qc.clear().
  queryClient.clear();
  await Promise.all([clearSession(), clearOfflineQueue(), clearPerAccountCaches()]);
}

export async function signOut(): Promise<void> {
  // Best-effort server-side JWT revoke before clearing local storage.
  // medha-frontend's /api/auth/sign-out does the same: POST to
  // /v1/auth/invalidate with the bearer, treat 404/501 as soft-fail
  // because the endpoint is parallel work in medha-id (today it 404s,
  // tomorrow it should accept the token and revoke the jti). Either
  // way the local session is gone.
  //
  // callMedhaId never throws (it returns a typed result), so a bare
  // try/catch swallows nothing useful. Inspect the result instead and warn on
  // a non-ok status so a regressed or still-landing /v1/auth/invalidate is
  // observable rather than silently failing forever.
  try {
    const res = await callMedhaId({
      path: '/v1/auth/invalidate',
      method: 'POST',
      timeoutMs: 3_000,
    });
    if (!res.ok) {
      console.warn('[signOut] server revoke did not succeed', res.status, res.error);
    }
  } catch (e) {
    // Defensive: should not happen, but never block local sign-out on it.
    console.warn('[signOut] server revoke threw', e);
  }
  // Local session (and every other per-user cache) must always be cleared
  // regardless of the revoke outcome.
  await clearLocalUserData();
}

export async function hasSession(): Promise<boolean> {
  const s = await loadSession();
  return !!s;
}

export async function getPhone(): Promise<string | null> {
  const s = await loadSession();
  return s?.phone ?? null;
}

// --- Session expiry -------------------------------------------------------

// Decode a JWT's exp claim (seconds since epoch) without a crypto library or
// reliance on global atob/Buffer (neither is guaranteed across RN runtimes).
// Returns null when the token is malformed or carries no numeric exp, in which
// case callers fail OPEN: an unparseable token is treated as still valid and
// the server stays the source of truth via its own 401. We never log the user
// out on a decode quirk.
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (const char of padded) {
    if (char === '=') break;
    const value = B64_ALPHABET.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}

export function decodeJwtExp(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(base64UrlDecode(parts[1])) as { exp?: unknown };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp : null;
  } catch {
    return null;
  }
}

// A 60s skew keeps an about-to-expire token from being used for a request that
// would 401 mid-flight. Treats only confidently-expired tokens as invalid.
const EXPIRY_SKEW_SECONDS = 60;

export function isTokenExpired(token: string): boolean {
  const exp = decodeJwtExp(token);
  if (exp === null) return false; // fail open
  return exp <= Math.floor(Date.now() / 1000) + EXPIRY_SKEW_SECONDS;
}

// Returns the session only when its token is present and not expired. An
// expired session is cleared so AuthGate routes cleanly to sign-in instead of
// letting every downstream API call 401. Best-effort silent refresh is
// attempted first; if medha-id ever ships /v1/auth/refresh this keeps the user
// signed in across expiry without a visible bounce.
export async function getValidSession(): Promise<{ token: string; phone: string } | null> {
  const session = await loadSession();
  if (!session) return null;
  if (!isTokenExpired(session.token)) return session;

  const refreshed = await tryRefreshSession();
  if (refreshed) return refreshed;

  await clearSession();
  return null;
}

export async function isSessionValid(): Promise<boolean> {
  return (await getValidSession()) !== null;
}

// Silent refresh, delegated to lib/sessionRefresh so the transport and this
// module share ONE single-flighted implementation.
//
// That sharing is the whole point: refresh tokens are single-use and rotate on
// every exchange, and the server revokes the entire session family if an
// already-rotated token reappears. Two independent refresh implementations would
// race on a cold start and sign the user out of every device. Do not reintroduce
// a second one here.
//
// Returns null when there is nothing to refresh with (a legacy long-lived
// session, or none at all) or when the server rejected the refresh token.
async function tryRefreshSession(): Promise<{ token: string; phone: string } | null> {
  return refreshSession();
}

// --- Biometric (Face ID / Touch ID) lock ----------------------------------

// In-memory, per-launch unlock latch. Resets on every cold start, which is
// exactly when we want to re-challenge a returning session. Signing in or
// passing Face ID flips it true for the rest of the process lifetime.
let unlockedThisLaunch = false;

export function markUnlockedThisLaunch(): void {
  unlockedThisLaunch = true;
}

export function resetUnlockState(): void {
  unlockedThisLaunch = false;
}

export type BiometricCapability = {
  available: boolean;
  enrolled: boolean;
  label: 'Face ID' | 'Touch ID' | 'biometrics';
};

export async function getBiometricCapability(): Promise<BiometricCapability> {
  try {
    const [hasHardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    const isFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const isTouch = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
    return {
      available: hasHardware,
      enrolled,
      label: isFace ? 'Face ID' : isTouch ? 'Touch ID' : 'biometrics',
    };
  } catch {
    return { available: false, enrolled: false, label: 'biometrics' };
  }
}

// Opt the user into biometric lock on their first session if, and only if, the
// device can actually do it and they have no explicit preference yet. Avoids
// silently enabling a lock the device can never satisfy.
async function maybeEnableBiometricByDefault(): Promise<void> {
  if (await hasBiometricPreference()) return;
  const cap = await getBiometricCapability();
  await setBiometricLock(cap.available && cap.enrolled);
}

// Whether this cold start should present the biometric lock before the gated
// app. True only when a valid session exists, the lock is enabled, the device
// is still capable/enrolled, and we have not already unlocked this launch.
export async function shouldBiometricLock(): Promise<boolean> {
  if (unlockedThisLaunch) return false;
  const session = await loadSession();
  if (!session) return false;
  if (!(await getBiometricLock())) return false;
  const cap = await getBiometricCapability();
  return cap.available && cap.enrolled;
}

export type BiometricResult =
  | { ok: true }
  | { ok: false; reason: 'cancelled' | 'unavailable' | 'failed' };

export async function authenticateBiometric(promptLabel: string): Promise<BiometricResult> {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: promptLabel,
      cancelLabel: 'Use a code instead',
      disableDeviceFallback: false,
    });
    if (res.success) {
      markUnlockedThisLaunch();
      return { ok: true };
    }
    const code = 'error' in res ? res.error : 'unknown';
    if (code === 'user_cancel' || code === 'system_cancel' || code === 'app_cancel') {
      return { ok: false, reason: 'cancelled' };
    }
    if (code === 'not_available' || code === 'not_enrolled' || code === 'passcode_not_set') {
      return { ok: false, reason: 'unavailable' };
    }
    return { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
