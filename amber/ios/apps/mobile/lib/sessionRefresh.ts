import { config } from './config';
import { loadSession, loadRefreshToken, saveSession } from './secureStorage';

// Silent session refresh — the piece that makes a short-lived access token
// invisible to the user.
//
// medha-id now issues a 15-minute ACCESS token plus a 60-day sliding, single-use
// REFRESH token. The user stays signed in until they sign out; this module is
// what keeps that true, by swapping an expiring access token for a fresh one in
// the background.
//
// WHY THIS IS ITS OWN MODULE AND NOT PART OF auth.ts
// medhaId.ts is the transport and must be able to refresh before it attaches a
// bearer. auth.ts already imports medhaId.ts, so if the refresh lived there,
// medhaId -> auth -> medhaId would be an import cycle. This module depends only
// on config + secureStorage, so both sides can use it. It also deliberately
// uses raw fetch rather than callMedhaId: going through the transport to fix the
// transport's credentials is a recursion waiting to happen.
//
// WHY SINGLE-FLIGHT IS MANDATORY, NOT AN OPTIMISATION
// Refresh tokens are single-use and rotate on every exchange, and the server
// treats an already-rotated token presented later as a REPLAY and revokes the
// whole session family. On a cold start, five screens fire requests at once. If
// each one refreshed independently, four of them would present a token that a
// sibling had already rotated away — and the user would be signed out of every
// device by their own app. The `inflight` promise below collapses all of them
// onto one exchange. Do not remove it.
//
// (The server also allows a 60-second replay grace to cover a genuinely lost
// response, so a crash mid-refresh is survivable. That is a safety net for the
// network, not a license to fire concurrent refreshes.)

export type Session = { token: string; phone: string };

// A 60s skew so a token that is about to expire is refreshed BEFORE it is
// attached to a request, instead of 401-ing mid-flight. Mirrors
// auth.ts EXPIRY_SKEW_SECONDS.
const EXPIRY_SKEW_SECONDS = 60;

function base64UrlDecode(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const str = b64 + pad;
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (const ch of str) {
    if (ch === '=') break;
    const idx = chars.indexOf(ch);
    if (idx === -1) continue;
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}

function decodeExp(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(base64UrlDecode(parts[1]!)) as { exp?: unknown };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * True when the token is expired or close enough that it should be swapped
 * before use. Fails OPEN (returns false) for a token we cannot parse, so a
 * format we don't recognize is still attempted rather than discarded.
 */
export function isAccessTokenExpired(token: string): boolean {
  const exp = decodeExp(token);
  if (exp === null) return false;
  return exp <= Math.floor(Date.now() / 1000) + EXPIRY_SKEW_SECONDS;
}

let inflight: Promise<Session | null> | null = null;

/**
 * Exchange the stored refresh token for a new access token. Concurrent callers
 * share one exchange. Returns null when there is nothing to refresh with, or
 * when the server rejected the refresh token (session genuinely over).
 *
 * Never throws.
 */
export function refreshSession(): Promise<Session | null> {
  if (inflight) return inflight;
  inflight = doRefresh().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doRefresh(): Promise<Session | null> {
  const [current, refreshToken] = await Promise.all([loadSession(), loadRefreshToken()]);
  // No refresh token means either a legacy 30-day session (which needs no
  // refresh and stays valid until it expires) or no session at all. Either way
  // there is nothing to do here.
  if (!refreshToken) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${config.medhaIdBaseUrl}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ refreshToken }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // 401 here is terminal: the refresh token was expired, already revoked, or
      // replayed. We deliberately do NOT clear the session from inside the
      // transport — AuthGate owns routing to sign-in, and wiping storage from a
      // background refresh would yank the user out of the app mid-tap. Returning
      // null lets getValidSession() make that call.
      //
      // ONE EXCEPTION. Kyber, the keyboard, refreshes this same session from
      // another process. If it rotated the token between our read and our
      // request, the server rejects ours, and calling that terminal signs the
      // user out over a race. A stored refresh token that changed since we read
      // it means the other side won, and its fresh access token is stored.
      const [after, now] = await Promise.all([loadSession(), loadRefreshToken()]);
      if (now && now !== refreshToken && after?.token && !isAccessTokenExpired(after.token)) {
        return after;
      }
      return null;
    }

    const body = (await res.json()) as {
      token?: string;
      refreshToken?: string;
      phone?: string;
    };
    if (!body?.token) return null;

    const phone = body.phone ?? current?.phone ?? '';
    await saveSession(body.token, phone, body.refreshToken ?? refreshToken);
    return { token: body.token, phone };
  } catch {
    // Network failure, timeout, malformed JSON: leave the stored session alone
    // and let the caller retry later. A refresh failing offline must not look
    // like a revoked session.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The transport's entry point: return a usable access token, refreshing first if
 * the stored one is expired or nearly so. Returns null when there is no session.
 */
export async function getFreshAccessToken(): Promise<string | null> {
  const session = await loadSession();
  if (!session?.token) return null;
  if (!isAccessTokenExpired(session.token)) return session.token;
  const refreshed = await refreshSession();
  // Fall back to the stored token if the refresh failed: it may still be
  // accepted (skew is conservative), and a 401 is a better outcome than
  // sending no credential at all.
  return refreshed?.token ?? session.token;
}
