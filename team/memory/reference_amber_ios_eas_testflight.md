---
name: reference-amber-ios-eas-testflight
description: "How to build + submit amber-ios to TestFlight via EAS (ascAppId, ASC API key location, Togari proxy env)"
metadata:
  node_type: memory
  type: reference
  originSessionId: 0c3ece99-1aa0-49db-a427-5176ed20d943
---

amber-ios (Expo) lives at `amber-organization/amber/amber-ios/apps/mobile`; EAS owner account is `amberrr`, slug `amber`, projectId `65b9b69f-7b1a-4915-9309-42a1069869e8`, bundle `com.joinrytual.amber`, Apple app name "Amber!!".

**RULE (Caleb, standing): ALWAYS `--auto-submit` to ASC for anything pushed to EAS.** Never build without auto-submit; an EAS build that doesn't reach TestFlight is not done. Use `eas build --platform ios --profile production --auto-submit --non-interactive`.

**Build + submit to TestFlight:**
`--auto-submit` / `eas submit --non-interactive` FAILS unless the submit profile has `ascAppId` AND ASC API key fields. EAS does NOT auto-resolve ascAppId in non-interactive mode.

- **ascAppId: `6774023666`** (pinned in eas.json submit.production.ios, so it persists).
- ASC API key (kept OUT of git): `~/.appstoreconnect/private_keys/AuthKey_BUU5Z6J9GL.p8`, keyId `<keyId in amber-ios eas.json>`, issuerId `<issuerId in amber-ios eas.json>`, appleTeamId `4DMVHH99R2`. Add `ascApiKeyPath`/`ascApiKeyId`/`ascApiKeyIssuerId` to eas.json submit profile to submit non-interactively, then strip them back out before committing.
- **buildNumber collisions:** submit fails with "You've already submitted this build" when the CFBundleVersion already exists on ASC. `appVersionSource: local` + `autoIncrement` only knows app.json's value; `remote` uses EAS's OWN counter (also drifts). Both can collide with ASC. FIX: query ASC for the real max build (`GET /v1/builds?filter[app]=<ascAppId>&sort=-version`, JWT from the .p8 via ES256), then pin app.json `buildNumber` above it and rebuild. As of 2026-06-02 ASC max was 41; shipped 42.
- After a successful submit, strip the ASC key fields from eas.json and commit the buildNumber bump.

**Togari chat in-app** routes through medha-platform: client `askTogari` POSTs `{text}` to `${amberAgentBaseUrl}/api/v1/togari/message` (Bearer JWT); the proxy ([[project_togari_imessage_live]]) forwards to `https://togari-bma-prod.up.railway.app/api/v1/message` with server-held `X-Togari-Key`. Env vars `TOGARI_PLATFORM_URL` + `TOGARI_API_KEY` are set on the medha-platform Railway service (project `medha`, prod). Key value is the same `b8356bcc...` that was hardcoded in the old client (rotation is a deferred TODO per Caleb).
