import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { Redirect, useSegments, type Href } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ScanFace } from 'lucide-react-native';
import {
  authenticateBiometric,
  getBiometricCapability,
  isSessionValid,
  shouldBiometricLock,
  signOut,
} from '../lib/auth';
import { isOnboardingComplete } from '../lib/onboardingState';
import { colors, radius, spacing } from '../lib/tokens';
import { Button } from './Button';
import { Text } from './Text';

// Routes under (auth) are public. Everything else requires a valid session.

// Lets the onboarding screen flip the in-memory onboarded flag to true
// immediately at completion, so AuthGate's segKey effect never sees a stale
// false even if the Keychain write hasn't flushed yet.
type AuthGateContextValue = {
  markOnboardedInState: () => void;
  /**
   * Call this the instant a sign-in succeeds, BEFORE navigating.
   *
   * The session re-check below is async -- isSessionValid() plus
   * isOnboardingComplete(), which is a network call to /v1/me. router.replace
   * changes segKey and re-fires it, but `state` stays 'out' for the whole round
   * trip, and the redirect rule "state === 'out' && !onAuthRoute" fires on the
   * very next render. So verifying a code threw the user back to the sign-in
   * screen for a beat and then forward again once the check resolved.
   *
   * Exactly the race markOnboardedInState was added for, one screen earlier: the
   * truth is already known synchronously by the caller, so it says so instead of
   * letting the gate rediscover it over the network.
   */
  markSignedInInState: () => void;
};
const AuthGateContext = createContext<AuthGateContextValue>({
  markOnboardedInState: () => {},
  markSignedInInState: () => {},
});
export function useAuthGate(): AuthGateContextValue {
  return useContext(AuthGateContext);
}

const APP_ICON = require('../assets/images/icon.png');

/**
 * THE ONLY LAUNCH SCREEN. THERE USED TO BE TWO.
 *
 * "It still shows the old initial logo before it shows the new one that says
 *  Amber under it. It should only show the new logo."
 *
 * There were two splashes, and nothing was wrong with either of them on its own.
 * expo-splash-screen drew the bare ember from splash-icon.png at 200pt while the
 * native side booted; then this drew the ember at 84pt with the wordmark under
 * it while the session resolved. Two different marks at two different sizes, one
 * replacing the other, which reads as the app changing its mind about its logo.
 *
 * THE FIX IS NOT A NEW IMAGE, IT IS THE SAME IMAGE TWICE. assets/images/
 * splash-amber.png is this exact stack -- the 84pt icon, spacing.base under it,
 * the wordmark set in displayLg -- composited into one PNG and handed to
 * expo-splash-screen at imageWidth 84 on the same #FFFDFA. Both screens center
 * the same content at the same size on the same ground, so the handoff between
 * them has nothing to animate and cannot be seen.
 *
 * WHICH IS WHY THE SPINNER WAITS. It is the one element the native splash cannot
 * have, so showing it immediately would put the seam right back -- a spinner
 * appearing out of nothing is exactly as visible as a logo changing size. A boot
 * that resolves quickly never renders it. A boot that does not is a boot where
 * "something is happening" is worth more than a seamless handoff, and by then
 * there is no handoff left to protect.
 */
const SPINNER_AFTER_MS = 700;

function BrandedSplash() {
  const [showSpinner, setShowSpinner] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowSpinner(true), SPINNER_AFTER_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <View style={styles.fill}>
      <View style={styles.brandStack}>
        <Image source={APP_ICON} style={styles.brandIcon} resizeMode="contain" />
        <Text variant="displayLg" color="ink">
          Amber
        </Text>
      </View>
      {showSpinner ? (
        <View style={styles.splashSpinner}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}
    </View>
  );
}

// Full-bleed lock shown on cold start for a returning session when biometric
// lock is enabled. Auto-prompts once on mount. The user can retry or fall back
// to signing in with a fresh code (which clears the session).
function BiometricLockScreen({
  onUnlock,
  onUseCode,
}: {
  onUnlock: () => void;
  onUseCode: () => void;
}) {
  const [label, setLabel] = useState<'Face ID' | 'Touch ID' | 'biometrics'>('Face ID');
  const [status, setStatus] = useState<'prompting' | 'idle' | 'error'>('prompting');
  const [signingOut, setSigningOut] = useState(false);
  const prompted = useRef(false);

  const runPrompt = async () => {
    setStatus('prompting');
    const res = await authenticateBiometric('Unlock Amber');
    if (res.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onUnlock();
      return;
    }
    // If biometrics became unavailable since the gate checked, do not trap the
    // user behind a lock the device can no longer satisfy: let them through.
    if (res.reason === 'unavailable') {
      onUnlock();
      return;
    }
    setStatus(res.reason === 'failed' ? 'error' : 'idle');
  };

  useEffect(() => {
    if (prompted.current) return;
    prompted.current = true;
    getBiometricCapability().then((cap) => setLabel(cap.label));
    runPrompt();
    // runPrompt is stable for this mount; we intentionally prompt exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUseCode = async () => {
    if (signingOut) return;
    setSigningOut(true);
    await signOut();
    onUseCode();
  };

  return (
    <View style={[styles.fill, styles.lockRoot]}>
      <View style={styles.lockStack}>
        <View style={styles.lockBubble}>
          <ScanFace size={34} color={colors.primary} strokeWidth={1.75} />
        </View>
        <View style={styles.lockCopy}>
          <Text variant="displayMd" color="ink" centered>
            Welcome back
          </Text>
          <Text variant="bodyMd" color="muted" centered>
            {status === 'error'
              ? `Could not confirm it is you. Try ${label} again.`
              : `Unlock Amber with ${label}.`}
          </Text>
        </View>
      </View>

      <View style={styles.lockActions}>
        <Button
          label={status === 'prompting' ? 'Unlocking' : `Unlock with ${label}`}
          onPress={runPrompt}
          loading={status === 'prompting'}
          fullWidth
        />
        <Button
          label="Sign in another way"
          variant="tertiary"
          onPress={handleUseCode}
          loading={signingOut}
          fullWidth
        />
      </View>
    </View>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');
  // null = not resolved yet. It must NOT default to true: the sign-in branch
  // below now routes on this value, and a default of true with the old
  // promote-only update (`prev || done`) meant it could never be false, so a
  // genuinely new user would be waved straight past onboarding.
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [locked, setLocked] = useState(false);
  const segments = useSegments() as string[];
  const segKey = segments.join('/');

  // Set when onboarding completes in THIS session. It replaces the old
  // promote-only update as the race guard: the Keychain write may not have
  // flushed by the time the segKey effect re-reads it, and this ref keeps that
  // stale false from bouncing the user back into the flow they just finished.
  const completedInSession = useRef(false);

  // Stable callback exposed via context. Onboarding calls this before
  // router.replace so the in-memory flag is true before the segKey effect
  // re-fires, eliminating the Keychain-flush race.
  const markOnboardedInState = useCallback(() => {
    completedInSession.current = true;
    setOnboarded(true);
  }, []);

  // Signed in, known synchronously. `onboarded` is deliberately left alone: the
  // async check that follows decides whether this person still needs the
  // contacts step, and guessing here would either skip it for a new user or
  // re-run it for a returning one.
  const markSignedInInState = useCallback(() => {
    completedInSession.current = false;
    setOnboarded(null);
    setState('in');
  }, []);

  // Re-check session on every navigation. Without segKey in deps, the
  // session check fires once at mount and never re-evaluates. That means
  // when the user verifies their code and verifyCode writes the JWT to
  // secure storage, AuthGate's local state is still 'out' from the initial
  // check, so the router.replace into the gated tabs immediately
  // bounces right back to /(auth)/sign-in. Re-checking on segment change
  // makes the transition lossless.
  //
  // isSessionValid (not hasSession) is the gate now: it decodes the JWT exp
  // and clears an expired token so a stale session routes cleanly to sign-in
  // instead of letting every gated API call 401 in turn.
  useEffect(() => {
    let live = true;
    (async () => {
      const ok = await isSessionValid();
      // Only ask about onboarding when there IS a session — isOnboardingComplete
      // hits /v1/me, which is pointless (and 401s) when signed out.
      const done = ok ? await isOnboardingComplete() : false;
      if (!live) return;
      // A sign-out ends the session the in-memory completion belonged to, so
      // the next account to sign in on this device gets asked properly rather
      // than inheriting the previous user's "done".
      if (!ok) completedInSession.current = false;
      setState(ok ? 'in' : 'out');
      setOnboarded(ok ? completedInSession.current || done : false);
      if (ok) {
        const lock = await shouldBiometricLock();
        if (live) setLocked(lock);
      } else {
        setLocked(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [segKey]);

  // Hold the splash until BOTH answers are in. They resolve together, but routing on
  // a null `onboarded` would be a coin flip, so this is explicit.
  //
  // OVER THE CHILDREN, NOT INSTEAD OF THEM — and this is why tapping a notification
  // opened the app to nothing. Returning <BrandedSplash/> in PLACE of {children}
  // unmounts the root <Stack>, and that Stack is what registers the (gated) route
  // group. NotificationBridge only waits for a session (one SecureStore read) before
  // pushing, while this gate needs two sequential reads plus a state update plus a
  // render — so the push essentially always lands during the window when no navigator
  // exists. React Navigation warns that the PUSH "was not handled by any navigator",
  // the tap is dropped, and the app settles on Home. The notification appeared to do
  // nothing.
  //
  // Rendering the splash as an absolute overlay keeps the navigator mounted the whole
  // time, so a push that arrives early is queued by a real navigator instead of
  // hitting the floor. Exactly the pattern the biometric lock below already uses, and
  // the same reasoning as the <Redirect> note further down: never unmount the Stack.
  const booting = state === 'loading' || onboarded === null;
  if (booting) {
    return (
      <AuthGateContext.Provider value={{ markOnboardedInState, markSignedInInState }}>
        <>
          {children}
          <View style={StyleSheet.absoluteFill} pointerEvents="auto">
            <BrandedSplash />
          </View>
        </>
      </AuthGateContext.Provider>
    );
  }

  const onAuthRoute = segments[0] === '(auth)';
  const onOnboardingRoute = segments[segments.length - 1] === 'onboarding';

  // Compute the redirect target without ever unmounting the navigator.
  // Returning <Redirect> in PLACE of {children} tears down the root <Stack>,
  // and that Stack is what registers the (auth) / (gated) route groups. If a
  // screen fires router.replace('/(gated)/home') during that teardown
  // (e.g. onboarding finishing while this gate still reads a stale
  // onboarded=false), the action lands on an empty navigator and React
  // Navigation throws "REPLACE ... was not handled / route named (gated)?".
  // Keeping the Stack mounted and rendering the Redirect alongside it removes
  // the race: (gated) is always a valid route, so the queued REPLACE resolves.
  let redirectTo: Href | null = null;
  if (state === 'out' && !onAuthRoute) {
    redirectTo = '/(auth)/sign-in';
  } else if (state === 'in' && !onboarded && !onOnboardingRoute) {
    // Signed in but hasn't completed the contacts step yet: send to onboarding
    // (unless already there). This is where Apple Contacts permission is asked.
    redirectTo = '/(gated)/onboarding';
  } else if (state === 'in' && (onAuthRoute || (onOnboardingRoute && onboarded))) {
    // Just signed in. This branch used to send EVERYONE to onboarding
    // unconditionally — it did not consult `onboarded` the way the branch above
    // does — so a returning user who had already completed the flow was walked
    // through it again on every sign-in. That was the re-onboarding bug.
    redirectTo = onboarded ? '/(gated)/home' : '/(gated)/onboarding';
  }

  // The biometric lock is an opaque overlay rendered ON TOP of the mounted
  // navigator, never in place of it, so the same navigator-teardown race the
  // redirect logic guards against cannot fire while the user is unlocking.
  const showLock = state === 'in' && locked;

  return (
    <AuthGateContext.Provider value={{ markOnboardedInState, markSignedInInState }}>
      <>
        {children}
        {redirectTo ? <Redirect href={redirectTo} /> : null}
        {showLock ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="auto">
            <BiometricLockScreen
              onUnlock={() => setLocked(false)}
              onUseCode={() => {
                setLocked(false);
                setState('out');
              }}
            />
          </View>
        ) : null}
      </>
    </AuthGateContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
  },
  brandStack: {
    alignItems: 'center',
    gap: spacing.base,
  },
  brandIcon: {
    width: 84,
    height: 84,
    borderRadius: radius.lg,
  },
  splashSpinner: {
    position: 'absolute',
    bottom: spacing.section,
  },
  lockRoot: {
    paddingHorizontal: spacing.lg,
    justifyContent: 'space-between',
    paddingTop: spacing.section * 2,
    paddingBottom: spacing.section,
  },
  lockStack: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  lockBubble: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSoft,
  },
  lockCopy: {
    gap: spacing.sm,
    maxWidth: 320,
  },
  lockActions: {
    gap: spacing.md,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
});
