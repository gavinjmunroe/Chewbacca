# Amber LinkedIn: Privacy Policy

_Last updated: 2026-05-27_

Amber LinkedIn is a Chrome extension published by Blue Modern Advisory ("we"). It exists for one purpose: to let you sync your LinkedIn connections into Amber without manually copying browser cookies into our dashboard, and to let you re-sync at any time from the extension popup.

This page describes exactly what the extension reads, where it sends that data, and how to remove it.

## What the extension reads

When you click "Sync" or "Re-sync now" in the extension popup, or when the Amber dashboard at `medha-frontend-production-5f4f.up.railway.app` asks the extension to sync on your behalf, the extension reads two LinkedIn session cookies from your browser:

- `li_at`: LinkedIn's session token
- `JSESSIONID`: LinkedIn's anti-CSRF token

The extension does NOT read any other cookies, page content, browsing history, form data, or files on your computer.

## What we do with it

The extension POSTs those two cookie values, plus your Amber authentication token, to a single endpoint on the Amber backend: `https://medha-id-production.up.railway.app/v1/oauth/linkedin/cookies`. The transmission is HTTPS-encrypted.

The Amber backend uses the cookies to fetch your LinkedIn connections via LinkedIn's authenticated APIs, then stores those connections in your private Amber relationship graph. The cookies themselves are stored encrypted at rest and are only decrypted at sync time.

## What we do NOT do

- We do not share your cookies with any third party.
- We do not sell your data.
- We do not transmit your cookies to any host outside the allowlist baked into the extension's source code:
  - `https://medha-id-production.up.railway.app`
- We do not use your cookies to take any action on LinkedIn on your behalf beyond reading your connections.

## Where the data lives

| Data                                                                     | Location                                                             | Retention                                      |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------- |
| LinkedIn `li_at` and `JSESSIONID`                                        | Amber backend encrypted secret storage, scoped to your Amber user ID | Until you disconnect (then deleted within 24h) |
| Derived connection records (names, profile URLs, titles)                 | Amber's per-user relationship graph                                  | Until you delete your Amber account            |
| Local state (sign-in token, connection flag, last-sync time, last-count) | Your browser's `chrome.storage.local`                                | Until you uninstall the extension or sign out  |

## How to remove the data

- **From the extension:** uninstall it from `chrome://extensions`. This wipes the locally cached sign-in token, connection flag, and last-sync metadata.
- **From the Amber backend:** open the Amber dashboard, revoke the LinkedIn connection, or contact Amber support to delete your relationship graph.
- **From LinkedIn:** logging out of LinkedIn invalidates the cookies; the extension can no longer use them.

## Contact

Questions or data deletion requests: contact Blue Modern Advisory through the Amber dashboard at https://medha-frontend-production-5f4f.up.railway.app.
