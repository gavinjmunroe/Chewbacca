import { useEffect } from 'react';
import { router } from 'expo-router';
import * as QuickActions from 'expo-quick-actions';
import { hasSession } from './auth';
import { requestVoiceCapture } from './pendingRecord';

// Home Screen quick action -> "New voice note" -> open straight into a live
// recording. This module is the launch-handling core, and it is written so the
// SAME path can be reused by a Home Screen widget and the Action Button later:
// every external entry funnels through startVoiceCaptureFromExternalEntry().
//
// The static item itself is registered by the expo-quick-actions config plugin
// in app.json (iosActions), so it exists on the icon long-press even before the
// first launch. This module only HANDLES the trigger.

// Must match the `id` of the static item in app.json's expo-quick-actions plugin.
export const RECORD_ACTION_ID = 'record';

// Module-level latch: the cold-start action is read from QuickActions.initial,
// which is a static value that persists for the whole app session. This ensures
// it is acted on EXACTLY ONCE per launch, even if the bridge component remounts
// (a remount must never re-read `initial` and record again).
let initialActionHandled = false;

/**
 * The single, reusable "launch into recording" entry point.
 *
 * Shared by the Home Screen quick action today, and by the planned Home Screen
 * widget and Action Button. It does two things and nothing else:
 *   1. Raise the in-memory pending-record signal, which the home voice surface
 *      consumes on mount / while mounted to AUTO-START recording through the
 *      exact same code path a manual long-press uses (setVoiceOpen(true)).
 *   2. Bring the home pager to the front. `router.navigate` dedupes to the
 *      already-open route, so it never stacks a second screen — if the user is
 *      already on the record surface it is effectively a no-op and recording
 *      just starts.
 *
 * Callers are responsible for the auth gate (see handleQuickAction). This never
 * requests the mic itself: the record surface does that via the same permission
 * path as the manual button, so a denial fails gracefully with no stuck state.
 */
export function startVoiceCaptureFromExternalEntry(source: string): void {
  // Set the signal FIRST (synchronous) so a home surface that is already mounted
  // reacts immediately, and a home surface that mounts moments later still finds
  // it waiting.
  requestVoiceCapture(source);
  try {
    router.navigate('/(gated)/home');
  } catch {
    // If the root navigator is not ready yet (very early cold start), the normal
    // startup routing lands on home anyway and consumes the pending signal on
    // mount — so a failed navigate here is harmless.
  }
}

// Turn a fired quick action into a recording, gated on auth. Mirrors the
// NotificationBridge cold/warm handler: never act for a signed-out launch, so a
// quick action can never drop an unauthenticated user into the recorder. If
// there is no session the action is simply dropped and normal routing sends the
// user to sign-in.
async function handleQuickAction(action: QuickActions.Action | null | undefined): Promise<void> {
  if (!action || action.id !== RECORD_ACTION_ID) return;
  if (!(await hasSession())) return;
  startVoiceCaptureFromExternalEntry('quick-action');
}

/**
 * Wire the quick-action launch handling. Mount once near the app root (see
 * QuickActionsBridge in app/_layout.tsx). Handles:
 *   - COLD start: the action that launched the app (QuickActions.initial),
 *     guarded by a module-level latch so it fires exactly once per launch.
 *   - WARM start: actions fired while the app is running/backgrounded, via
 *     addListener. The listener is attached post-launch, so it never re-receives
 *     the cold-start action — no double-fire.
 * The subscription is removed on unmount.
 */
export function useQuickActionRecording(): void {
  useEffect(() => {
    // COLD START — exactly once per launch.
    if (!initialActionHandled) {
      initialActionHandled = true;
      void handleQuickAction(QuickActions.initial);
    }

    // WARM START — actions while the app is alive. Guard the subscription in
    // case the native module is unavailable (web / unsupported), so the bridge
    // can never throw during startup.
    let remove: (() => void) | undefined;
    try {
      const sub = QuickActions.addListener((action) => {
        void handleQuickAction(action);
      });
      remove = sub.remove;
    } catch {
      remove = undefined;
    }
    return () => {
      remove?.();
    };
  }, []);
}

/**
 * Drop-in bridge for the root layout. Renders nothing; just installs the
 * cold/warm quick-action handlers. Placed alongside NotificationBridge so it
 * lives where the router is mounted and mounts exactly once per launch.
 */
export function QuickActionsBridge(): null {
  useQuickActionRecording();
  return null;
}
