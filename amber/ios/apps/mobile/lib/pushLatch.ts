// Push-token registration runs once per SESSION, not once per launch.
//
// This lived as a module-level `let` inside app/(gated)/_layout.tsx, which made it
// launch-scoped: signing out and signing in as a different account in the same
// process never registered the second account's token, because the effect saw the
// latch already set and returned. That account then received no notifications at
// all, and the server logged "no registered devices" for them forever with nothing
// to explain it.
//
// It lives in its own module rather than being exported from the layout so that
// lib/auth.ts can reset it on sign-out without importing a route file — an edge
// from auth into (gated)/_layout would run back through ConnectLinkBridge and the
// network layer into auth itself, and an import cycle around session state is not
// a thing to introduce for the sake of one boolean.
let registered = false;

/** True the first time it is called in a session, false every time after. */
export function claimPushRegistration(): boolean {
  if (registered) return false;
  registered = true;
  return true;
}

/** Called from clearLocalUserData on sign-out, so the next account registers. */
export function resetPushRegistrationLatch(): void {
  registered = false;
}
