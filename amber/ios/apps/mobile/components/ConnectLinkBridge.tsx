import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import {
  PENDING_CONNECT_TTL_MS,
  consumeConnect,
  usePendingConnect,
} from '../lib/pendingConnect';

// Completes a shared profile link: `amber://connect?u=<username>` → the invite screen.
//
// Mounted inside the GATED group, which is the whole reason it is a separate component
// rather than living next to the root deep-link handler: reaching the gated layout means
// AuthGate has already confirmed a session. The root handler in app/_layout.tsx only PARKS
// the username (lib/pendingConnect.ts), because it can run before there is any session —
// on a cold start the URL arrives before auth is read, and the recipient may not even have
// an account yet. This is what acts on it once there is somebody to act as.
//
// It NAVIGATES and nothing else. Deliberately thin: an earlier version resolved the
// username here, put an Alert over whatever screen the app happened to open, and sent the
// request itself. Everything about that was wrong for the person receiving it, and the
// reasoning is recorded in app/(gated)/connect/invite.tsx, which now owns the whole
// interaction.
export function ConnectLinkBridge() {
  const router = useRouter();
  const pending = usePendingConnect();
  // Guards against a second run for the same intent. consumeConnect() already clears
  // the latch, but the effect can be re-entered before the state update lands (React
  // 19 batching, or a remount mid-flight), and a duplicate here means a duplicate
  // network write.
  const runningRef = useRef(false);
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    if (!pending || runningRef.current) return;
    const intent = consumeConnect();
    if (!intent) return;
    // A link tapped long ago, in a session the user has forgotten about, must not open a
    // connect screen out of nowhere.
    if (Date.now() - intent.at > PENDING_CONNECT_TTL_MS) return;
    runningRef.current = true;

    // NAVIGATE, DO NOT DECIDE.
    //
    // This used to resolve the username here, put an Alert on top of whatever screen the
    // app happened to open, and send the request itself. Three things were wrong with that:
    // the recipient landed on a full app with no indication who had invited them; once the
    // alert closed there was no way back to the invitation; and if that person had already
    // sent THEM a request, the only place to accept it was a section of the Today tab they
    // had no reason to visit.
    //
    // So this bridge now does one thing: hand the username to a screen built for it. All the
    // resolution, every relationship state, and the action itself live in
    // app/(gated)/connect/invite.tsx, which has a back button and cannot strand anyone.
    routerRef.current.navigate({
      pathname: '/(gated)/connect/invite',
      params: { u: intent.username },
    });
    runningRef.current = false;
    // `router` is DELIBERATELY not a dependency. useRouter() returns a new object on
    // every render, so listing it re-runs this effect every render — which is exactly
    // the mechanism that made notification taps flicker the screen on and off before
    // NotificationBridge was rewritten to use a ref. It is harmless here today only
    // because consumeConnect() nulls `pending` and the guard above short-circuits;
    // that is one refactor away from being a loop again. A ref removes the trap.
    //
    // navigate rather than push, so a cold-start link delivered by BOTH getInitialURL
    // and the url listener cannot stack two invite screens.
  }, [pending]);

  return null;
}
