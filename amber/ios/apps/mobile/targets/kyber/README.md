# Kyber, the Amber keyboard

Kyber puts Amber inside any chat as a custom keyboard. Nobody else in the thread installs anything. The globe key switches to it, and it sits where the keyboard was.

Kyber is not included in the current TestFlight build. The build owner chose to ship the base app first; a later Kyber build still needs its extension signing profile and real-device acceptance.

It can't read the conversation, because iOS doesn't let a keyboard do that. It can read what you typed or selected in the message field, and it can insert text. So the message field is both the question ("Use it" asks about your draft) and the answer (Insert).

## The four tabs

- **Ask** is the app's chat (`POST /v1/chat`), streamed. That covers people, places, the web, notes Amber captures, and follow-ups. Person chips insert a name and role, a place inserts its name, address and link, and Insert drops the whole answer in as plain text with the `[[p:id]]` markers turned into names. **Remind** sends the same text to `/v1/reminders/parse` and saves each result through `/v1/me/reminders/self`.
- **People** shows favorites and circles from `/v1/me/favorites`, `/v1/me/circles` and `/v1/me/circles/members`. A tapped person gets four actions. Share inserts their card. Ask runs "what should I know about them". Later sets a reminder for 9am tomorrow. Intro picks a second person and inserts a two-way intro. While you pick, the grid is reordered by the circle graph: people who share no circle with the first person come first and wear a link badge, because an intro between two people already in the same circle is an intro between people who probably know each other (`KyberGraph.bridges`). My link inserts your `/u/@username` connect link.
- **Plans** reads `/v1/me/agenda` for today and tomorrow and works out the gaps of 45 minutes or more between 9am and 10pm. Each gap is a chip, and **Send my free times** inserts one sentence: "I'm free today 4:15–6:30pm and after 8pm, tomorrow 9am–12pm." Tapping an event inserts "I've got X today at 3pm".
- **Split** splits a bill to the cent, with tip, and says who covers the odd cent. It's local only, so it works with Full Access off and while signed out.

## How it signs in

The keyboard is another process with its own keychain. `lib/secureStorage.ts` keeps the session keys in a shared keychain access group, `<TEAM>.com.joinrytual.amber.shared`, and the keyboard reads and writes them there using the exact layout expo-secure-store uses (service `app:no-auth`, account = UTF-8 key bytes).

Both sides refresh, and both write the rotated pair back to the shared group, with a timestamp. The app compares the shared copy's stamp with its private copy's and takes the newer one (`lib/sessionStore.ts`), so installing the default build over Kyber and back again can't bring back a token that was rotated away weeks ago. The keyboard only ever updates the shared items and never creates them, so it can't bring back a session the user just signed out of. Inside the keyboard, `KyberAPI` is an actor, so the five requests fired when it opens share one refresh. If either process loses a refresh race, it checks whether the stored token changed under it and uses the winner's session instead of signing out. They have to, because refresh tokens are single-use: if the keyboard rotated one into a private store, the app's next refresh would be a replay, and the server answers a replay by revoking every session. The shared group is read first, and the legacy app-only item is the fallback. A build without the entitlement throws on every shared call, swallows it, and behaves exactly as it did before Kyber.

Full Access is required for the network and the shared keychain. Without it, Kyber explains the Settings path and offers Split.

## Building it

Kyber is **opt-in**. Extension targets were taken out of the TestFlight build on 2026-08-17 (`e4a4c7a`), so `app.config.js` returns `app.json` untouched unless `AMBER_KYBER=1` is set. With it, the build adds this target only (not the record widget) plus the keychain group on both binaries.

```bash
cd apps/mobile
eas build --profile kyber --platform ios --auto-submit-with-profile production
AMBER_KYBER=1 npx expo prebuild -p ios         # local Xcode project with the Kyber target
```

The Kyber profile is an App Store distribution build for TestFlight. The
extension bundle identifier is derived from the containing app plus `.kyber`
(`com.joinrytual.amber.beta.kyber` for the current beta app). EAS must have an
active provisioning profile for that target as well as the app. Both targets
must be signed with entitlements that include the shared keychain group.

On the phone: Settings › General › Keyboard › Keyboards › Add New Keyboard › Kyber, then tap Kyber › Allow Full Access.

## What was verified, 2026-10-03

- `xcodebuild -target Kyber -sdk iphonesimulator` succeeds with zero warnings in these sources. The prebuilt project embeds `Kyber.appex` in the Amber target.
- `npm test` includes `scripts/kyber.test.mts`, which compiles `KyberCore.swift` with `swiftc` and runs 24 checks: marker resolution, the stream parser across chunk boundaries, token expiry, free windows, the split, the bridge ranking, and what the reminder parser actually saved. Changing one constant (`minimumMinutes` from 45 to 20) fails 3 of them.
- Every tab was rendered with sample data and looked at. That's how the rail labels truncating to "Peo…" got caught and fixed.

Not verified: a run on a real phone. That needs the `kyber` EAS build installed and Full Access switched on by hand.

The native session client must use the same host as `expo.extra.amberIdBaseUrl` in `app.json`. `scripts/keyboard-check.mts`, which runs as part of `pnpm verify`, enforces that contract so the app and keyboard cannot silently drift onto different backends.
