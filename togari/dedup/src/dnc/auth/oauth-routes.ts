/**
 * Social Platform OAuth Routes
 *
 * Self-serve: any user authenticated via Auth0 can connect their own
 * LinkedIn / Instagram / Twitter accounts. No admin setup, no env vars
 * per user — tokens stored in GCP Secret Manager keyed by Auth0 userId.
 *
 * Pattern (from atulmy/oauth):
 *   GET /dnc/auth/:platform          → redirect to platform OAuth
 *   GET /dnc/authorize               → single shared callback for all platforms
 *   DELETE /dnc/auth/:platform       → disconnect
 *   GET /dnc/auth/status             → which platforms are connected
 *
 * App-level credentials (set once by Karthik, never per-user):
 *   LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET
 *   META_APP_ID / META_APP_SECRET
 *   TWITTER_CLIENT_ID / TWITTER_CLIENT_SECRET
 *
 * Per-user tokens → GCP Secret Manager → looked up dynamically at sync time.
 */

import type { Application, Request, Response } from 'express';
import { randomBytes, createHash } from 'crypto';
import { validateOAuthToken } from '../../services/oauth.js';
import { saveTokens, getTokens, deleteTokens, getConnectedPlatforms } from './token-store.js';
import type { Platform } from '../types/index.js';

const BASE_URL = process.env.PUBLIC_URL ?? 'http://localhost:3000';
const CALLBACK  = `${BASE_URL}/dnc/authorize`;

// ─── PKCE + CSRF state store (in-memory, 10-min TTL) ─────────────────────────

interface OAuthState {
  userId: string;
  platform: Platform;
  verifier?: string;  // PKCE code verifier (Twitter)
  expiresAt: number;
}

const states = new Map<string, OAuthState>();

function newState(userId: string, platform: Platform, verifier?: string): string {
  const state = randomBytes(20).toString('hex');
  states.set(state, { userId, platform, verifier, expiresAt: Date.now() + 10 * 60_000 });
  return state;
}

function popState(state: string): OAuthState | null {
  const s = states.get(state);
  states.delete(state);
  if (!s || Date.now() > s.expiresAt) return null;
  return s;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of states) if (now > v.expiresAt) states.delete(k);
}, 5 * 60_000);

// ─── Platform OAuth URLs ──────────────────────────────────────────────────────

function linkedInAuthUrl(state: string): string {
  return 'https://www.linkedin.com/oauth/v2/authorization?' + new URLSearchParams({
    response_type: 'code',
    client_id:     process.env.LINKEDIN_CLIENT_ID!,
    redirect_uri:  CALLBACK,
    state,
    scope:         'openid profile email w_member_social',
    // r_network requires Partner approval — we use Voyager for connections
  });
}

function instagramAuthUrl(state: string): string {
  // Meta OAuth — covers both Instagram Basic Display and Graph API
  return 'https://www.facebook.com/v19.0/dialog/oauth?' + new URLSearchParams({
    client_id:     process.env.META_APP_ID!,
    redirect_uri:  CALLBACK,
    scope:         'instagram_basic,instagram_manage_insights,instagram_manage_followers,pages_show_list',
    response_type: 'code',
    state,
  });
}

function twitterAuthUrl(state: string, challenge: string): string {
  return 'https://twitter.com/i/oauth2/authorize?' + new URLSearchParams({
    response_type:         'code',
    client_id:             process.env.TWITTER_CLIENT_ID!,
    redirect_uri:          CALLBACK,
    scope:                 'tweet.read users.read follows.read follows.write offline.access',
    state,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  });
}

// ─── Token exchange ───────────────────────────────────────────────────────────

async function exchangeLinkedIn(code: string) {
  const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  CALLBACK,
      client_id:     process.env.LINKEDIN_CLIENT_ID!,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`LinkedIn token exchange ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

async function exchangeInstagram(code: string) {
  // Step 1: short-lived token
  const shortRes = await fetch('https://graph.facebook.com/v19.0/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.META_APP_ID!,
      client_secret: process.env.META_APP_SECRET!,
      redirect_uri:  CALLBACK,
      code,
    }),
  });
  if (!shortRes.ok) throw new Error(`Meta token exchange ${shortRes.status}: ${await shortRes.text()}`);
  const { access_token: shortToken } = await shortRes.json() as { access_token: string };

  // Step 2: exchange for long-lived token (60 days)
  const longUrl = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
  longUrl.searchParams.set('grant_type', 'fb_exchange_token');
  longUrl.searchParams.set('client_id', process.env.META_APP_ID!);
  longUrl.searchParams.set('client_secret', process.env.META_APP_SECRET!);
  longUrl.searchParams.set('fb_exchange_token', shortToken);
  const longRes = await fetch(longUrl.toString());
  const { access_token, expires_in } = await longRes.json() as { access_token: string; expires_in: number };

  // Step 3: find linked Instagram Business account ID
  const pagesRes = await fetch(
    `https://graph.facebook.com/v19.0/me/accounts?fields=instagram_business_account&access_token=${access_token}`
  );
  const pages = await pagesRes.json() as { data?: Array<{ instagram_business_account?: { id: string } }> };
  const igId = pages.data?.[0]?.instagram_business_account?.id ?? null;

  // Step 4: get IG username
  let username: string | null = null;
  if (igId) {
    const igRes = await fetch(`https://graph.facebook.com/v19.0/${igId}?fields=username&access_token=${access_token}`);
    const ig = await igRes.json() as { username?: string };
    username = ig.username ?? null;
  }

  return { access_token, expires_in, instagram_account_id: igId, username };
}

async function exchangeTwitter(code: string, verifier: string) {
  const creds = Buffer.from(`${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization:  `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  CALLBACK,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`Twitter token exchange ${res.status}: ${await res.text()}`);
  const tokens = await res.json() as { access_token: string; refresh_token: string; expires_in: number };

  // Get Twitter user info
  const me = await fetch('https://api.twitter.com/2/users/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const user = await me.json() as { data: { id: string; username: string; name: string } };

  return { ...tokens, twitter_user_id: user.data.id, twitter_username: user.data.username };
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerOAuthRoutes(app: Application): void {

  // ── Status: which platforms does this user have connected ───────────────────
  app.get('/dnc/auth/status', validateOAuthToken, async (req: Request, res: Response) => {
    const userId = res.locals.user?.sub as string;
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const connected = await getConnectedPlatforms(userId);
    const detail: Record<string, object> = {};

    await Promise.all(connected.map(async platform => {
      const t = await getTokens(userId, platform);
      if (!t) return;
      detail[platform] = {
        connected_at:        t.connected_at,
        instagram_account_id: t.instagram_account_id ?? null,
        twitter_username:    t.twitter_username ?? null,
        expires_at:          t.expires_at ? new Date(t.expires_at).toISOString() : null,
      };
    }));

    res.json({ userId, connected, detail });
  });

  // ── Initiate OAuth — redirect to platform ──────────────────────────────────
  app.get('/dnc/auth/:platform', validateOAuthToken, (req: Request, res: Response) => {
    const userId   = res.locals.user?.sub as string;
    const platform = req.params.platform as Platform;
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    try {
      let url: string;

      if (platform === 'linkedin') {
        if (!process.env.LINKEDIN_CLIENT_ID) { res.status(503).json({ error: 'LinkedIn app not configured' }); return; }
        url = linkedInAuthUrl(newState(userId, 'linkedin'));

      } else if (platform === 'instagram') {
        if (!process.env.META_APP_ID) { res.status(503).json({ error: 'Instagram app not configured' }); return; }
        url = instagramAuthUrl(newState(userId, 'instagram'));

      } else if (platform === 'twitter') {
        if (!process.env.TWITTER_CLIENT_ID) { res.status(503).json({ error: 'Twitter app not configured' }); return; }
        const verifier  = randomBytes(32).toString('base64url');
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        url = twitterAuthUrl(newState(userId, 'twitter', verifier), challenge);

      } else if (platform === 'gmail') {
        if (!process.env.GOOGLE_CLIENT_ID) { res.status(503).json({ error: 'Google app not configured' }); return; }
        url = gmailAuthUrl(newState(userId, 'gmail'));

      } else if (platform === 'github') {
        if (!process.env.GITHUB_CLIENT_ID) { res.status(503).json({ error: 'GitHub app not configured' }); return; }
        url = githubAuthUrl(newState(userId, 'github'));

      } else if (platform === 'snapchat') {
        if (!process.env.SNAPCHAT_CLIENT_ID) { res.status(503).json({ error: 'Snapchat app not configured' }); return; }
        const verifier  = randomBytes(32).toString('base64url');
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        url = snapchatAuthUrl(newState(userId, 'snapchat', verifier), challenge);

      } else if (platform === 'tiktok') {
        if (!process.env.TIKTOK_CLIENT_KEY) { res.status(503).json({ error: 'TikTok app not configured' }); return; }
        url = tiktokAuthUrl(newState(userId, 'tiktok'));

      } else {
        res.status(400).json({ error: `Unsupported platform: ${platform}` }); return;
      }

      res.redirect(url);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Single shared callback — handles all platforms via state param ──────────
  // Pattern from atulmy/oauth — one /authorize endpoint for every provider
  app.get('/dnc/authorize', async (req: Request, res: Response) => {
    const { code, state, error, error_description } = req.query as Record<string, string>;

    if (error) {
      return res.redirect(`/dnc/auth/result?success=false&error=${encodeURIComponent(error_description ?? error)}`);
    }

    const ctx = popState(state);
    if (!ctx) {
      return res.redirect('/dnc/auth/result?success=false&error=Invalid+or+expired+OAuth+state');
    }

    try {
      const now = new Date().toISOString();

      if (ctx.platform === 'linkedin') {
        const { access_token, expires_in } = await exchangeLinkedIn(code);
        await saveTokens({
          platform:     'linkedin',
          userId:       ctx.userId,
          access_token,
          expires_at:   Date.now() + expires_in * 1000,
          connected_at: now,
        });

      } else if (ctx.platform === 'instagram') {
        const { access_token, expires_in, instagram_account_id, username } = await exchangeInstagram(code);
        await saveTokens({
          platform:             'instagram',
          userId:               ctx.userId,
          access_token,
          expires_at:           Date.now() + expires_in * 1000,
          instagram_account_id: instagram_account_id ?? undefined,
          twitter_username:     username ?? undefined,
          connected_at:         now,
        });

      } else if (ctx.platform === 'twitter') {
        const { access_token, refresh_token, expires_in, twitter_user_id, twitter_username } =
          await exchangeTwitter(code, ctx.verifier!);
        await saveTokens({ platform: 'twitter', userId: ctx.userId, access_token, refresh_token,
          expires_at: Date.now() + expires_in * 1000, twitter_user_id, twitter_username, connected_at: now });

      } else if (ctx.platform === 'gmail') {
        const { access_token, refresh_token, expires_in } = await exchangeGoogle(code);
        await saveTokens({ platform: 'gmail' as any, userId: ctx.userId, access_token, refresh_token,
          expires_at: Date.now() + expires_in * 1000, connected_at: now });

      } else if (ctx.platform === 'github') {
        const { access_token, github_user_id, github_username } = await exchangeGitHub(code);
        await saveTokens({ platform: 'github' as any, userId: ctx.userId, access_token,
          twitter_user_id: github_user_id, twitter_username: github_username, connected_at: now });

      } else if (ctx.platform === 'snapchat') {
        const { access_token, refresh_token, expires_in } = await exchangeSnapchat(code, ctx.verifier!);
        await saveTokens({ platform: 'snapchat' as any, userId: ctx.userId, access_token, refresh_token,
          expires_at: Date.now() + expires_in * 1000, connected_at: now });

      } else if (ctx.platform === 'tiktok') {
        const { access_token, refresh_token, expires_in, open_id } = await exchangeTikTok(code);
        await saveTokens({ platform: 'tiktok' as any, userId: ctx.userId, access_token, refresh_token,
          expires_at: Date.now() + expires_in * 1000, twitter_user_id: open_id, connected_at: now });
      }

      res.redirect(`/dnc/auth/result?success=true&platform=${ctx.platform}`);
    } catch (err: any) {
      console.error(`[OAuth] ${ctx.platform} callback failed:`, err.message);
      res.redirect(`/dnc/auth/result?success=false&platform=${ctx.platform}&error=${encodeURIComponent(err.message)}`);
    }
  });

  // ── Disconnect a platform ──────────────────────────────────────────────────
  app.delete('/dnc/auth/:platform', validateOAuthToken, async (req: Request, res: Response) => {
    const userId   = res.locals.user?.sub as string;
    const platform = req.params.platform as Platform;
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }
    await deleteTokens(userId, platform);
    res.json({ success: true, platform, message: `${platform} disconnected` });
  });

  // ── LinkedIn: cookie fallback (Voyager — when OAuth r_network isn't approved) ─
  // User pastes li_at + JSESSIONID from DevTools; we store them securely
  app.post('/dnc/auth/linkedin/cookies', validateOAuthToken, async (req: Request, res: Response) => {
    const userId = res.locals.user?.sub as string;
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }
    const { li_at, jsessionid } = req.body as { li_at?: string; jsessionid?: string };
    if (!li_at || !jsessionid) { res.status(400).json({ error: 'li_at and jsessionid required' }); return; }
    await saveTokens({ platform: 'linkedin', userId, li_at, jsessionid, connected_at: new Date().toISOString() });
    res.json({ success: true, message: 'LinkedIn connected via cookies — sync starting' });
  });

  // ── Chrome extension: check if installed + get extension ID for web app ──────
  // Web app calls GET /dnc/auth/extension-info to know which extension ID to message
  app.get('/dnc/auth/extension-info', (_req: Request, res: Response) => {
    res.json({
      extension_id:    process.env.CHROME_EXTENSION_ID ?? null,
      extension_store: process.env.CHROME_EXTENSION_STORE_URL ?? null,
      supported:       !!process.env.CHROME_EXTENSION_ID,
    });
  });

  // ── Result page — shown after OAuth callback, posts message to opener ──────
  app.get('/dnc/auth/result', (_req: Request, res: Response) => {
    const { success, platform, error } = _req.query as Record<string, string>;
    const ok = success === 'true';
    res.send(`<!DOCTYPE html><html><head><title>${ok ? 'Connected' : 'Failed'}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f5f3}
.card{background:#fff;border-radius:14px;padding:48px 40px;text-align:center;border:0.5px solid #e5e3de;max-width:380px;width:90%}
.icon{width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:22px}
.ok{background:#eaf3de;color:#27500a}.fail{background:#fcebeb;color:#791f1f}
h2{font-size:18px;font-weight:500;margin-bottom:8px;color:#1a1a1a}
p{color:#888;font-size:14px;line-height:1.5;margin-bottom:28px}
button{background:#1a1a1a;color:#fff;border:none;padding:10px 28px;border-radius:8px;font-size:14px;cursor:pointer;font-weight:500}
button:hover{opacity:0.85}</style></head><body>
<div class="card">
  <div class="icon ${ok ? 'ok' : 'fail'}">${ok ? '✓' : '✗'}</div>
  <h2>${ok ? `${platform ?? 'Account'} connected` : 'Connection failed'}</h2>
  <p>${ok ? 'Your contacts are syncing. You can close this window.' : (error ?? 'Something went wrong. Please try again.')}</p>
  <button onclick="closeWindow()">Close</button>
</div>
<script>
function closeWindow(){
  if(window.opener){
    window.opener.postMessage({type:'dnc_platform_connected',platform:'${platform}',success:${ok}},'*');
  }
  window.close();
}
// Auto-close after 3s if opened as popup
if(window.opener) setTimeout(closeWindow, 3000);
</script></body></html>`);
  });

  console.log('[DNC] OAuth routes: /dnc/auth/:platform, /dnc/authorize, /dnc/auth/status');
}

// ─── Additional platform OAuth URLs (Gmail, GitHub, Snapchat, TikTok) ────────
// These plug directly into the existing /dnc/auth/:platform + /dnc/authorize pattern.
// Add case blocks to the initiate route and the callback handler below.

function gmailAuthUrl(state: string): string {
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID!,
    redirect_uri:  CALLBACK,
    response_type: 'code',
    scope:         'openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/contacts.readonly',
    access_type:   'offline',
    prompt:        'consent',
    state,
  });
}

function githubAuthUrl(state: string): string {
  return 'https://github.com/login/oauth/authorize?' + new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID!,
    redirect_uri: CALLBACK,
    scope:     'read:user user:email read:org',
    state,
  });
}

function snapchatAuthUrl(state: string, challenge: string): string {
  return 'https://accounts.snapchat.com/accounts/oauth2/auth?' + new URLSearchParams({
    client_id:             process.env.SNAPCHAT_CLIENT_ID!,
    redirect_uri:          CALLBACK,
    response_type:         'code',
    scope:                 'https://auth.snapchat.com/oauth2/api/user.display_name https://auth.snapchat.com/oauth2/api/user.external_id',
    state,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  });
}

function tiktokAuthUrl(state: string): string {
  return 'https://www.tiktok.com/v2/auth/authorize/?' + new URLSearchParams({
    client_key:    process.env.TIKTOK_CLIENT_KEY!,
    redirect_uri:  CALLBACK,
    response_type: 'code',
    scope:         'user.info.basic,user.info.profile,user.info.stats',
    state,
  });
}

// Token exchange helpers for new platforms
async function exchangeGoogle(code: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, grant_type: 'authorization_code',
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: CALLBACK,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange ${res.status}`);
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
}

async function exchangeGitHub(code: string) {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, redirect_uri: CALLBACK }),
  });
  if (!res.ok) throw new Error(`GitHub token exchange ${res.status}`);
  const data = await res.json() as { access_token: string; token_type: string };
  const user = await fetch('https://api.github.com/user', { headers: { Authorization: `token ${data.access_token}` } }).then(r => r.json()) as { id: number; login: string };
  return { ...data, github_user_id: String(user.id), github_username: user.login };
}

async function exchangeSnapchat(code: string, verifier: string) {
  const creds = Buffer.from(`${process.env.SNAPCHAT_CLIENT_ID}:${process.env.SNAPCHAT_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://accounts.snapchat.com/accounts/oauth2/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, grant_type: 'authorization_code', redirect_uri: CALLBACK, code_verifier: verifier }),
  });
  if (!res.ok) throw new Error(`Snapchat token exchange ${res.status}`);
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
}

async function exchangeTikTok(code: string) {
  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY!, client_secret: process.env.TIKTOK_CLIENT_SECRET!, code, grant_type: 'authorization_code', redirect_uri: CALLBACK }),
  });
  if (!res.ok) throw new Error(`TikTok token exchange ${res.status}`);
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number; open_id: string }>;
}
