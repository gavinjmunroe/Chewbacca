import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { hasSession } from './auth';
import { startVoiceCaptureFromExternalEntry } from './quickActions';

// Deep-link entry point: opening `amber://record` launches the app straight into
// a live voice recording. This is the SAME external-entry path the Home Screen
// quick action uses — it funnels through startVoiceCaptureFromExternalEntry(),
// which raises the pending-record signal and brings the home pager forward; the
// home surface consumes that signal (with a ~15s TTL + auth gate) and opens the
// exact recorder a manual long-press opens.
//
// This is the bridge the Action Button (via a user-assigned Shortcut that fires
// "Open URL amber://record") and the future Home/Lock-screen widgets all target.
//
// The app only declares the custom scheme `amber` (app.json `scheme`), and no
// associatedDomains / universal link, so only the custom-scheme form is handled.
// If a universal link is added later, extend `isRecordLink` to also match it.
//
// It NEVER auto-records on a normal open: it acts only when the URL that opened
// the app is the record intent, and only when a session exists. Any other
// `amber://` URL (oauth-callback, cards, profiles, …) is ignored here and left
// for expo-router's normal linking + the existing DeepLinkBridge to handle —
// Linking listeners are observational, so ignoring a URL never swallows it.

// The custom-scheme host that means "start recording": amber://record
const RECORD_HOST = 'record';

// Module-level latch: the cold-start URL from Linking.getInitialURL() is a
// static value that persists for the whole app session. This guarantees it is
// acted on EXACTLY ONCE per launch, even if the bridge component remounts (a
// remount must never re-read the initial URL and record again).
let initialUrlHandled = false;

/**
 * Is this URL the record intent? For `amber://record` expo-linking parses the
 * host into `hostname`; we also check `path` to be robust to `amber:///record`
 * style forms. Anything else returns false and is passed through untouched.
 */
export function isRecordLink(url: string): boolean {
  try {
    const parsed = Linking.parse(url);
    const host = (parsed.hostname ?? '').toLowerCase();
    const path = (parsed.path ?? '').replace(/^\/+/, '').toLowerCase();
    return host === RECORD_HOST || path === RECORD_HOST;
  } catch {
    return false;
  }
}

/**
 * Turn a record deep link into a recording, gated on auth. Mirrors
 * handleQuickAction: only act on the record intent, and never act for a
 * signed-out launch — a signed-out record link is simply dropped (we never raise
 * the pending signal, so nothing is left stuck) and normal routing sends the
 * user to sign-in.
 */
async function handleUrl(url: string | null | undefined): Promise<void> {
  if (!url || !isRecordLink(url)) return;
  if (!(await hasSession())) return;
  startVoiceCaptureFromExternalEntry('deeplink');
}

/**
 * Wire the record deep-link handling. Mount once near the app root (see
 * RecordDeepLinkBridge in app/_layout.tsx). Handles:
 *   - COLD start: the URL that launched the app (Linking.getInitialURL),
 *     guarded by a module-level latch so it fires exactly once per launch.
 *   - WARM start: URLs opened while the app is running/backgrounded, via
 *     Linking.addEventListener('url'). The listener is attached post-launch, so
 *     it never re-receives the cold-start URL — no double-fire with the latch.
 * The subscription is removed on unmount.
 */
export function useRecordDeepLink(): void {
  useEffect(() => {
    // COLD START — exactly once per launch. getInitialURL resolves async; the
    // latch is flipped synchronously so a remount before it resolves can't
    // schedule a second read.
    if (!initialUrlHandled) {
      initialUrlHandled = true;
      Linking.getInitialURL()
        .then((url) => handleUrl(url))
        .catch(() => {});
    }

    // WARM START — URLs opened while the app is alive.
    const sub = Linking.addEventListener('url', ({ url }) => {
      void handleUrl(url);
    });
    return () => sub.remove();
  }, []);
}

/**
 * Drop-in bridge for the root layout. Renders nothing; just installs the
 * cold/warm record deep-link handlers. Placed alongside QuickActionsBridge so it
 * lives where the router is mounted and mounts exactly once per launch.
 */
export function RecordDeepLinkBridge(): null {
  useRecordDeepLink();
  return null;
}
