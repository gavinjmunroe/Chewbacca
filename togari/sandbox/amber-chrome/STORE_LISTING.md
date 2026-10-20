# Chrome Web Store Listing: Amber LinkedIn

Paste-ready copy and asset checklist for https://chrome.google.com/webstore/devconsole.

---

## Store listing fields

### Item name (max 75 chars)

```
Amber LinkedIn
```

### Summary / short description (max 132 chars)

```
One-click LinkedIn sync for Amber. Re-import your connections any time, no DevTools, no copy-paste, no cookie pasting.
```

### Detailed description (max 16000 chars; supports Markdown via line breaks only)

```
Amber LinkedIn plugs your LinkedIn account into Amber, the relationship intelligence layer built by Blue Modern Advisory.

WHAT IT DOES

Amber LinkedIn captures the LinkedIn session your browser already has and securely forwards it to your Amber account. Amber then keeps your LinkedIn connections in sync with the rest of your relationship graph. No scraping endpoints, no third-party data brokers, no manual exports.

ONE CLICK, ANY TIME

  1. Install the extension.
  2. Open Amber and sign in. The extension picks up your account automatically.
  3. Click the extension icon any time you want to refresh: every click re-uploads the freshest cookies and Amber re-fetches your latest connections.
  4. The popup shows when you last synced and how many connections you brought in.

PRIVACY FIRST

  Reads only two LinkedIn session cookies: li_at and JSESSIONID.
  Sends them exclusively to a hard-coded allowlist of Amber backends.
  Refuses to transmit cookies to any other origin, even if asked.
  Stores nothing locally except your sign-in token, a "connected" flag, the last sync timestamp, and the last sync count.

WHO THIS IS FOR

Anyone using Amber who wants their LinkedIn graph kept in sync without ever opening DevTools, without ever copying a cookie, and without giving credentials to a third party.

ABOUT AMBER

Amber is a relationship intelligence layer built by Blue Modern Advisory. It unifies LinkedIn, Apple Contacts, Instagram, Twitter, Gmail, GitHub, TikTok, and Snapchat into a single per-user relationship source of truth.

OPEN SECURITY MODEL

The extension's full source, including the allowlist of trusted backends, is published at github.com/amber-organization/amber-chrome. Auditing is encouraged.

SUPPORT

Questions, bugs, or data deletion requests: open the Amber dashboard and contact us, or reach Blue Modern Advisory directly.
```

### Category

```
Productivity
```

### Language

```
English (United States)
```

### Audience

```
Everyone
```

### Visibility

```
Public  (or Unlisted while smoke-testing with internal users)
```

---

## Permission justifications (required by Chrome Web Store)

The store will ask "why does your extension need each permission." Paste these into the corresponding fields:

### `cookies` permission

```
Required to read the user's existing LinkedIn session cookies (li_at and JSESSIONID) so we can forward them to the user's own Amber account. Without this permission the extension cannot sync LinkedIn for the user, which is the extension's single purpose.
```

### `storage` permission

```
Required to remember the user's sign-in token, connection state, last-sync timestamp, and last-sync count so the popup can show accurate status on subsequent opens without re-prompting.
```

### Host permission for `https://www.linkedin.com/*` and `https://linkedin.com/*`

```
Required so the cookies API can read LinkedIn session cookies. The extension does not inject any content scripts or read any page content from linkedin.com; it only reads cookies via chrome.cookies.get. This is the same approach used by Sales Navigator extensions, PhantomBuster, SalesMind AI, and other established LinkedIn workflow tools.
```

### Remote code

```
None. The extension ships with all its JavaScript bundled. It does not load remote scripts at runtime, does not call eval, and does not pull JS from a CDN.
```

### Single purpose

```
Sync a user's LinkedIn connections into their own Amber account by securely forwarding their existing browser session cookies to a hard-coded allowlist of Amber backends.
```

---

## Data use disclosures (required panel)

| Question                                          | Answer                                                                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Does your extension collect or use any user data? | Yes                                                                                                                  |
| Authentication information (cookies, tokens)      | Yes: LinkedIn `li_at` and `JSESSIONID` cookies, plus the user's Amber auth token                                     |
| Personally identifiable info                      | No (the cookies themselves are session tokens, not PII; downstream Amber handling is covered by Amber's main policy) |
| Financial info                                    | No                                                                                                                   |
| Health info                                       | No                                                                                                                   |
| Location                                          | No                                                                                                                   |
| Web history                                       | No                                                                                                                   |
| User activity                                     | No                                                                                                                   |
| Website content                                   | No                                                                                                                   |

Three required certifications (check all three):

- I do not sell or transfer user data to third parties outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

---

## Privacy policy URL

Recommended: enable GitHub Pages on the `amber-organization/amber-chrome` repo and point it at the `docs/` folder. The file `docs/privacy.html` is ready to publish as-is. Resulting URL:

```
https://amber-organization.github.io/amber-chrome/privacy.html
```

Paste that URL into the "Privacy policy" field on the store listing. Alternatives:

1. Serve the same HTML from the main Amber site at `https://amber.bluemodernadvisory.com/privacy/extension`.
2. Add a public `/extension/privacy` route to medha-frontend.

Whatever URL is chosen, it must be publicly resolvable HTTPS. The Web Store rejects local file paths and unreachable URLs.

---

## Required asset checklist

| Asset              | Required size  | Status                        | Notes                                                              |
| ------------------ | -------------- | ----------------------------- | ------------------------------------------------------------------ |
| Item icon          | 128 x 128 PNG  | Present (`icons/icon128.png`) |                                                                    |
| Small promo tile   | 440 x 280 PNG  | TO DO                         | Shown in Web Store category pages                                  |
| Marquee promo tile | 1400 x 560 PNG | Optional                      | Shown only in featured slots                                       |
| Screenshot 1       | 1280 x 800 PNG | TO DO                         | The popup in "Synced just now, N connections" state                |
| Screenshot 2       | 1280 x 800 PNG | TO DO                         | The Amber dashboard /connect page with LinkedIn shown as connected |
| Screenshot 3       | 1280 x 800 PNG | Optional                      | A LinkedIn page with the Amber icon visible in the toolbar         |

At least one screenshot is required; three is optimal. Capture at 100% zoom on a 1280 x 800 viewport. The store auto-letterboxes if the aspect ratio is off.

---

## Pre-submission checklist

- [ ] `manifest.json` version bumped if shipping a patch
- [ ] No `console.log` in production `background.js` / `popup.js` (none expected)
- [ ] `host_permissions` only covers linkedin.com (already minimal)
- [ ] `externally_connectable.matches` includes the actual production Amber URLs (no wildcards, no localhost)
- [ ] `TRUSTED_BACKENDS` in `background.js` matches `externally_connectable.matches` exactly
- [ ] Privacy policy hosted at a public HTTPS URL
- [ ] At least 3 screenshots at 1280 x 800
- [ ] 440 x 280 promo tile uploaded
- [ ] `Productivity` category selected
- [ ] Data use disclosures filled (panel above)
- [ ] Permission justifications pasted (above)
- [ ] Single-purpose statement pasted (above)
- [x] Backend endpoint `POST /v1/oauth/linkedin/cookies` is live on medha-id (shipped 2026-05-27 in medha-id@f77bbc5; see BACKEND_INTEGRATION.md)

---

## Submission steps

1. Run the build script from the repo root:

   ```bash
   ./build.sh
   ```

   Produces `amber-linkedin-<version>.zip` ready to upload. The script excludes `tests/`, `docs/`, `STORE_LISTING.md`, `PRIVACY.md`, `BACKEND_INTEGRATION.md`, and `README.md` (privacy policy is hosted externally; everything else is repo-only).

2. Go to https://chrome.google.com/webstore/devconsole.

3. Create a new item, upload the zip, fill every field using the copy above.

4. Submit for review. Standard review takes 1 to 3 business days. First-time submissions sometimes take longer.

5. After approval, copy the published extension ID into Railway env as `AMBER_LINKEDIN_EXTENSION_ID`, and the Web Store listing URL as `AMBER_LINKEDIN_STORE_URL`. The Amber dashboard uses these to render the "Install extension" prompt.

---

## After publication

| Trigger                     | Action                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bug report                  | Patch in `background.js` / `popup.js`, bump `version` in `manifest.json`, re-run `build.sh`, re-upload. Re-review typically under 24h for unchanged-permission updates.        |
| New trusted Amber subdomain | Update BOTH `externally_connectable.matches` (manifest) AND `TRUSTED_BACKENDS` (background.js). Both lists must be updated together; one without the other is a security hole. |
| Permission change           | Triggers a fresh full review. Plan 3 to 7 days.                                                                                                                                |
| Removed permission          | Auto-removes from existing installs on next browser restart.                                                                                                                   |
