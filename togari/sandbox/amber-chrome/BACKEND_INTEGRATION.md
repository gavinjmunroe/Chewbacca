# Backend Integration: `POST /v1/oauth/linkedin/cookies`

The Amber LinkedIn Chrome extension POSTs LinkedIn session cookies to one endpoint on `medha-id-production.up.railway.app`. The endpoint shipped in `amber-organization/medha-id@f77bbc5` on 2026-05-27 (PR #113, Voyager probe + Firestore sync-job enqueue).

> **Service mapping (easy to confuse):** `medha-id-production.up.railway.app` is the identity backend (OAuth, secrets bag, this endpoint). `medha-platform-production.up.railway.app` is the iMessage agent service, NOT medha-id. Cookies must go to medha-id.

This document is the contract.

## Endpoint

```
POST /v1/oauth/linkedin/cookies
```

## Request

```
Authorization: Bearer <amber-jwt>
Content-Type: application/json

{
  "li_at": "AQEDARm...",      // LinkedIn session token from browser cookie
  "jsessionid": "ajax:1234..." // LinkedIn anti-CSRF token from browser cookie
}
```

- `amber-jwt` is the same HS256 token issued by `src/lib/amber-jwt.js`. Verify with `requireAuth` from `src/lib/privy.js` (the same gate the rest of `/v1/oauth/linkedin/*` uses).
- `li_at` and `jsessionid` are opaque strings. Treat them as secrets.

## Response (success)

```
200 OK
{
  "ok": true,
  "connections_synced": 2481   // optional; if present, the extension UI will show it
}
```

`connections_synced` is optional. The extension renders gracefully without it (just shows "Synced just now"). Include it when you can; users love seeing the number.

## Response (failure)

The extension surfaces `res.status` and the response body verbatim to the user. So:

- `401 { error: "unauthorized" }` if the amber-jwt is bad or missing
- `400 { error: "missing_cookies" }` if `li_at` is absent
- `502 { error: "linkedin_rejected" }` if LinkedIn returns 401 / 999 when the backend re-uses the cookies (most common cause: cookie expired client-side; user needs to re-log into LinkedIn)
- `500 { error: "internal" }` for everything else

## What the backend should do with the cookies

1. **Validate** the amber-jwt and extract the DID (`sub: "did:amber:<uuid>"`).
2. **Persist** the cookies in the per-tenant secrets bag at `secrets/{did}.keys`:
   - `LINKEDIN_COOKIE_LI_AT`
   - `LINKEDIN_COOKIE_JSESSIONID`
   - `LINKEDIN_COOKIE_UPDATED_AT` (ISO timestamp)
   - `LINKEDIN_OAUTH_REFRESH` (presence key from `routes/connections.js` PLATFORMS catalog; set so the /connect page shows LinkedIn as connected. Pick whatever value the cookie-mode equivalent of "we have working auth" is; the `routes/connections.js` PLATFORMS row may need a `cookieKey` addition to handle cookie-based vs. OAuth-based "connected" state cleanly.)
3. **Trigger a sync** (sync or async, your call). The sync uses the cookies to call LinkedIn's authenticated endpoints (Voyager API or equivalent) and writes the resulting connection records into the user's relationship graph.
4. **Return** `connections_synced` if the sync is synchronous, omit it if async.

## Why cookies and not OAuth

`src/routes/oauth-linkedin.js` already does the full OAuth dance and that's the right path for whatever LinkedIn's official API surfaces. But LinkedIn's official APIs do NOT expose the user's first-degree connections list. The only way to get that data is to authenticate as the user (cookie session) and call the same internal endpoints the LinkedIn web app uses. Hence: cookie path, layered on top of OAuth.

The two flows live side by side. OAuth handles whatever LinkedIn officially permits; the cookie path handles connections. Both write to the same secrets bag; both surface as "LinkedIn connected" on the `/connect` page.

## Security notes

- **Sender allowlist (Chrome side):** `manifest.json` `externally_connectable.matches` restricts which web origins can drive the extension. Only `medha-frontend-production-5f4f.up.railway.app` and `medha-id-production.up.railway.app` can call `chrome.runtime.sendMessage`.
- **Backend allowlist (Chrome side):** `background.js` `TRUSTED_BACKENDS` enforces that cookies only go to `medha-id-production.up.railway.app`. If you add a new origin (custom domain, partner deploy), update **both** lists in the same PR.
- **Replay window:** the cookies stay valid until the user logs out of LinkedIn or the cookie naturally expires (LinkedIn's `li_at` lifetime is ~1 year). Re-syncs refresh the stored copy with whatever is in the browser at the time, so a logged-out user can effectively rotate by logging in fresh.
- **Auth token storage in the extension:** `chrome.storage.local` is sandboxed per extension; other extensions and websites cannot read it. The amber-jwt is stored there so the popup can act without re-prompting. Cleared on uninstall and on `clear_auth_token` from a trusted sender.

## When this endpoint ships, the extension just works

No extension update needed. The version 1.0.0 build already calls this path; it just gets 404s until the backend implements it. Once the endpoint is live, every existing installed extension starts working on its next sync click.
