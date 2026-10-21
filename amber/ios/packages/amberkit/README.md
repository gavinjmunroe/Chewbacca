# AmberKit (quarantined)

> **Status:** unused by the shipping app. Kept as a quarantined SwiftPM
> package so CI continues to compile it (a guard against bit-rot) while we
> decide whether to delete or revive it.

The Amber iOS app (`AmberApp/`) does **not** import this package. Production
networking lives in `AmberApp/AmberApp/Services/Live/` and uses its own
`AmberAgentClient` / `AmberIDClient` actors with token storage in the
Keychain. None of `AmberClient.swift` or `AuthManager.swift` is wired into
the app target.

## What's here

- `AmberClient.swift` — an older REST client targeting the legacy API
  (`/persons`, `/relationships`). The deployed amber-id / amber-agent
  surface area uses different endpoints (`/api/...`).
- `AuthManager.swift` — the previous in-memory auth holder. Pre-Keychain.

## Decision matrix

- **Keep & extend:** if you decide to ship a public Swift SDK for third
  parties, this is the starting point. Re-align the endpoints with the
  deployed services first.
- **Delete:** safe to remove (and drop the `swift build` step from
  `ci.yml`) if no SDK is on the roadmap. No production code depends on it.

Until that decision is made, do not add new code here and do not import
this module from `AmberApp`.
