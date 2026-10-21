# Amber engineering handoff

Last verified: 2026-10-19. This is the current operating snapshot for the CEO, CTO, and engineers. Older release notes remain in `docs/sagar-main/testflight-setup.md`; the stable ID contract is in `docs/sagar-main/release-and-identity-map.md`.

## Repositories and release

| Area | Current state |
| --- | --- |
| iOS | `amberintelligence/amber-ios`, `main` at `9499998` (`Bump iOS TestFlight build to 14`). Sagar-main `3ac933f` and the UI merge `8d5f9df` are ancestors of this commit. |
| Backend | `amberintelligence/amber-id`, GitHub `main` at `6031655` (`Name people from their addresses, spread the graph, stop the markdown`). Production `/status` reports the same runtime commit, healthy GCP Cloud SQL, current schema, and branch `main`. |
| Expo | Project `@amber-intelligence/amber`, project ID `65b9b69f-7b1a-4915-9309-42a1069869e8`, owned by `amber-intelligence`. The active `sagarisme` account has project access. |
| iOS app | `com.joinrytual.amber.beta`, version `1.0.1`, build `14`, Apple team `XJ94HGCQHA` (Rytual Health LLC). |
| TestFlight | Build `1.0.1 (14)`, App Store Connect build ID `aaf73e4f-4f52-4f69-8476-ce9b09c1c867`, built from iOS `main` at `9499998` and assigned to **Amber Internal Beta**. App Store Connect reports `VALID`; external beta review was not submitted. |
| OTA UI | EAS production update group `4fbda0f8-0929-490c-9084-0639e2b15b4e`, published from `9499998`, runtime `1.0.1-sagar-beta`. This is the newest production iOS update and matches build 14. |
| Keyboard | Kyber remains excluded from build 14 by request. It is not part of this TestFlight release. |

The TestFlight IPA was built by EAS build `055ccf92-3f2b-4369-bb0f-aee1509f87df` from `949999832e302e01c263146fc6cf31b4c764303c` using the production profile and Rytual signing credentials, then uploaded with the authenticated ASC CLI. EAS auto-submit could not run because an App Store Connect API key is not configured in EAS. Do not describe an EAS auto-submit pipeline as ready until that organization credential is configured. Do not put its private key in this repository or in chat.

The separate local `sagar-main` checkout is still at `3ac933f`; its uncommitted changes are limited to the app build number and Expo dependency pins. It contains no uncommitted UI edits and was not used as the release source.

## Verification and acceptance status

- iOS `pnpm --dir apps/mobile run verify`: all 21 checks passed on the release commit.
- Backend full suite on current `main` commit `6031655`: 2,298 passed, 0 failed, 45 skipped. The skipped tests require database fixtures. Backend typecheck and undefined-reference check passed. Production `/status` reports healthy Cloud SQL and current schema.
- Production route smoke checks for Profile, PeopleRank, people/place discovery, Clay search/enrichment, Clay job lookup, and circles returned the expected unauthenticated `401`, confirming those paths are mounted and auth-gated.
- iOS `pnpm --dir apps/mobile run verify`: all 21 checks passed on the release source; mobile tests passed 584/584; typecheck and lint passed. The booted Simulator is still on build 11, so its screen is not the TestFlight build 14. On a device, install/update Amber from TestFlight to `1.0.1 (14)`; open once to download the matching production OTA, then relaunch to apply it.
- These source and route checks do **not** establish that the signed-in account successfully completes every UI flow. The authenticated acceptance for onboarding, Profile, PeopleRank, person/place discovery, and Clay is still a follow-up. Do not call those flows live-verified until tested with the signed-in demo account.
- No live iMessage round trip was performed. No outbound text was sent during this verification.

## Preserve the ID and data model

Keep Karthik's existing account/contact split:

1. The authenticated session is sent to Amber ID. The server resolves it to `users.amber_id`, the account/tenant owner.
2. A person in the user's rolodex is `contacts.id`. Every contact read/write is scoped by that ID **and** the authenticated owner.
3. Imported provider identities remain provenance in `contact_sources.source` and `external_id`; they never replace Amber's contact ID.
4. `contacts.linked_amber_id` is set only after a verified Amber-member link. A matching imported name, email, or phone is not proof of membership.
5. Provider discovery IDs and job IDs are temporary. After saving/deduping, client views use the Amber ID returned by Amber ID.

Do not add a parallel person/account table, let the client choose an owner ID, or migrate provider IDs into `contacts.id`. API and MCP contract detail is maintained in `docs/sagar-main/release-and-identity-map.md`.

## Feature surfaces and service boundaries

- **PeopleRank:** authenticated `POST /v1/me/people-rank`; citations and contact actions use `contacts.id`.
- **Web discovery:** authenticated `POST /v1/me/discovery/search`; use `scope: people` or `scope: places` and require an explicit city for place search. Save results through the existing Amber routes.
- **Clay:** mobile search and selected-field enrichment use the shared server-side Clay public API key and `/v1/me/clay/*` async routes. This credential stays server-side. Generic contact-provider enrichment is a separate path that may use a per-user `CLAY_API_KEY`; the signed-in demo account's key and successful result are not verified. Never infer that one Clay path proves the other.
- **GCP:** the Railway `amber-id` service connects to GCP Cloud SQL. Current production health is green. Service-account credentials stay in server configuration, not mobile or web code.
- **MCP:** `POST /mcp` accepts an owner-bound personal key and exposes scoped tools over the same dataset. Profile > Amber card > Amber in other apps creates a personal MCP key, shows it once, supports copy/revoke, and gives the Streamable HTTP URL. The server binds the key to one `users.amber_id`; a different supplied owner is rejected. Tools cover PeopleRank, people/plans reads, and contact create/read/note operations. Personal MCP auth intentionally rejects the isolated App Review account; use a normal owner account for the MCP demo. A live third-party MCP client handshake has not been demonstrated.
- **Mobile sources:** Apple Contacts and Google Gmail/Calendar are implemented connectors. Meta/Muse is explicitly marked “not connected yet”; the app currently presents an evaluation screen, not a working connector. A source visible in a catalog is not evidence that OAuth or sync is implemented.
- **iMessage:** `/v1/me/imessage-link` is inbound opt-in for messages from the user's linked phone. It is separate from outbound notification preferences. Amber does not import Messages history. SMS invitation/OTP flows open Messages for user confirmation; they do not silently send.
- **Kyber:** iOS keyboards cannot inspect the existing Messages conversation. Kyber can use typed/selected text, call Amber ID, and insert text. It requires Full Access for network/keychain. It is excluded from build 14 by request.

## Current Kyber finding

The keyboard's native client had a stale hostname (`medha-id-production.up.railway.app`) while `app.json` points to `amber-id-production.up.railway.app`; a live `/status` check returned 404 on the stale host and 200 on the production host. The source fix and verification guard are merged in `c4d8ab6`. Build 14 still excludes Kyber. Do not enable Kyber for distribution until a new build includes the fix, the extension has valid signing, and the updated keyboard is accepted on a real device.

## CTO operating path

1. Start with `docs/sagar-main/release-and-identity-map.md` before changing ID, MCP, discovery, or contact-source contracts.
2. Keep changes in the existing `amber-ios` and `amber-id` repositories. Check `AGENTS.md` and preserve route schemas, ID ownership, and provider provenance.
3. For client changes, run `pnpm --dir apps/mobile run verify`; for backend changes, run the repository's required suite and boot/route checks. Do not ship on TypeScript-only checks when route registration can fail at startup.
4. Verify production secrets by name/status without copying their values. Clay and GCP secrets stay in Railway; signing assets and App Store Connect credentials stay in their managed accounts.
5. Build from `main` with the `production` EAS profile and the beta bundle ID. Verify the exact source commit, processing state, tester group assignment, and TestFlight notes after upload. Upload does not mean distribution.
6. Keep Kyber as a separate opt-in release until its signing and physical-device checks are complete.

## Known follow-ups

- Complete signed-in simulator acceptance for onboarding, Profile, PeopleRank, discovery people/places, and Clay search/selected-field enrichment.
- Confirm whether generic contact-provider enrichment is required for the demo; if so, verify the signed-in user's server-side Clay key without exposing it and confirm sourced fields on a disposable test contact.
- Add the App Store Connect API key to Expo's managed EAS configuration if one-command EAS auto-submit is desired.
- Keep Kyber out of TestFlight until its host fix lands, Apple extension signing is configured, and a real-device pass covers Full Access, shared login/refresh, Ask, People, Plans, and insertion.
- Exercise iMessage only with an opted-in test device and explicit participant approval. No history-import capability exists.
