import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { parseSavedAt, pickSession, type SessionCopy } from './sessionStore';

const SESSION_KEY = 'medha_session_token_v1';
const PHONE_KEY = 'medha_session_phone_v1';
// Opaque refresh token (60-day sliding, single-use, rotated on every exchange).
// Lives in the keychain next to the access token and NEVER in AsyncStorage or
// JS module state -- it is the long-lived credential, so it gets the strongest
// storage the platform offers.
const REFRESH_KEY = 'medha_refresh_token_v1';
const ONBOARDED_KEY = 'medha_onboarded_v1';
const BIOMETRIC_KEY = 'medha_biometric_lock_v1';

// THE SESSION IS ALSO KEPT WHERE KYBER CAN READ IT.
//
// Kyber is the Amber keyboard (targets/kyber). A keyboard is a separate process
// with its own keychain, so the only way it can act as the signed-in user is a
// keychain access group both binaries are entitled to. The access token lives 15
// minutes, so the keyboard has to refresh too, and refresh tokens are single-use:
// whichever side rotates last holds the only live one. Both sides stamp the time
// on every save and the newer copy wins (lib/sessionStore.ts has the rule and
// its tests).
//
// On a build without the entitlement every shared call throws, is swallowed,
// and the app behaves exactly as it did before Kyber. Only the session keys are
// shared. Onboarding and Face ID preferences are the app's business.
const SAVED_AT_KEY = 'medha_session_saved_at_v1';
const teamId = (Constants.expoConfig?.ios as { appleTeamId?: string } | undefined)?.appleTeamId;
const SHARED_GROUP = teamId ? `${teamId}.com.joinrytual.amber.shared` : null;
// The app's own group, named explicitly for READS. On a Kyber build an
// unqualified read can match the shared item instead, and the two must be told
// apart to know which is newer. Writes stay unqualified, as they always were.
const LEGACY_GROUP = teamId ? `${teamId}.com.joinrytual.amber` : null;

async function sharedGet(key: string): Promise<string | null> {
  if (!SHARED_GROUP) return null;
  return SecureStore.getItemAsync(key, { accessGroup: SHARED_GROUP });
}

async function sharedSet(key: string, value: string): Promise<void> {
  if (!SHARED_GROUP) return;
  try {
    await SecureStore.setItemAsync(key, value, { accessGroup: SHARED_GROUP });
  } catch {
    // No entitlement on this build. The private item still holds the value.
  }
}

async function sharedDelete(key: string): Promise<void> {
  if (!SHARED_GROUP) return;
  try {
    await SecureStore.deleteItemAsync(key, { accessGroup: SHARED_GROUP });
  } catch {
    // Nothing to delete, or no entitlement.
  }
}

// Explicit group first; if that finds nothing (or the group name guess is
// wrong), the unqualified read every build has always done.
async function legacyGet(key: string): Promise<string | null> {
  if (LEGACY_GROUP) {
    try {
      const v = await SecureStore.getItemAsync(key, { accessGroup: LEGACY_GROUP });
      if (v) return v;
    } catch {
      // Fall through.
    }
  }
  return SecureStore.getItemAsync(key);
}

async function readShared(): Promise<SessionCopy | null> {
  try {
    const [token, phone, refreshToken, savedAt] = await Promise.all([
      sharedGet(SESSION_KEY),
      sharedGet(PHONE_KEY),
      sharedGet(REFRESH_KEY),
      sharedGet(SAVED_AT_KEY),
    ]);
    return { token, phone, refreshToken, savedAt: parseSavedAt(savedAt) };
  } catch {
    return null; // no entitlement: there is no shared copy on this build
  }
}

async function readLegacy(): Promise<SessionCopy> {
  const [token, phone, refreshToken, savedAt] = await Promise.all([
    legacyGet(SESSION_KEY),
    legacyGet(PHONE_KEY),
    legacyGet(REFRESH_KEY),
    legacyGet(SAVED_AT_KEY),
  ]);
  return { token, phone, refreshToken, savedAt: parseSavedAt(savedAt) };
}

async function writeShared(copy: SessionCopy, savedAt: number): Promise<void> {
  await Promise.all([
    copy.token ? sharedSet(SESSION_KEY, copy.token) : Promise.resolve(),
    copy.phone ? sharedSet(PHONE_KEY, copy.phone) : Promise.resolve(),
    copy.refreshToken ? sharedSet(REFRESH_KEY, copy.refreshToken) : sharedDelete(REFRESH_KEY),
  ]);
  await sharedSet(SAVED_AT_KEY, String(savedAt));
}

async function liveSession(): Promise<SessionCopy> {
  const [shared, legacy] = await Promise.all([readShared(), readLegacy()]);
  const choice = pickSession(shared, legacy);
  if (choice.copyToShared) await writeShared(choice.copy, choice.copy.savedAt ?? Date.now());
  return choice.copy;
}

// Every sign-in replaces the refresh credential, including legacy responses
// with no refresh token. Keeping the previous token can restore another account.
// Access-token refresh explicitly passes its current/rotated refresh token.
export async function saveSession(
  token: string,
  phone: string,
  refreshToken?: string | null,
): Promise<void> {
  const savedAt = String(Date.now());
  await Promise.all([
    SecureStore.setItemAsync(SESSION_KEY, token),
    SecureStore.setItemAsync(PHONE_KEY, phone),
    refreshToken
      ? SecureStore.setItemAsync(REFRESH_KEY, refreshToken)
      : SecureStore.deleteItemAsync(REFRESH_KEY),
  ]);
  await SecureStore.setItemAsync(SAVED_AT_KEY, savedAt);
  await Promise.all([
    sharedSet(SESSION_KEY, token),
    sharedSet(PHONE_KEY, phone),
    refreshToken ? sharedSet(REFRESH_KEY, refreshToken) : sharedDelete(REFRESH_KEY),
  ]);
  await sharedSet(SAVED_AT_KEY, savedAt);
}

export async function loadRefreshToken(): Promise<string | null> {
  return (await liveSession()).refreshToken;
}

export async function loadSession(): Promise<{ token: string; phone: string } | null> {
  const { token, phone } = await liveSession();
  if (!token || !phone) return null;
  return { token, phone };
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(SESSION_KEY),
    SecureStore.deleteItemAsync(PHONE_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
    SecureStore.deleteItemAsync(SAVED_AT_KEY),
    SecureStore.deleteItemAsync(ONBOARDED_KEY),
    SecureStore.deleteItemAsync(BIOMETRIC_KEY),
    sharedDelete(SESSION_KEY),
    sharedDelete(PHONE_KEY),
    sharedDelete(REFRESH_KEY),
    sharedDelete(SAVED_AT_KEY),
  ]);
}

// Onboarding-complete flag. Set once the user has passed the post-sign-in
// Contacts step (granted, skipped, or synced) so we don't show it every launch.
export async function hasOnboarded(): Promise<boolean> {
  return (await SecureStore.getItemAsync(ONBOARDED_KEY)) === '1';
}

export async function markOnboarded(): Promise<void> {
  await SecureStore.setItemAsync(ONBOARDED_KEY, '1');
}

// Biometric (Face ID / Touch ID) lock preference. When '1', a returning
// session must pass a biometric check on cold start before the gated app is
// shown. Defaults to enabled the first time a session is established on a
// device that supports and has enrolled biometrics (see lib/auth.ts).
// Tab 7's Profile settings can flip this flag via setBiometricLock.
export async function getBiometricLock(): Promise<boolean> {
  return (await SecureStore.getItemAsync(BIOMETRIC_KEY)) === '1';
}

export async function setBiometricLock(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(BIOMETRIC_KEY, enabled ? '1' : '0');
}

// Whether the user has ever made an explicit biometric choice. Distinguishes
// "never asked" (so we can opt them in by default once) from "explicitly off".
export async function hasBiometricPreference(): Promise<boolean> {
  return (await SecureStore.getItemAsync(BIOMETRIC_KEY)) !== null;
}
