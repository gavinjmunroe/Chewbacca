import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, View, Image } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { TextInput } from '../../components/TextInput';
import { requestCode, verifyPhoneCode } from '../../lib/auth';
import {
  isAppleAvailable,
  linkSocialWithPhone,
  signInWithApple,
  signInWithGoogle,
  type SocialProvider,
} from '../../lib/socialAuth';
import { formatDisplay, isLikelyValid } from '../../lib/phone';
import { privacyPolicyUrl, termsUrl } from '../../lib/config';
import { spacing } from '../../lib/tokens';
import { cl } from '../../lib/classical';
import { useAuthGate } from '../../components/AuthGate';

// THREE WAYS IN, ONE DOOR.
//
// Apple, Google, and a phone number. The first two are not separate doors: a
// provider token proves you hold that Apple or Google account and says nothing
// about which Amber account is yours, and neither provider gives us a phone. So
// a first-time social sign-in comes back with a TICKET and lands on the same
// code screen the phone flow uses -- the provider identity is then attached to
// the account the OTP resolves. A returning one skips straight through.
//
// That is why adding two buttons cannot widen who gets in. See lib/socialAuth.ts
// and, on the server, routes/social-auth.js.
//
// Two-stage phone sign-in: enter phone → Amber texts a 6-digit code to the
// user's iMessage → enter code → verified. Some numbers must text Amber once
// first (opt-in / handshake); when the backend reports that, we show a deep
// link to Messages before letting them retry. On verify success the session is
// saved by verifyPhoneCode and AuthGate takes over routing.
type Stage = 'phone' | 'code';

type OptIn = { url?: string; message: string };

export default function SignIn() {
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string }>();

  const [stage, setStage] = useState<Stage>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [optIn, setOptIn] = useState<OptIn | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  /**
   * The provider identity waiting for a phone, if a social sign-in started one.
   *
   * Its presence is what makes the code step call the LINK endpoint instead of
   * the plain verify -- so the two flows share one screen, one input and one
   * keyboard behavior rather than a second screen built to look the same.
   */
  const [pending, setPending] = useState<{ provider: SocialProvider; ticket: string } | null>(null);
  /** Which social button is mid-flight. One at a time, always. */
  const [social, setSocial] = useState<SocialProvider | null>(null);
  const [appleReady, setAppleReady] = useState(false);
  const { markSignedInInState } = useAuthGate();
  const [error, setError] = useState<string | null>(null);

  const flight = useRef(false);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const retrySeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  const phoneValid = isLikelyValid(phone);
  const googleReady = false; // Hidden during this beta; existing connections remain available in settings.
  /**
   * Anything at all in flight. Every control reads this, so a second tap during
   * a browser hand-off or a network call cannot start a parallel flow and land
   * two sessions on top of each other.
   */
  const busy = sending || verifying || social !== null;

  // Apple's button may only be shown where it works: not on Android, not on an
  // older iOS, not on simulator images that lack it. Probed rather than assumed.
  useEffect(() => {
    let alive = true;
    void isAppleAvailable().then((ok) => {
      if (alive) setAppleReady(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  const onSocial = async (provider: SocialProvider) => {
    if (busy || flight.current) return;
    flight.current = true;
    setError(null);
    setOptIn(null);
    setSocial(provider);
    try {
      const res = provider === 'apple' ? await signInWithApple() : await signInWithGoogle();

      // CANCELLING IS NOT AN ERROR. Tapping the button and changing your mind is
      // the most common thing that happens on this screen, and "sign-in failed"
      // for it is the app calling the user's own decision a bug.
      if (res.kind === 'cancelled') return;

      if (res.kind === 'error') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        setError(res.message);
        return;
      }

      if (res.kind === 'needsPhone') {
        Haptics.selectionAsync().catch(() => {});
        setPending({ provider: res.provider, ticket: res.ticket });
        setCode('');
        setStage('phone');
        return;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      markSignedInInState();
      const next = typeof params.next === 'string' ? params.next : '/(gated)/home';
      router.replace(next as never);
    } catch {
      setError('Could not finish signing in. Please try again.');
    } finally {
      flight.current = false;
      setSocial(null);
    }
  };

  const onSendCode = async () => {
    if (busy || flight.current || !phoneValid || retrySeconds > 0) return;
    flight.current = true;
    setNow(Date.now());
    setRetryAt(Date.now() + 30_000);
    setError(null);
    setOptIn(null);
    setSending(true);
    try {
      const res = await requestCode(phone);
      if (res.kind === 'error') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        setError(res.message);
        return;
      }
      if (res.kind === 'optIn') {
        // Stay on the phone stage: the user must text Amber once, then tap Send
        // code again to actually receive a code.
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        setOptIn({ url: res.optInUrl, message: res.message });
        setStage('phone');
        return;
      }
      Haptics.selectionAsync().catch(() => {});
      setCode('');
      setStage('code');
    } catch {
      setError('Could not request your code. Please try again.');
    } finally {
      flight.current = false;
      setSending(false);
    }
  };

  const onOpenOptIn = () => {
    if (!optIn?.url) return;
    Linking.openURL(optIn.url).catch(() => {
      setError("Couldn't open Messages. Text Amber from your Messages app, then try again.");
    });
  };

  const onVerify = async () => {
    if (busy || flight.current || code.length !== 6) return;
    flight.current = true;
    setError(null);
    setVerifying(true);
    /**
     * ONE CODE FIELD, TWO ENDPOINTS. With a ticket in hand the OTP has to go to
     * the link endpoint, which verifies it exactly the way /v1/auth/verify does
     * and then attaches the provider identity in the same transaction. Calling
     * the plain verify here would sign them in and silently DROP the Apple or
     * Google login they just went through -- so the next launch would ask for a
     * phone code again and the button would look broken.
     */
    try {
      const res = pending
        ? await linkSocialWithPhone(pending.provider, pending.ticket, phone, code)
        : await verifyPhoneCode(phone, code);
      if (!res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        setError(res.message);
        // An expired ticket cannot be retried with a new code -- the identity it
        // carried is gone. Drop back to a plain sign-in rather than leaving them
        // typing codes into a dead flow.
        if ('expired' in res && res.expired) {
          setPending(null);
          setStage('phone');
          setCode('');
        }
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // BEFORE navigating, not after. AuthGate re-checks the session on every
      // route change, but that check is async -- and until it resolves its state
      // still says "signed out", so the replace below was immediately redirected
      // back to this screen and only then forward again. That is the flash between
      // submitting the code and landing in the app.
      markSignedInInState();
      const next = typeof params.next === 'string' ? params.next : '/(gated)/home';
      router.replace(next as never);
    } catch {
      setError('Could not finish signing in. Please try again.');
    } finally {
      flight.current = false;
      setVerifying(false);
    }
  };

  const onBack = () => {
    if (flight.current) return;
    setError(null);
    setCode('');
    setOptIn(null);
    setStage('phone');
  };

  /** Abandon a half-finished social sign-in and go back to phone only. */
  const onCancelSocial = () => {
    if (flight.current) return;
    setError(null);
    setPending(null);
    setCode('');
    setStage('phone');
  };

  const inputStyle = {
    backgroundColor: cl.card,
    color: cl.ink,
    borderColor: cl.ruleFaint,
  };

  return (
    <Screen scroll centered background={cl.ground}>
      <View style={{ gap: spacing.xl, maxWidth: 420, alignSelf: 'center', width: '100%' }}>
        <View style={{ gap: spacing.sm, alignItems: 'center' }}>
          <Image
            source={require('../../assets/amber-logo.png')}
            accessibilityIgnoresInvertColors
            resizeMode="contain"
            style={{ width: 76, height: 76, marginBottom: spacing.xs }}
          />
          <Text variant="displayXl" centered style={{ color: cl.ink }}>
            Sign in to Amber
          </Text>
          <Text variant="bodyMd" centered style={{ color: cl.ink55 }}>
            {/* THE LINKING STEP NEEDS ITS OWN SENTENCE. Somebody who just tapped
                "Continue with Apple" and landed on a phone field will assume it
                failed unless the screen says why it is asking. */}
            {pending
              ? stage === 'phone'
                ? `One more step: your phone number confirms it's you, and connects ${pending.provider === 'apple' ? 'Apple' : 'Google'} to your Amber account.`
                : `Enter the 6-digit code sent to ${formatDisplay(phone)} in Messages.`
              : stage === 'phone'
                ? 'Enter your phone number to receive a 6-digit code in iMessage.'
                : `Enter the 6-digit code sent to ${formatDisplay(phone)} in Messages.`}
          </Text>
        </View>

        {/* THE SOCIAL BUTTONS COME FIRST, and disappear once a ticket exists.
            Offering "Continue with Google" to somebody who is three steps into
            an Apple link is offering to throw that away by accident.

            Each hides itself when it cannot work: Apple where iOS does not
            offer it, Google where no client id is configured in this build. A
            button that opens a broken Google error page is worse than no
            button, and an absent client id is a real state on a fresh checkout. */}
        {stage === 'phone' && !pending && (appleReady || googleReady) ? (
          <View style={{ gap: spacing.sm }}>
            {appleReady ? (
              <Button
                label={social === 'apple' ? 'Signing in' : 'Continue with Apple'}
                onPress={() => void onSocial('apple')}
                loading={social === 'apple'}
                disabled={busy && social !== 'apple'}
                fullWidth
                backgroundColor={cl.ink}
                textColor={cl.card}
              />
            ) : null}
            {googleReady ? (
              <Button
                label={social === 'google' ? 'Signing in' : 'Continue with Google'}
                onPress={() => void onSocial('google')}
                loading={social === 'google'}
                disabled={busy && social !== 'google'}
                fullWidth
                backgroundColor={cl.card}
                textColor={cl.ink}
              />
            ) : null}
            <Text variant="captionSm" centered style={{ color: cl.ink38 }}>
              or use your phone number
            </Text>
          </View>
        ) : null}

        {stage === 'phone' ? (
          <View style={{ gap: spacing.base }}>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="Phone number (include country code)"
              editable={!busy}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              autoFocus
              error={error ?? undefined}
              style={inputStyle}
            />
            <Button
              label={
                sending ? 'Sending' : retrySeconds > 0 ? `Retry in ${retrySeconds}s` : 'Send code'
              }
              onPress={onSendCode}
              loading={sending}
              disabled={!phoneValid || busy || retrySeconds > 0}
              fullWidth
              backgroundColor={cl.goldDeep}
              textColor={cl.card}
            />
            <Button
              label="I already have a code"
              onPress={() => {
                setError(null);
                setCode('');
                setStage('code');
              }}
              disabled={!phoneValid || busy}
              backgroundColor={cl.ground}
              textColor={cl.ink55}
              fullWidth
            />
            {optIn ? (
              <View
                style={{
                  gap: spacing.sm,
                  padding: spacing.base,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: cl.ruleFaint,
                  backgroundColor: cl.card,
                }}
              >
                <Text variant="bodySm" style={{ color: cl.ink55 }}>
                  {optIn.message}
                </Text>
                {optIn.url ? (
                  <>
                    <Button
                      label="Text Amber to enable codes"
                      onPress={onOpenOptIn}
                      fullWidth
                      backgroundColor={cl.goldDeep}
                      textColor={cl.card}
                    />
                    <Text variant="captionSm" centered style={{ color: cl.ink38 }}>
                      Tap to text Amber once to enable codes, then tap Send code again.
                    </Text>
                  </>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : (
          <View style={{ gap: spacing.base }}>
            <TextInput
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              placeholder="6-digit code"
              editable={!busy}
              keyboardType="number-pad"
              // AUTOFILL, PER PLATFORM. iOS reads the code out of Messages and
              // offers it above the keyboard, but only for textContentType
              // 'oneTimeCode' AND an autoComplete value it recognizes --
              // 'sms-otp' is Android-only, and handing it to iOS left the field
              // with no usable hint, so QuickType fell back to contact data and
              // suggested the user's own phone number instead of the code.
              textContentType="oneTimeCode"
              autoComplete={Platform.OS === 'ios' ? 'one-time-code' : 'sms-otp'}
              importantForAutofill="yes"
              autoFocus
              maxLength={6}
              error={error ?? undefined}
              style={inputStyle}
            />
            <Button
              label={verifying ? 'Verifying' : 'Verify'}
              onPress={onVerify}
              loading={verifying}
              disabled={code.length < 6 || busy}
              fullWidth
              backgroundColor={cl.goldDeep}
              textColor={cl.card}
            />
            <Button
              label={
                sending
                  ? 'Sending'
                  : retrySeconds > 0
                    ? `Resend in ${retrySeconds}s`
                    : 'Resend code'
              }
              onPress={onSendCode}
              disabled={busy || retrySeconds > 0}
              backgroundColor={cl.ground}
              textColor={cl.ink55}
              fullWidth
            />
            <View style={{ alignItems: 'center', marginTop: spacing.sm }}>
              <Text
                variant="link"
                onPress={onBack}
                accessibilityRole="button"
                style={{ color: cl.ink55 }}
              >
                Use a different number
              </Text>
            </View>
          </View>
        )}

        {/* A WAY OUT OF A HALF-FINISHED LINK. Without it, somebody who started
            with Apple and cannot receive a code is stuck on this screen with no
            control that returns them to an ordinary phone sign-in. */}
        {pending ? (
          <View style={{ alignItems: 'center' }}>
            <Text
              variant="link"
              onPress={onCancelSocial}
              accessibilityRole="button"
              style={{ color: cl.ink38 }}
            >
              Sign in with just my phone number instead
            </Text>
          </View>
        ) : null}

        {/* THE AGREEMENT, WHERE THE ACCOUNT IS MADE.
            
            An app with user-generated content needs terms its users have agreed
            to (Guideline 1.2), and the only honest place to say so is the screen
            where somebody becomes a user -- not buried in Settings afterwards,
            which is where they would have found out what they had already
            accepted. Both links are also in Settings, for the person who wants
            to reread them later.
            
            Not a checkbox: Apple's own pattern here is a statement plus links,
            and a required checkbox on a sign-in screen is a step people learn to
            tap without reading. */}
        <View style={{ alignItems: 'center', marginTop: spacing.sm }}>
          <Text variant="captionSm" centered style={{ color: cl.ink38, lineHeight: 17 }}>
            By continuing you agree to our{' '}
            <Text
              variant="captionSm"
              onPress={() => void WebBrowser.openBrowserAsync(termsUrl).catch(() => {})}
              accessibilityRole="link"
              style={{ color: cl.ink55, textDecorationLine: 'underline' }}
            >
              Terms of Service
            </Text>
            {' and '}
            <Text
              variant="captionSm"
              onPress={() => void WebBrowser.openBrowserAsync(privacyPolicyUrl).catch(() => {})}
              accessibilityRole="link"
              style={{ color: cl.ink55, textDecorationLine: 'underline' }}
            >
              Privacy Policy
            </Text>
            .
          </Text>
        </View>
      </View>
    </Screen>
  );
}
