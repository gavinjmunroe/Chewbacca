/**
 * SIGN IN WITH APPLE AND SIGN IN WITH GOOGLE, from the phone.
 *
 * THE SERVER DECIDED THE SHAPE AND IT IS NOT NEGOTIABLE HERE. routes/social-auth.js
 * runs a two-step reconciliation, and the reason is worth carrying in the client
 * too, because the temptation to skip step two is constant:
 *
 *   step 1  POST /v1/auth/{provider}   with the provider's id token
 *           known identity   -> a session, done
 *           unknown identity -> { needsPhone: true, ticket }
 *   step 2  POST /v1/auth/{provider}/link  { ticket, phone, code }
 *
 * A verified Apple or Google token proves the person holds that provider
 * account. It proves NOTHING about which Amber account is theirs, and neither
 * provider tells us a phone number. A phone OTP is the root of identity in this
 * service -- an identity never creates a user, it attaches to one the phone
 * already established -- so a social login cannot be a way in that never touched
 * a phone. That is what makes adding providers safe: three buttons, one door.
 *
 * NO NEW NATIVE MODULES, which is why Google goes through expo-auth-session
 * rather than @react-native-google-signin. The app is managed Expo with no
 * ios/ directory; a native module would force a prebuild for a sign-in button.
 * AuthSession opens the system browser, gets an id_token back, and the server
 * verifies it exactly the same way.
 *
 * THE NONCE IS NOT DECORATION. Both providers echo it into the token and the
 * server checks it, so a token captured from another session is refused. Apple
 * wants the SHA-256 of the raw value; Google takes the raw value. lib/oidc-verify
 * accepts either form, but sending the right one keeps this honest rather than
 * relying on that tolerance.
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { callMedhaId } from './medhaId';
import { appScheme, googleIosClientId } from './config';
import { markUnlockedThisLaunch } from './auth';
import { saveSession } from './secureStorage';
import { GENERIC_SIGNIN_ERROR as GENERIC, isCancellation, linkFailure } from './socialAuthCopy';

export { isCancellation, linkFailure } from './socialAuthCopy';

export type SocialProvider = 'apple' | 'google';

/**
 * WHAT A SIGN-IN ATTEMPT CAN COME BACK AS. Four outcomes, and `cancelled` is a
 * first-class one rather than an error: tapping the button and changing your
 * mind is the single most common thing that happens, and showing "sign-in
 * failed" for it is the app calling the user's own decision a bug.
 */
export type SocialResult =
  | { kind: 'signedIn' }
  | { kind: 'needsPhone'; provider: SocialProvider; ticket: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };


/** A fresh random nonce, and the digest Apple wants alongside it. */
async function makeNonce(): Promise<{ raw: string; sha256: string }> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  const raw = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const sha256 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
  return { raw, sha256 };
}

/**
 * Hand a verified provider token to the server and act on what comes back.
 *
 * Shared by both providers because the server treats them identically past this
 * point, and a second copy is a second place for the session-saving half to be
 * subtly wrong.
 */
type ExchangeBody = {
  token?: string;
  refreshToken?: string;
  needsPhone?: boolean;
  ticket?: string;
  phone?: string;
};

/**
 * Turn the server's answer into an outcome, and save the session if there is one.
 *
 * TAKES THE RESULT, NOT THE PATH. The obvious shape is one function that builds
 * the request from `provider`, and lib/apiContract.test.mts refuses it: the gate
 * reads these files statically, cannot evaluate a ternary OR follow an
 * identifier, and a route it cannot see is a route it cannot check. It caught a
 * hoisted `const PATH` in lib/imessageLink.ts the same way. So the two callers
 * each write their own literal path and hand the response here, which keeps the
 * one part worth sharing -- what happens to the session -- in one place.
 */
async function handleExchange(
  provider: SocialProvider,
  res: { ok: boolean; data?: ExchangeBody },
): Promise<SocialResult> {
  if (!res.ok) return { kind: 'error', message: GENERIC };

  if (res.data?.needsPhone && res.data.ticket) {
    return { kind: 'needsPhone', provider, ticket: res.data.ticket };
  }

  if (res.data?.token) {
    /**
     * THE PHONE COMES BACK FROM THE SERVER on this path, and it has to.
     *
     * The OTP flow knows the number because the user typed it a moment ago. A
     * returning Apple or Google sign-in never sees one, and saveSession stores
     * whatever it is given as the account's phone -- so a placeholder here
     * would show a fake number on the profile screen from then on. The server
     * returns the account's own phone (see routes/social-auth.js) and an empty
     * string, rather than a lie, is what a missing one degrades to.
     */
    await saveSession(res.data.token, res.data.phone ?? '', res.data.refreshToken);
    markUnlockedThisLaunch();
    return { kind: 'signedIn' };
  }

  return { kind: 'error', message: GENERIC };
}

/**
 * Sign in with Apple.
 *
 * iOS ONLY, and the check is `isAvailableAsync` rather than `Platform.OS`
 * because the button must also stay hidden on an iPad running an older iOS and
 * on the simulator images where it is absent. Apple's own guidelines require
 * the button be offered only where it works.
 */
export async function isAppleAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  return AppleAuthentication.isAvailableAsync().catch(() => false);
}

export async function signInWithApple(): Promise<SocialResult> {
  try {
    const nonce = await makeNonce();
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      // Apple hashes what it echoes, so the DIGEST goes out and the RAW value
      // goes to our server separately. Sending the raw value here would make
      // every token fail the nonce check.
      nonce: nonce.sha256,
    });
    if (!credential.identityToken) return { kind: 'error', message: GENERIC };
    const res = await callMedhaId<ExchangeBody>({
      path: '/v1/auth/apple',
      method: 'POST',
      body: { identityToken: credential.identityToken, rawNonce: nonce.raw },
      unauthenticated: true,
    });
    return await handleExchange('apple', res);
  } catch (err) {
    // ERR_REQUEST_CANCELED is the user tapping Cancel. It is not a failure and
    // must not be shown as one.
    if (isCancellation(err)) return { kind: 'cancelled' };
    return { kind: 'error', message: GENERIC };
  }
}

/** The Google client id this build authenticates against. */
export function googleClientId(): string | null {
  const id = googleIosClientId;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

/**
 * Sign in with Google.
 *
 * RESPONSE TYPE IdToken, NOT CODE. The server verifies a signed id token and
 * holds no Google client secret; an authorization code would need one, and
 * putting a client secret in a phone app is putting it on the internet.
 *
 * The scopes are openid/profile/email and nothing else. Amber's calendar and
 * contacts access is a SEPARATE, later, explicit grant (routes/oauth-google.js),
 * and bundling it into the sign-in button would mean asking for someone's whole
 * calendar before they have an account.
 */
export async function signInWithGoogle(): Promise<SocialResult> {
  const clientId = googleClientId();
  if (!clientId) {
    return { kind: 'error', message: 'Google sign-in is not set up in this build yet.' };
  }
  try {
    const nonce = await makeNonce();
    const redirectUri = AuthSession.makeRedirectUri({ scheme: appScheme });
    const discovery = await AuthSession.fetchDiscoveryAsync('https://accounts.google.com');
    const request = new AuthSession.AuthRequest({
      clientId,
      redirectUri,
      scopes: ['openid', 'profile', 'email'],
      responseType: AuthSession.ResponseType.IdToken,
      // Google echoes the raw value, unlike Apple.
      extraParams: { nonce: nonce.raw },
    });
    const result = await request.promptAsync(discovery);

    if (result.type === 'cancel' || result.type === 'dismiss') return { kind: 'cancelled' };
    if (result.type !== 'success') return { kind: 'error', message: GENERIC };

    const idToken = result.params?.id_token;
    if (!idToken) return { kind: 'error', message: GENERIC };
    const res = await callMedhaId<ExchangeBody>({
      path: '/v1/auth/google',
      method: 'POST',
      body: { idToken, rawNonce: nonce.raw },
      unauthenticated: true,
    });
    return await handleExchange('google', res);
  } catch (err) {
    if (isCancellation(err)) return { kind: 'cancelled' };
    return { kind: 'error', message: GENERIC };
  }
}

/**
 * Step two: attach the provider identity to a phone-verified account.
 *
 * The ticket is the only thing carrying WHICH provider identity this is. It is
 * server-signed and provider-bound, so the client cannot name a subject and
 * cannot redeem an Apple ticket as a Google one -- see lib/apple-ticket.js.
 */
type LinkBody = { token?: string; refreshToken?: string; phone?: string };

export type LinkResult =
  | { ok: true }
  | { ok: false; message: string; expired?: boolean };

export async function linkSocialWithPhone(
  provider: SocialProvider,
  ticket: string,
  phone: string,
  code: string,
): Promise<LinkResult> {
  // Two literal calls for the same reason as handleExchange above: the contract
  // gate cannot read a ternary or follow an identifier, so a computed path is a
  // route nothing checks.
  const body = { ticket, phone, code };
  const res =
    provider === 'apple'
      ? await callMedhaId<LinkBody>({
          path: '/v1/auth/apple/link',
          method: 'POST',
          body,
          unauthenticated: true,
        })
      : await callMedhaId<LinkBody>({
          path: '/v1/auth/google/link',
          method: 'POST',
          body,
          unauthenticated: true,
        });

  if (!res.ok) return linkFailure(String((res as { error?: unknown }).error ?? ''));

  if (!res.data?.token) return { ok: false, message: GENERIC };
  // The server normalizes to E.164; store ITS answer, not the typed string,
  // or the same account reads as two different numbers across sign-in methods.
  await saveSession(res.data.token, res.data.phone ?? phone, res.data.refreshToken);
  markUnlockedThisLaunch();
  return { ok: true };
}
