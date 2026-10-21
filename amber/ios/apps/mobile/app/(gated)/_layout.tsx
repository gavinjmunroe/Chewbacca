import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary';
import { LIGHT } from '../../lib/theme';
import { registerForPushNotifications } from '../../lib/push';
import { claimPushRegistration } from '../../lib/pushLatch';
import { ConnectLinkBridge } from '../../components/ConnectLinkBridge';
import { KeyboardProbe } from '../../components/KeyboardProbe';
import { installContactsSyncResume } from '../../lib/contactsSyncEngine';

// Sign in -> onboarding (Apple Contacts permission + first sync) -> tabs.
// AuthGate routes a signed-in user who hasn't completed onboarding to
// /(gated)/onboarding; once the contacts step is done they land in the tabs.

// Catches render throws inside the gated group (home, profile, person, circles…)
// closer to the failure than the root boundary, so recovering keeps the session
// and the rest of the app mounted.
export { RouteErrorBoundary as ErrorBoundary };

// The once-per-session latch lives in lib/pushLatch.ts so sign-out can reset it
// without importing a route file. See the note there.

export default function GatedLayout() {
  // Reaching the gated group means AuthGate already confirmed a session, so
  // refresh the push token for users who are already past onboarding.
  // Fire-and-forget: registerForPushNotifications never throws.
  useEffect(() => {
    if (!claimPushRegistration()) return;
    void registerForPushNotifications();
  }, []);

  // A CONTACT SYNC THAT WAS INTERRUPTED FINISHES ITSELF.
  //
  // "Even if I go to a different page on the app, it should still refresh. In
  //  fact, if I leave the app, it should still refresh."
  //
  // iOS suspends JavaScript when the app leaves the foreground, so a sync cannot
  // literally continue in a pocket without a native background task. What this
  // does is make it un-forgettable: the engine checkpoints after every batch, and
  // this picks the run back up at startup and on every return to the foreground,
  // from wherever it stopped. Mounted at the gated layout because it must not
  // belong to a screen -- being owned by a screen is what made the old sync
  // vanish when he navigated away.
  useEffect(() => installContactsSyncResume(), []);

  return (
    <>
      {/* Completes a shared profile link into a real connect request. Mounted HERE,
          not at the root: reaching the gated group means AuthGate has confirmed a
          session, so there is an authenticated caller to send the request as. Renders
          nothing. */}
      <ConnectLinkBridge />
      {/* THE APP'S ONE KEYBOARD OBSERVER. Renders nothing, and it is mounted
          here rather than in a screen because "exactly once" has to be
          structural: Reanimated does not support useAnimatedKeyboard in two
          components at a time, and it was mounted three times -- twice inside
          SearchDock alone. The live height then stops arriving and every
          keyboard animation in the app degrades to a single jump at the end.
          See components/KeyboardProbe. */}
      <KeyboardProbe />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: LIGHT.canvas },
        }}
      />
    </>
  );
}
