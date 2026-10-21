# Amber iOS

SwiftUI app for the Amber network intelligence product. Connects through
`amber-agent` (Railway) which federates `amber-id` (Pinecone + PeopleRank +
Solana cNFT), Composio (integrations), Exa (people discovery), and Privy
(identity).

## Instant todo

These items cannot be done from this repo. Every one is in
[APP_STORE_CHECKLIST.md](./APP_STORE_CHECKLIST.md) with more detail. Work top
down.

1. **App icon** source art at 1024x1024 in light, dark, and tinted. Drop the
   PNGs into `AmberApp/Assets.xcassets/AppIcon.appiconset/`.
2. **Launch mark** at 1x/2x/3x. Drop into
   `AmberApp/Assets.xcassets/LaunchMark.imageset/`.
3. **Privy iOS SwiftPM** dependency. Add
   `https://github.com/privy-io/privy-swift-sdk` to the project and delete
   the stub bodies in `Services/Live/PrivySDKAdapter.swift`.
4. **Fill the xcconfig placeholders**: `PRIVY_APP_ID`, `COMPOSIO_PROJECT_ID`,
   and the three Railway URLs in
   `AmberApp/Configuration/{Development,Staging,Release}.xcconfig`. Attach
   each xcconfig to its matching build configuration in the Xcode project.
5. **Apple Developer portal**: enroll under an organization, create App ID
   `com.amber.AmberApp`, enable Push, HealthKit, Sign in with Apple, and
   Associated Domains.
6. **App Store Connect**: create the app record, upload screenshots for all
   required device sizes, fill in the App Privacy answers (matches
   `PrivacyInfo.xcprivacy`).
7. **Widget target**: in Xcode, File > New > Target > Widget Extension, name
   it `AmberWidget`, delete Xcode's seeded source, point the target at
   `AmberWidget/AmberWidget.swift`, and share `NetworkDomain.swift` via
   Target Membership.
8. **Unit test target**: File > New > Target > Unit Testing Bundle, name it
   `AmberAppTests`, link `AmberAppTests/AmberServicesTests.swift`.
9. **Fastlane**: fill `fastlane/Appfile` with real `team_id` and
   `itc_team_id`, then run `bundle exec fastlane ios beta` for the first
   TestFlight build.
10. **Privacy policy + Terms**: host at `amberorg.ai/privacy` and
    `amberorg.ai/terms` before submitting for review.

Once 1-10 are in place the app ships.

## Architecture

```
View (@EnvironmentObject services)
    |
    v
ViewModel (AmberHomeViewModel, ContactsHomeViewModel, ProfileHomeViewModel)
    |
    v
Protocol (AmberChatService, ContactRepository, NetworkGraphService, ...)
    |
    +---- DEBUG  -> Services/Mock/MockServices.swift    (empty, never invented)
    |
    +---- RELEASE -> Services/Live/*.swift              (real HTTP)
                     |
                     v
                     AmberAgentClient
                     |
                     v
                     POST https://amber-agent-production.up.railway.app/api/*  (chat, contacts, graph)
                     POST https://amber-id-production.up.railway.app/api/*     (account, identity)
                        with Authorization: Bearer <privy_jwt>
```

Every service has a protocol. Every production call routes through
`AmberAgentClient`. Every DEBUG build returns empty data so the simulator
shows honest empty states.

## Files that matter

| Path                                                       | Role                                                                                                       |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `AmberApp.swift`                                           | App entry. Injects `AmberServices`, `AmberRouter`, `NetworkReachability`. Handles deep links and app lock. |
| `Models/NetworkDomain.swift`                               | All domain types. `NetworkContact`, `AmberAnswer`, `AmberProfile`, `NetworkGraph`, etc.                    |
| `Services/Protocols/AmberServices.swift`                   | Protocols for every service and the container.                                                             |
| `Services/Mock/MockServices.swift`                         | Empty-data mocks. No fixtures. No invented people.                                                         |
| `Services/Live/AmberAgentClient.swift`                     | Thin HTTP client with Privy JWT injection.                                                                 |
| `Services/Live/LiveServices.swift`                         | Live implementations of every protocol.                                                                    |
| `Services/Live/DeviceContactsImporter.swift`               | CNContactStore -> ContactRepository + /ingest/relationship.                                                |
| `Services/Live/PrivySDKAdapter.swift`                      | Stub until the Privy iOS SwiftPM dependency lands.                                                         |
| `Views/AmberHomeView.swift`                                | Ask Amber center tab.                                                                                      |
| `Views/ContactsHomeView.swift`                             | Contacts tab with search + circle filter + section index.                                                  |
| `Views/ProfileHomeView.swift`                              | Identity + connected apps + memories.                                                                      |
| `Views/Shared/SetupChecklistView.swift`                    | First-run four-step setup card that replaces fake data.                                                    |
| `Views/Shared/AmberIDCardView.swift`                       | Share Card with QR.                                                                                        |
| `Views/Shared/MemoryDetailView.swift`                      | Memory detail page.                                                                                        |
| `Views/Shared/NetworkGraphCanvas.swift`                    | Node-link graph with warm-path highlight.                                                                  |
| `Views/Onboarding/Permissions/PermissionPrimingView.swift` | Primes Contacts, Notifications, Calendar, Photos, Health.                                                  |
| `Utilities/AmberRouter.swift`                              | Typed deep-link router.                                                                                    |
| `Utilities/AmberAppIntents.swift`                          | Siri / Shortcuts / Spotlight integrations.                                                                 |
| `Utilities/AmberHaptics.swift`                             | Unified haptic API.                                                                                        |
| `Utilities/VoiceTranscriber.swift`                         | Speech framework wrapper for the mic button.                                                               |
| `AmberWidget/AmberWidget.swift`                            | WidgetKit source. Add the target in Xcode before it builds.                                                |
| `Info.plist`                                               | Permission strings + `AmberConfig` dict with base URLs.                                                    |
| `PrivacyInfo.xcprivacy`                                    | App Store privacy declarations.                                                                            |
| `fastlane/`                                                | Release lanes, metadata, and Appfile.                                                                      |
| `APP_STORE_CHECKLIST.md`                                   | Everything to do in App Store Connect / Apple Developer portal.                                            |

## Local run

```bash
cd AmberApp
xcodebuild -project AmberApp.xcodeproj -scheme AmberApp \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -configuration Debug build
```

DEBUG simulator runs with `MockServices`, which return empty data. Views
render honest empty states, the SetupChecklist, and a Sign In screen. No
invented contacts, graphs, or memories.

## Switching environments

Edit `Info.plist > AmberConfig` or the xcconfig in `Configuration/*.xcconfig`:

- `AmberAgentBaseURL` - Railway amber-agent URL
- `AmberIDBaseURL` - Railway amber-id URL
- `PrivyAppId` - Privy dashboard app ID
- `ComposioProjectId` - Composio project ID
- `ComposioRedirectURL` - Must match the URL scheme in Info.plist
- `Environment` - `development | staging | production`

## What's not done here

See `APP_STORE_CHECKLIST.md` for the list of items that require App Store
Connect, designer assets, SDK integrations, and production secrets.

## Tests

```bash
xcodebuild -project AmberApp.xcodeproj -scheme AmberApp \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

Unit tests live under `AmberAppTests/`. The test target needs to be added in
Xcode (File > New > Target > Unit Testing Bundle > name it `AmberAppTests`)
before the `test` lane runs green.

All glory to God.
