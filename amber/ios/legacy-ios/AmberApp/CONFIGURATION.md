# Amber iOS — Build Configuration

This document covers the env-driven configuration the iOS app reads at
launch. Every value flows:

```
xcconfig (per-environment)
  ↓ build setting substitution
Info.plist  (AmberConfig dict, $(VAR) expanded)
  ↓ Bundle.main.object(forInfoDictionaryKey:)
AmberAppConfig.default  (Swift struct, used app-wide)
```

If a value still looks like `$(VAR)` or `REPLACE_WITH_*` at runtime,
`AmberAppConfig.isMisconfigured` is `true` and the app refuses to bring up
the Privy SDK with placeholder credentials.

## Files

| File                                      | Maps to              |
|-------------------------------------------|----------------------|
| `AmberApp/Configuration/Development.xcconfig` | Debug builds        |
| `AmberApp/Configuration/Staging.xcconfig`     | Staging archives    |
| `AmberApp/Configuration/Release.xcconfig`     | TestFlight / App Store |

`Debug` and `Release` are wired via `baseConfigurationReference` in
`AmberApp.xcodeproj/project.pbxproj`. To add Staging, duplicate the
Release `XCBuildConfiguration` block, set
`baseConfigurationReference = AC0001022F00000000000002` (the Staging
xcconfig file ref), and append it to the project + target
`XCConfigurationList`.

## Required values

Each xcconfig must define:

| Key                     | Example (production)                              |
|-------------------------|---------------------------------------------------|
| `AMBER_AGENT_BASE_URL`  | `https://amber-agent-production.up.railway.app`   |
| `AMBER_ID_BASE_URL`     | `https://amber-id-production.up.railway.app`      |
| `PRIVY_APP_ID`          | `<from Privy dashboard>`                          |
| `PRIVY_APP_CLIENT_ID`   | `<from Privy dashboard>`                          |
| `COMPOSIO_PROJECT_ID`   | `<from Composio dashboard>`                       |
| `AMBER_ENVIRONMENT`     | `production`                                      |
| `PRODUCT_BUNDLE_IDENTIFIER` | `com.amber.AmberApp`                          |
| `DISPLAY_NAME`          | `Amber`                                           |
| `ASSETCATALOG_COMPILER_APPICON_NAME` | `AppIcon`                            |

## The `https:/$()/` idiom

`//` in xcconfig starts a line comment, which mangles `https://...`. The
fix is to insert the empty `$()` expansion between the colon and the
slashes — at build time `$()` evaluates to `""`, so
`https:/$()/host` becomes `https://host` in the resolved build setting.
This is what `AMBER_URL_SCHEME = https:/$()/` is for. Verified by:

```bash
xcodebuild -project AmberApp.xcodeproj -showBuildSettings -configuration Debug \
  | grep AMBER_AGENT_BASE_URL
```

## Privy / Composio secrets

Only the public app IDs are committed to xcconfig. Secret API keys
(Privy app secret, Composio project secret, Exa API key) live server-side
on amber-id and amber-agent. The iOS app never holds them.

`Info.plist:ExaKeychainKey` names the keychain entry that the Exa-aware
features read at runtime — populate via Settings → Developer if you need
on-device search; production reads go through amber-agent.

## Dev-mode simulator bypass

Release builds compile out the bypass entirely. Debug builds running on
the iOS Simulator can opt into a placeholder login by adding the launch
argument `AMBER_DEV_SIM_BYPASS` to the Xcode scheme's Run action. Without
that argument the simulator goes through normal Privy auth.

The bypass token (`dev-bypass-token`) is rejected by every deployed
backend — it only lets the UI render so the team can iterate on
empty-state visuals.

## App Store data deletion

`POST /api/account/delete` lives on **amber-id**, not amber-agent.
`LiveAuthService.deleteAccount()` calls `AmberIDClient.postVoid` so the
endpoint contract is owned by the identity vault. Required for App Store
Guideline 5.1.1(v) compliance.
