import { resolveAmberIdOrigin } from './serviceUrls';
import Constants from 'expo-constants';

type Extra = {
  amberAgentBaseUrl?: string;
  amberIdBaseUrl?: string;
  togariBaseUrl?: string;
  amberCardUrl?: string;
  amberCardPhone?: string;
  amberConnectBaseUrl?: string;
  togariRestBaseUrl?: string;
  togariRestToken?: string;
  googleIosClientId?: string;
  privacyPolicyUrl?: string;
  termsUrl?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

/**
 * The app's URL scheme, read from the manifest rather than written twice.
 *
 * AuthSession builds the OAuth redirect out of this, and Google matches the
 * redirect it receives against the one registered for the client id. A literal
 * 'amber' here would work right up until the scheme changed in app.json, at
 * which point sign-in breaks with a redirect_uri_mismatch and nothing in the app
 * points at the cause.
 */
export const appScheme = Constants.expoConfig?.scheme
  ? String(Array.isArray(Constants.expoConfig.scheme)
      ? Constants.expoConfig.scheme[0]
      : Constants.expoConfig.scheme)
  : 'amber';

/**
 * The Google OAuth client id this build signs in against.
 *
 * DELIBERATELY EMPTY BY DEFAULT, and the button hides itself when it is. A
 * guessed or stale client id does not fail at build time; it fails on a real
 * person's phone with an opaque Google error page. Absent is a state the UI can
 * handle honestly. Set it in app.json `extra.googleIosClientId` (the iOS OAuth
 * client from the Google Cloud console) and set the matching
 * GOOGLE_IOS_CLIENT_ID on amber-id, or the server refuses every token by
 * design -- see lib/google-auth.js.
 *
 * A public client id is not a secret: it ships in every OAuth app. The SECRET
 * is never here, which is why sign-in uses the id_token response type rather
 * than an authorization code.
 */
export const googleIosClientId = extra.googleIosClientId ?? '';

/**
 * THE PRIVACY POLICY AND THE TERMS, which the App Store requires and the app
 * had no link to anywhere.
 *
 * NOT EMPTY BY DEFAULT, unlike googleIosClientId above, and the difference is
 * worth stating because the two look like the same kind of value. An absent
 * Google client id is a button that hides itself and an app that still works.
 * An absent privacy policy is a submission Apple rejects and, worse, a row in
 * Settings that either vanishes or opens nothing -- and neither of those can be
 * fixed without shipping another build.
 *
 * So these point at medha-id, which is deployed, serves both documents at these
 * exact paths (src/routes/legal.js), and needs no marketing site to exist. Point
 * them at a real domain by setting `extra.privacyPolicyUrl` / `extra.termsUrl`
 * in app.json whenever there is one; the App Store listing's privacy URL should
 * be whatever this says.
 */
const amberIdBaseUrl = resolveAmberIdOrigin(extra.amberIdBaseUrl);
const LEGAL_BASE = amberIdBaseUrl;
export const privacyPolicyUrl = extra.privacyPolicyUrl ?? `${LEGAL_BASE}/legal/privacy`;
export const termsUrl = extra.termsUrl ?? `${LEGAL_BASE}/legal/terms`;

// Read-only Togari REST surface (Professional tab). These are intentionally
// EMPTY by default: we do not yet have a valid Togari host + auth token wired
// into the app, so lib/togari.ts short-circuits to a "coming soon" state when
// either is blank (and on any 401). When Togari access is provisioned, set
// these (host per Karthik's repo is https://togari.bluemodernadvisory.com;
// the workspace token is an Auth0 JWT or tgi_live_* bearer) — do NOT guess a
// working host/token here.
// TODO(togari): populate togariRestBaseUrl + togariRestToken once we have
// real read-only workspace credentials.
export const togariRest = {
  baseUrl: extra.togariRestBaseUrl ?? '',
  token: extra.togariRestToken ?? '',
} as const;

// Amber ID was renamed back to amber-id-production; normalize the retired
// manifest value so installed development clients do not keep calling a 404.
// togari-bma-prod is the canonical Togari platform per togari-imessage env.
export const config = {
  medhaIdBaseUrl: amberIdBaseUrl,
  amberAgentBaseUrl: extra.amberAgentBaseUrl ?? 'https://medha-platform-production.up.railway.app',
  // togariBaseUrl is retained only for the read-only REST surface (lib/togari.ts).
  // The Togari CHAT path no longer calls this host directly from the client; it
  // goes through the medha-platform proxy (see askTogari in lib/agent.ts). The
  // shared service secret that used to live here (togariApiKey) was REMOVED for
  // security: a client-held key ships in the IPA and is visible to any network
  // proxy. SECURITY REMEDIATION: the leaked key committed to git history
  // (b8356bcc...a5ce) must be ROTATED server-side; removing it here does not
  // invalidate the value already in version control.
  togariBaseUrl: extra.togariBaseUrl ?? 'https://togari-bma-prod.up.railway.app',
  amberCardUrl: extra.amberCardUrl ?? 'https://www.sagartiwari.com',
  amberCardPhone: extra.amberCardPhone ?? '+15550100007',
  // Base for a user's public "connect with me" link. The share builds
  // `${base}/u/@${username}` per user, so it is never a hard-coded personal site.
  //
  // THIS USED TO BE `https://amber.so`, WHICH NOBODY SERVES. Every shared card read
  // "Connect with <name> on Amber — https://amber.so/@<name>" and every recipient got
  // a dead page. It now points at medha-id, which is deployed and serves
  // GET /u/:username (src/routes/connect-link.js): a real page that hands the visitor
  // straight to `amber://connect?u=<username>` and falls back to an install link if
  // the app is not there.
  //
  // Point this at a pretty domain whenever one is pointed at medha-id — the path
  // shape (`/u/@name`) is already what that host would serve, so it is a one-line
  // change here and nothing else moves.
  amberConnectBaseUrl: resolveAmberIdOrigin(extra.amberConnectBaseUrl ?? amberIdBaseUrl),
};

// Single source of truth for networking behavior so every transport call
// (lib/medhaId.ts), the React Query client (lib/queryClient.ts), and the data
// clients (lib/network.ts, lib/api.ts) tune off the same numbers instead of
// scattering magic constants. Times are in milliseconds.
export const networkConfig = {
  // Default per-request ceiling. A standard JSON call should never hang the UI
  // past this; long-running streams set their own (they are SSE, not here).
  timeoutMs: 15_000,
  // Retry policy for idempotent (GET) calls only. Writes never auto-retry from
  // the transport: a duplicate POST is a correctness bug, not a perf win.
  maxRetries: 2,
  // Exponential backoff: delay = base * 2^attempt, capped, with full jitter so
  // a flaky network does not produce a synchronized retry stampede.
  retryBaseDelayMs: 400,
  retryMaxDelayMs: 4_000,
  // HTTP statuses worth retrying. 408/425/429 are transient client-side waits;
  // 5xx (except 501) are transient server faults. 4xx like 401/403/404 are not.
  retryableStatuses: new Set([408, 425, 429, 500, 502, 503, 504]),
  // When the transport observes back-to-back network failures it flips the app
  // to "offline" and starts polling for reachability at this cadence.
  reachabilityPollMs: 4_000,
  // How many consecutive transport network errors flip the connectivity banner
  // to offline. One blip should not nag the user; a real outage should.
  offlineAfterFailures: 2,
} as const;

// expo-image disk-cache policy. Avatars are immutable per URL (a contact's
// photo URL changes when the photo changes), so "disk" is safe and means a
// re-opened card paints the face instantly from disk instead of refetching.
export const imageCachePolicy = 'disk' as const;
