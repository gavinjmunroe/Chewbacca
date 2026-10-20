# amber-chrome

The Chrome extension behind **Amber LinkedIn**. Lets any Amber user re-sync their LinkedIn connections into Amber with one click, without ever touching DevTools or copy-pasting a cookie.

## Status

- v1.0.0 published as **Amber LinkedIn** on the Chrome Web Store
- Talks to: `medha-frontend-production-5f4f.up.railway.app` (frontend) and `medha-id-production.up.railway.app` (backend)
- Backend endpoint contract: see [BACKEND_INTEGRATION.md](BACKEND_INTEGRATION.md). The endpoint `POST /v1/oauth/linkedin/cookies` must exist on the backend for the extension to be useful.

The extension is platform-scoped to LinkedIn for now; the brand "Amber LinkedIn" leaves room for future sister extensions (Amber Apple Contacts, Amber Twitter, etc.) under the same Amber umbrella.

---

## How the user experiences it

1. User installs **Amber LinkedIn** from the Chrome Web Store.
2. User opens the Amber dashboard at `medha-frontend-production-5f4f.up.railway.app` and signs in. The frontend pushes their `amber-jwt` to the extension via `chrome.runtime.sendMessage` (`set_auth_token`). One-time.
3. User logs into LinkedIn in Chrome (as they normally would).
4. From then on, **every time** the user clicks the extension icon, they see a single "Re-sync now" button. One click re-uploads the freshest LinkedIn cookies, the backend re-fetches the user's current connections, and the popup shows the count + a relative timestamp ("Synced 12 min ago, 2,481 connections").

The user never sees a cookie, never opens DevTools, never copies anything.

## Architecture

```
Amber frontend (medha-frontend-production-5f4f.up.railway.app)
  |
  | chrome.runtime.sendMessage(EXTENSION_ID, { action: 'sync_linkedin', authToken })
  v
background.js (service worker)
  |  isTrustedBackend(backendUrl) guard
  |  chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'li_at' })
  |  chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'JSESSIONID' })
  v
fetch POST https://medha-id-production.up.railway.app/v1/oauth/linkedin/cookies
  Authorization: Bearer <amber-jwt>
  Body: { li_at, jsessionid }
```

## Local development

```bash
# 1. Load unpacked extension in Chrome
#    chrome://extensions -> Developer mode -> Load unpacked -> select this folder

# 2. Note the Extension ID Chrome assigns (looks like: abcdefghijklmnopqrstuvwxyz123456)

# 3. Set it in Railway env on medha-frontend (the page that calls
#    chrome.runtime.sendMessage needs to know the extension ID):
#    AMBER_LINKEDIN_EXTENSION_ID=abcdefghijklmnopqrstuvwxyz123456

# 4. If you need localhost in externally_connectable for dev, do it on a branch.
#    The Web Store build deliberately ships without localhost entries.
```

## Publishing to the Chrome Web Store

```bash
./build.sh
```

Produces `amber-linkedin-<version>.zip`. The build script:

- validates manifest.json syntactically
- cross-checks `externally_connectable.matches` against `TRUSTED_BACKENDS` so the two security allowlists can't drift
- excludes `tests/`, `*.md`, `.DS_Store`, the `docs/` folder, and `build.sh` itself
- refuses to ship if any dev file leaks into the zip

Submission flow:

1. Host `PRIVACY.md` at a public URL (GitHub Pages reads `docs/privacy.html` straight from this repo; enable Pages in repo settings).
2. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
3. Upload `amber-linkedin-<version>.zip`.
4. Fill every field from [STORE_LISTING.md](STORE_LISTING.md) (paste-ready copy).
5. Submit for review (1 to 3 business days typical).
6. After approval, set `AMBER_LINKEDIN_EXTENSION_ID` and `AMBER_LINKEDIN_STORE_URL` in Railway env on medha-frontend (and medha-id if you want telemetry).

## Permissions used

- `cookies`: read LinkedIn session cookies (`li_at`, `JSESSIONID`)
- `storage`: cache connection state, last-sync time, and the user's amber-jwt locally
- `host_permissions: https://www.linkedin.com/*`: required for `chrome.cookies.get` against linkedin.com

## env vars on medha-frontend

```
AMBER_LINKEDIN_EXTENSION_ID=         # set after publishing to Chrome Web Store
AMBER_LINKEDIN_STORE_URL=            # Web Store listing URL shown in the UI
```

## Security model

The extension reads LinkedIn session cookies and forwards them to a backend over HTTPS. Two layers protect that flow.

**1. `externally_connectable` allowlist (manifest.json).** Only these origins can call `chrome.runtime.sendMessage` into the extension:

- `https://medha-frontend-production-5f4f.up.railway.app/*`
- `https://medha-id-production.up.railway.app/*`

Wildcards like `*.railway.app` or `http://localhost:*` are NOT used. A wildcard would let any Railway-hosted page or any local process trigger cookie exfiltration to a URL of its choosing.

**2. `TRUSTED_BACKENDS` allowlist (background.js).** Even after a caller passes the `externally_connectable` gate, the extension validates the `backendUrl` it is asked to POST cookies to. If the URL's origin is not in `TRUSTED_BACKENDS`, the request is refused with `error: "untrusted_backend"` and the cookies never leave the browser. The check is on `protocol + host`, not substring, so spoofs like `https://evil.medha-id-production.up.railway.app.attacker.com` are rejected.

When publishing to a new origin (custom domain, partner deployment), both lists must be updated together. Updating only `externally_connectable` without `TRUSTED_BACKENDS` will leave callers accepted at the message gate but rejected at the cookie-send step.

## Tests

```
node tests/background.test.js
```

48 unit tests covering the sync flow, allowlist enforcement, message handlers, badge state, and storage shape. No browser, no Chrome, no network: pure Node with mocked `chrome.*` APIs.
