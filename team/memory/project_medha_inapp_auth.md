---
name: project_medha_inapp_auth
description: In-app (iOS) Medha root cause + full fix across 3 repos; all shipped, agent confirmed replying (build #43 on TestFlight)
metadata:
  node_type: memory
  type: project
  originSessionId: e9d85e95-74bf-4e0a-a691-4584d18a4857
---

In-app Medha ("Something went wrong") was three stacked bugs, root-caused 2026-06-02 via a temporary admin trace at medha-platform `GET /debug/qc-trace` (X-Admin-Token). iMessage was never affected (webhook-secret auth, different path).

1. **medha-platform auth (FIXED, deployed, commit dbd8ea7):** `/api/v1/quick-call/stream` (and `/quick-call`, `/togari/message`) gated on `requirePrivyAuth` (Privy ES256 only). The iOS app authenticates with a **medha-id session JWT** from the warm-OTP flow (`amber-ios lib/auth.ts` -> medha-id `/v1/auth/verify-code-only`; `sub=person_id=sha256(E.164(phone)).slice(0,32)`, plus a `phone` claim), NOT a Privy token. Fix: replaced the hard gate with `softPrivyAuth` (captures a Privy DID if present, does not reject a session JWT); medha-id `/v1/me` is now the authoritative auth gate (it accepts both token families).

2. **amber-ios client (FIXED, pushed main commit c933053, needs EAS rebuild):** `askMedha` read SSE with RN global `fetch`, whose `res.body` is always null -> never readable. Switched to `import { fetch } from 'expo/fetch'` (SDK 54 native iOS module, real ReadableStream). Also mapped `caller_not_provisioned` -> identity onboarding gate, auth codes -> re-auth, `agent_failed`/`amber_id_*` -> friendly retry.

3. **medha-id (FIXED, deployed, main commit 77f30dd, authored as Sagar Tiwari):** two parts. (a) `/v1/me` (`src/routes/profile.js`) now resolves phone/loopSender by the verified session phone via `tenantIndex.getByPhone(request.privyUser.phone)` and NO LONGER 404s when the profile doc is absent (returns 200 with empty profile + identity). (b) NEW `ensureTenantForPhone(phone)` in `src/routes/tenants.js`, called from BOTH OTP verify handlers (`/v1/auth/verify` and `/v1/auth/verify-code-only`) in `medha-dashboard.js`: idempotent, sender-preserving auto-provision so EVERY new OTP user gets a Privy tenant (keyed by phone) with a synthetic loopSenderId (randomUUID) + minimal onboardingProfile. Root issue was OTP sign-in minted only a session JWT and never wrote a tenant, so new users had neither tenant nor profile. App-only users get synthetic senders (in-app SSE captures the reply, never sends via Loop); real Loop numbers can be assigned later for iMessage without disturbing this. Confirmed working: trace showed `ok=true hasPhone=true hasLoopSender=true` + `onMessage segment len=22` + `settled fullLen=22` (a real agent reply).

iOS: build #43 (expo/fetch fix, commit c933053 + buildNumber bump c0f8c27) built on EAS and submitted to TestFlight 2026-06-02 (ascAppId 6774023666, ASC key <keyId in amber-ios eas.json> issuer <issuerId in amber-ios eas.json> now wired into apps/mobile/eas.json submit profile; .p8 gitignored in-project). Caleb installs build 43 to see the streamed reply on screen.

CLEANUP STILL TODO: remove the temp `[qc-debug]` instrumentation from `medha-platform Newton/agent/lib/server.js` (QC_TRACE array, qcTrace helper, all qcTrace calls, the `GET /debug/qc-trace` endpoint) once the new build is confirmed; KEEP the `softPrivyAuth` change. Handoff doc `medha-platform/MEDHA_IOS_INAPP_HANDOFF.md` is now superseded (it described the medha-id fix as open; it's done). Open nuance: a pre-existing user like Caleb keeps his old tenant displayName "Togari"; new OTP users default to "Medha". Related: [[project_medha_app_agent_paths]], a private note.
