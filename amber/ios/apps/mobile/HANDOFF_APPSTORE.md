# App Store Submission Handoff — Amber iOS

Branch: `feat/peoplerank-unifynetwork-screens` (additive; do **not** merge to `main` until reviewed).

This document covers what changed, what's verified, and the exact steps a human must
run to build and submit the app. EAS commands are **not** run here — they require
Apple/EAS credentials.

---

## 1. What shipped in this branch

Two new feature screens, both talking only to **medha-platform**
(`amberAgentBaseUrl` = `https://medha-platform-production.up.railway.app`) with the
existing bearer JWT.

### New screens (tab routes)
- **Network** — `app/(gated)/(tabs)/network.tsx` → route `/(gated)/(tabs)/network`
  - Unified network list via `GET /v1/network/identities` (paginated, infinite scroll).
  - Search via `POST /v1/network/search`.
  - "Check someone" panel: `GET /v1/network/check?email=&handle=` → in-network yes/no + relationship.
  - Loading / empty / error states.
- **Rank** — `app/(gated)/(tabs)/rank.tsx` → route `/(gated)/(tabs)/rank`
  - NLP people search via `POST /v1/peoplerank/search`.
  - Ranked cards: rank #, name, score bar + %, confidence badge, rationale, signal chips, source.
  - Loading / empty / error states.

### New API client / lib files
- `lib/platform.ts` — `callPlatform<T>()`: medha-platform fetch wrapper. Attaches
  `Authorization: Bearer <jwt>` from `loadSession()` (same token used by `lib/agent.ts`
  for `/api/ask/stream`). No tokens hardcoded. Also exports `platformErrorCopy()` for
  consistent error messaging.
- `lib/network.ts` — typed UnifyNetwork client: `searchNetwork`, `checkNetwork`,
  `listIdentities`, `listConnections`. Defensive normalizers handle both `{data:[...]}`
  and bare-array response shapes.
- `lib/peoplerank.ts` — typed PeopleRank client: `searchPeopleRank` + `normalizeScore`.

### New shared component
- `components/SearchInput.tsx` — the search-box-with-icon pattern, reused by both
  new screens (de-duplicated from the old contacts screen).

### Navigation changes
- `app/(gated)/(tabs)/_layout.tsx` — tabs are now **Network, Rank, Chat, Profile**
  (was Contacts, Chat, Profile). `initialRouteName` stays `chat`.
- **Contacts tab removed** (`app/(gated)/(tabs)/contacts.tsx` deleted). It was
  redundant with the new Network screen. The one piece of unique behavior it had —
  auto-syncing the device address book into the relationship graph — was preserved:
  the Network screen fires that background sync once on mount
  (`syncDeviceContacts()` → `readDeviceContacts()` + `syncContactsToMedhaId()`).
  Contacts permission is still requested, and `expo-contacts` config is untouched.
- Auth gating unchanged: `AuthGate` still bounces unauthenticated users to
  `/(auth)/sign-in`; all new screens live under `(gated)` so they're protected.
- No broken/placeholder screens remain. Routes are: sign-in, network, rank, chat,
  profile — all functional.

### Version bump
- `app.json`: `version` 1.0.0 → **1.0.1**, iOS `buildNumber` 35 → **36**.
  (Note: `eas.json` production has `autoIncrement: true` with
  `appVersionSource: local`, so EAS will auto-increment from this 36 baseline.)

---

## 2. How auth is reused

- The warm-OTP flow in `lib/auth.ts` saves the medha-id-issued Privy JWT via
  `saveSession(token, phone)` into Expo SecureStore (`lib/secureStorage.ts`).
- `lib/agent.ts` (existing chat) reads it with `loadSession()` and sends
  `Authorization: Bearer <token>` to medha-platform.
- The new `lib/platform.ts` does the **same**: one `loadSession()` read per call,
  same `Bearer` header, same base URL. If there's no session it returns
  `{ ok: false, error: 'no_session' }` and the screens prompt the user to sign in.
- Nothing is hardcoded; non-200s return a typed `PlatformError` rendered via
  `platformErrorCopy()`.

---

## 3. Typecheck / lint / build results

- **Typecheck: PASS.** `tsc --noEmit -p apps/mobile/tsconfig.json` → exit 0, no errors.
- **Lint: BLOCKED by a pre-existing tooling issue, not by this branch.**
  `expo lint` fails before linting any file with:
  `ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './config' is not defined by
  "exports" in node_modules/eslint/package.json`
  This is a version mismatch between the hoisted `eslint@9.39` and
  `eslint-config-expo`'s flat config. It reproduces identically on untouched
  pre-existing files (e.g. `app/_layout.tsx`), so it is **not introduced by this
  branch**. Fix is a tooling concern (pin `eslint`/`eslint-config-expo` versions or
  dedupe the workspace install); out of scope for these screens.
- **Bundling:** Not run here (no simulator/Metro in this environment). Typecheck
  validates all imports/types across the new modules. Recommend a local
  `npx expo start` smoke test before submitting.

> Install note: this workspace needs `npm install --legacy-peer-deps` (peer conflict
> between `lucide-react-native` and React 19). That's pre-existing.

---

## 4. Exact EAS commands for the human

From `apps/mobile/`:

```bash
# 1. Build the production iOS app (signs with your Apple creds via EAS)
eas build -p ios --profile production

# 2. Submit the resulting build to App Store Connect / TestFlight
eas submit -p ios --profile production --latest
```

(`--latest` submits the most recent build for the profile; omit it to pick interactively.)

---

## 5. App Store Connect config / secrets the human must provide

`eas.json` → `submit.production.ios` currently has only:

```json
{ "appleTeamId": "4DMVHH99R2" }
```

For a **non-interactive** `eas submit`, add the following (values NOT guessed here —
the human must fill them in from App Store Connect):

- **`ascAppId`** — the App Store Connect app's numeric Apple ID (App Information →
  General → "Apple ID"). Required for `eas submit` to know which app record to push to.
- **`appleId`** — the Apple account email used for submission (or use an
  App Store Connect API key instead, recommended).
- Recommended instead of `appleId`/password: an **App Store Connect API key**
  (`ascApiKeyPath` / `ascApiKeyId` / `ascApiKeyIssuerId`, or set up via
  `eas credentials`). This avoids interactive 2FA.

If those aren't set, `eas submit` will prompt interactively, which also works for a
human at a terminal — but CI/automation needs them configured.

Other prerequisites the human owns (not in-repo):
- Apple Developer Program membership active for team `4DMVHH99R2`.
- Bundle id `com.joinrytual.amber` registered + an app record created in
  App Store Connect.
- Push/EAS login: `eas login` as owner `amberrr`.
- App privacy + screenshots + metadata filled in App Store Connect before release
  (the `infoPlist` usage strings for Contacts/Camera/Photos/Calendar/Reminders are
  already set in `app.json`).

---

## 6. Backend dependency

These screens depend on **medha-platform PR #254** being deployed to
`medha-platform-production` (the `/v1/network/*` and `/v1/peoplerank/*` endpoints).
Confirm that's live before submitting, or the screens will show their error states.
